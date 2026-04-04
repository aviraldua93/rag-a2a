import { loadConfig } from '../config.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import type { VectorStore } from '../store/types.ts';
import type { Reranker } from '../retrieval/reranker.ts';
import type { RetrievalPipeline as RetrievalPipelineType } from '../retrieval/pipeline.ts';
import { RAGGenerator, MockGenerator } from '../generation/generator.ts';
import { TaskExecutor } from '../a2a/executor.ts';
import { handleRequest } from './routes.ts';

// ---------------------------------------------------------------------------
// Main server bootstrap
// ---------------------------------------------------------------------------

const config = loadConfig();
const hasApiKey = config.openai.apiKey.length > 0;

// --- 1. Embedding provider ---
let embedder: EmbeddingProvider;
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
} catch {
  const { MockEmbedder } = await import('../embeddings/mock.ts');
  embedder = new MockEmbedder();
  console.log('⚠️  Embeddings: MockEmbedder (import fallback)');
}

// --- 2. Vector store ---
let store: VectorStore;
try {
  if (config.qdrant.url) {
    const { QdrantStore } = await import('../store/qdrant.ts');
    store = new QdrantStore(config.qdrant.url, config.qdrant.collectionName);
    await store.initialize(config.qdrant.vectorSize);
    console.log(`✅ Store: Qdrant (${config.qdrant.url})`);
  } else {
    throw new Error('No QDRANT_URL');
  }
} catch {
  const { MemoryStore } = await import('../store/memory.ts');
  store = new MemoryStore();
  await store.initialize(config.qdrant.vectorSize);
  console.log('⚠️  Store: MemoryStore (Qdrant unavailable)');
}

// --- 3. Reranker ---
let reranker: Reranker;
try {
  const { ScoreReranker } = await import('../retrieval/reranker.ts');
  reranker = new ScoreReranker();
  console.log('✅ Reranker: ScoreReranker ready');
} catch {
  // Fallback no-op reranker
  reranker = {
    async rerank(_q: string, results, topK: number) {
      return results.slice(0, topK);
    },
  };
  console.log('⚠️  Reranker: passthrough (module not found)');
}

// --- 4. Retrieval pipeline ---
let pipeline: RetrievalPipelineType;
try {
  const { RetrievalPipeline } = await import('../retrieval/pipeline.ts');
  pipeline = new RetrievalPipeline(store, embedder, reranker, {
    topK: config.retrieval.topK,
    hybridWeight: config.retrieval.hybridWeight,
    rerankTopK: config.retrieval.rerankTopK,
  });
  console.log('✅ Retrieval pipeline: initialised');
} catch (err) {
  console.error('❌ Could not create retrieval pipeline:', err);
  process.exit(1);
}

// --- 5. Generator ---
let generator: RAGGenerator | MockGenerator | null = null;
if (hasApiKey) {
  generator = new RAGGenerator(config.openai.apiKey, config.openai.generationModel);
  console.log(`✅ Generator: OpenAI (${config.openai.generationModel})`);
} else {
  generator = new MockGenerator();
  console.log('⚠️  Generator: MockGenerator (no OPENAI_API_KEY)');
}

// --- 6. A2A task executor ---
const executor = new TaskExecutor(pipeline, generator);

// --- BM25 index rebuild from stored documents ---
try {
  const docCount = await store.count();
  if (docCount > 0) {
    console.log(`📚 Rebuilding BM25 index from ${docCount} stored documents...`);
    const allDocs = await store.getAll();
    pipeline.indexDocuments(
      allDocs.map(doc => ({ id: doc.id, content: doc.content, metadata: doc.metadata }))
    );
    console.log(`✅ BM25 index rebuilt with ${allDocs.length} documents`);
  } else {
    console.log('⚠️  BM25 index empty — run /api/ingest to populate');
  }
} catch (err) {
  console.log('⚠️  Could not rebuild BM25 index:', err instanceof Error ? err.message : String(err));
}

// --- 7. Start the server ---
const baseUrl = `http://${config.server.host}:${config.server.port}`;

const server = Bun.serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch(req: Request) {
    return handleRequest(req, {
      pipeline,
      generator,
      executor,
      baseUrl,
      store,
      embedder,
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
