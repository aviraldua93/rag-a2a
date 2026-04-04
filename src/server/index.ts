import { loadConfig } from '../config.ts';
import { RAGGenerator, MockGenerator } from '../generation/generator.ts';
import { TaskExecutor } from '../a2a/executor.ts';
import { handleRequest } from './routes.ts';

// ---------------------------------------------------------------------------
// Main server bootstrap
// ---------------------------------------------------------------------------

const config = loadConfig();
const hasApiKey = config.openai.apiKey.length > 0;

// --- 1. Embedding provider ---
let embedder: unknown;
try {
  if (hasApiKey) {
    const { OpenAIEmbedder } = await import('../embeddings/openai.ts');
    embedder = new OpenAIEmbedder(config.openai.apiKey, config.openai.embeddingModel);
    console.log(`✅ Embeddings: OpenAI (${config.openai.embeddingModel})`);
  } else {
    const { MockEmbedder } = await import('../embeddings/mock.ts');
    embedder = new MockEmbedder();
    console.log('⚠️  Embeddings: MockEmbedder (no OPENAI_API_KEY)');
  }
} catch (err) {
  const { MockEmbedder } = await import('../embeddings/mock.ts');
  embedder = new MockEmbedder();
  console.log('⚠️  Embeddings: MockEmbedder (import fallback)');
}

// --- 2. Vector store ---
let store: unknown;
try {
  if (config.qdrant.url) {
    const { QdrantStore } = await import('../store/qdrant.ts');
    store = new QdrantStore(
      config.qdrant.url,
      config.qdrant.collectionName,
      config.qdrant.vectorSize,
    );
    // Test connectivity
    await (store as { ensureCollection?: () => Promise<void> }).ensureCollection?.();
    console.log(`✅ Store: Qdrant (${config.qdrant.url})`);
  } else {
    throw new Error('No QDRANT_URL');
  }
} catch (err) {
  try {
    const { MemoryStore } = await import('../store/memory.ts');
    store = new MemoryStore(config.qdrant.vectorSize);
    console.log('⚠️  Store: MemoryStore (Qdrant unavailable)');
  } catch {
    console.error('❌ Could not initialise any vector store');
    process.exit(1);
  }
}

// --- 3. BM25 keyword index ---
let bm25: unknown = null;
try {
  const { BM25Index } = await import('../retrieval/bm25.ts');
  bm25 = new BM25Index();
  console.log('✅ BM25: keyword index ready');
} catch {
  console.log('⚠️  BM25: not available (module not found)');
}

// --- 4. Reranker ---
let reranker: unknown = null;
try {
  const { CrossEncoderReranker } = await import('../retrieval/reranker.ts');
  reranker = new CrossEncoderReranker();
  console.log('✅ Reranker: CrossEncoderReranker ready');
} catch {
  console.log('⚠️  Reranker: not available (module not found)');
}

// --- 5. Retrieval pipeline ---
let pipeline: unknown;
try {
  const { RetrievalPipeline } = await import('../retrieval/pipeline.ts');
  pipeline = new RetrievalPipeline(store, bm25, reranker, embedder, config.retrieval);
  console.log('✅ Retrieval pipeline: initialised');
} catch (err) {
  console.error('❌ Could not create retrieval pipeline:', err);
  process.exit(1);
}

// --- 6. Generator ---
let generator: RAGGenerator | MockGenerator | null = null;
if (hasApiKey) {
  generator = new RAGGenerator(config.openai.apiKey, config.openai.generationModel);
  console.log(`✅ Generator: OpenAI (${config.openai.generationModel})`);
} else {
  generator = new MockGenerator();
  console.log('⚠️  Generator: MockGenerator (no OPENAI_API_KEY)');
}

// --- 7. A2A task executor ---
// The pipeline is typed as `unknown` because it's dynamically imported;
// at runtime it satisfies the RetrievalPipeline interface.
const executor = new TaskExecutor(pipeline as never, generator);

// --- 8. Start the server ---
const baseUrl = `http://${config.server.host}:${config.server.port}`;

const server = Bun.serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch(req) {
    return handleRequest(req, {
      pipeline: pipeline as never,
      generator,
      executor,
      baseUrl,
    });
  },
});

console.log('');
console.log('═'.repeat(52));
console.log(' 🚀 RAG-A2A server running');
console.log(`    Local:      ${baseUrl}`);
console.log(`    Health:     ${baseUrl}/api/health`);
console.log(`    Agent card: ${baseUrl}/.well-known/agent-card.json`);
console.log(`    A2A RPC:    ${baseUrl}/a2a`);
console.log('═'.repeat(52));
console.log('');
