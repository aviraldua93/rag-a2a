import { loadConfig } from '../config.ts';
import { logger } from '../logger.ts';
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
    logger.info({ component: 'embeddings', provider: 'openai', model: config.openai.embeddingModel }, `Embeddings: OpenAI (${config.openai.embeddingModel})`);
  } else {
    const { MockEmbedder } = await import('../embeddings/mock.ts');
    embedder = new MockEmbedder();
    logger.warn({ component: 'embeddings', provider: 'mock' }, 'Embeddings: MockEmbedder (no OPENAI_API_KEY)');
  }
} catch {
  const { MockEmbedder } = await import('../embeddings/mock.ts');
  embedder = new MockEmbedder();
  logger.warn({ component: 'embeddings', provider: 'mock' }, 'Embeddings: MockEmbedder (import fallback)');
}

// --- 2. Vector store ---
let store: VectorStore;
try {
  if (config.qdrant.url) {
    const { QdrantStore } = await import('../store/qdrant.ts');
    store = new QdrantStore(config.qdrant.url, config.qdrant.collectionName);
    await store.initialize(config.qdrant.vectorSize);
    logger.info({ component: 'store', provider: 'qdrant', url: config.qdrant.url }, `Store: Qdrant (${config.qdrant.url})`);
  } else {
    throw new Error('No QDRANT_URL');
  }
} catch {
  const { MemoryStore } = await import('../store/memory.ts');
  store = new MemoryStore();
  await store.initialize(config.qdrant.vectorSize);
  logger.warn({ component: 'store', provider: 'memory' }, 'Store: MemoryStore (Qdrant unavailable)');
}

// --- 3. Reranker ---
let reranker: Reranker;
try {
  if (config.cohere.apiKey.length > 0) {
    const { CohereReranker } = await import('../retrieval/cohere-reranker.ts');
    reranker = new CohereReranker(config.cohere.apiKey);
    logger.info({ component: 'reranker', type: 'cohere', model: 'rerank-v3.5' }, 'Reranker: CohereReranker (rerank-v3.5)');
  } else {
    const { ScoreReranker } = await import('../retrieval/reranker.ts');
    reranker = new ScoreReranker();
    logger.warn({ component: 'reranker', type: 'score' }, 'Reranker: ScoreReranker (no COHERE_API_KEY — set it for cross-encoder reranking)');
  }
} catch {
  const { ScoreReranker } = await import('../retrieval/reranker.ts');
  reranker = new ScoreReranker();
  logger.warn({ component: 'reranker', type: 'score' }, 'Reranker: ScoreReranker (CohereReranker import fallback)');
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
  logger.info({ component: 'retrieval' }, 'Retrieval pipeline: initialised');
} catch (err) {
  logger.error({ component: 'retrieval', err }, 'Could not create retrieval pipeline');
  process.exit(1);
}

// --- 5. Generator ---
let generator: RAGGenerator | MockGenerator | null = null;
if (hasApiKey) {
  generator = new RAGGenerator(config.openai.apiKey, config.openai.generationModel);
  logger.info({ component: 'generator', provider: 'openai', model: config.openai.generationModel }, `Generator: OpenAI (${config.openai.generationModel})`);
} else {
  generator = new MockGenerator();
  logger.warn({ component: 'generator', provider: 'mock' }, 'Generator: MockGenerator (no OPENAI_API_KEY)');
}

// --- 6. A2A task executor ---
const executor = new TaskExecutor(pipeline, generator);

// --- BM25 index rebuild from stored documents ---
try {
  const docCount = await store.count();
  if (docCount > 0) {
    logger.info({ component: 'bm25', docCount }, `Rebuilding BM25 index from ${docCount} stored documents...`);
    const allDocs = await store.getAll();
    pipeline.indexDocuments(
      allDocs.map(doc => ({ id: doc.id, content: doc.content, metadata: doc.metadata }))
    );
    logger.info({ component: 'bm25', indexed: allDocs.length }, `BM25 index rebuilt with ${allDocs.length} documents`);
  } else {
    logger.warn({ component: 'bm25' }, 'BM25 index empty — run /api/ingest to populate');
  }
} catch (err) {
  logger.warn({ component: 'bm25', err: err instanceof Error ? err.message : String(err) }, 'Could not rebuild BM25 index');
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

logger.info({
  component: 'server',
  host: config.server.host,
  port: config.server.port,
  url: baseUrl,
  endpoints: {
    health: `${baseUrl}/api/health`,
    agentCard: `${baseUrl}/.well-known/agent-card.json`,
    a2aRpc: `${baseUrl}/a2a`,
  },
}, `RAG-A2A server running at ${baseUrl}`);
