/**
 * Unit tests for embedding model version metadata tracking.
 *
 * Covers:
 * - Ingestion pipeline stores embedder.modelName in document metadata
 * - RetrievalPipeline warns when stored embeddingModel mismatches current embedder
 * - No warning emitted when models match
 * - No warning emitted for docs without embeddingModel metadata (backwards compat)
 */
import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { MemoryStore } from '../../src/store/memory.ts';
import { MockEmbeddingProvider, createVectorDocument } from '../helpers/mocks.ts';
import { RetrievalPipeline, _retrievalLog } from '../../src/retrieval/pipeline.ts';
import { ScoreReranker } from '../../src/retrieval/reranker.ts';
import { ingestDirectory } from '../../src/ingestion/pipeline.ts';
import type { VectorDocument } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIMS = 384;

// ---------------------------------------------------------------------------
// Ingestion metadata tests
// ---------------------------------------------------------------------------

describe('Embedding model metadata — ingestion', () => {
  test('ingestDirectory stores embedder.modelName as embeddingModel in each document metadata', async () => {
    const store = new MemoryStore();
    await store.initialize(DIMS);
    const embedder = new MockEmbeddingProvider(DIMS);

    // Use the sample-docs directory that ships with the project
    const result = await ingestDirectory('./sample-docs', embedder, store, {
      chunkSize: 200,
      chunkOverlap: 20,
      batchSize: 50,
    });

    expect(result.chunksStored).toBeGreaterThan(0);

    // Verify every stored document has the embeddingModel field
    const allDocs = await store.getAll();
    for (const doc of allDocs) {
      expect(doc.metadata.embeddingModel).toBe('mock-test-embedding');
    }
  });

  test('embeddingModel matches the embedder modelName property', async () => {
    const store = new MemoryStore();
    await store.initialize(DIMS);

    // Create a custom embedder with a specific model name
    const customEmbedder: MockEmbeddingProvider = new MockEmbeddingProvider(DIMS);
    // Override modelName via a subclass-like approach
    const embedder = Object.create(customEmbedder) as MockEmbeddingProvider;
    Object.defineProperty(embedder, 'modelName', { value: 'text-embedding-3-large', enumerable: true });

    const result = await ingestDirectory('./sample-docs', embedder, store, {
      chunkSize: 200,
      chunkOverlap: 20,
      batchSize: 50,
    });

    expect(result.chunksStored).toBeGreaterThan(0);

    const allDocs = await store.getAll();
    for (const doc of allDocs) {
      expect(doc.metadata.embeddingModel).toBe('text-embedding-3-large');
    }
  });
});

// ---------------------------------------------------------------------------
// Retrieval mismatch warning tests
// ---------------------------------------------------------------------------

describe('Embedding model metadata — retrieval mismatch warning', () => {
  let store: MemoryStore;
  let embedder: MockEmbeddingProvider;
  let reranker: ScoreReranker;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.initialize(DIMS);
    embedder = new MockEmbeddingProvider(DIMS);
    reranker = new ScoreReranker();
  });

  test('warns when stored embeddingModel differs from current embedder', async () => {
    // Store documents embedded with a different model
    const content = 'Machine learning algorithms learn patterns from data.';
    const vec = await embedder.embed(content);
    await store.upsert([{
      id: 'doc-1',
      vector: vec,
      content,
      metadata: {
        source: 'test.md',
        embeddingModel: 'text-embedding-ada-002', // Old model
      },
    }]);

    const pipeline = new RetrievalPipeline(store, embedder, reranker, {
      topK: 5,
      hybridWeight: 1.0, // Pure vector to trigger vector search
      rerankTopK: 5,
    });

    // Spy on the pino logger warn method
    const warnSpy = spyOn(_retrievalLog, 'warn');

    await pipeline.retrieve('machine learning', { mode: 'vector' });

    expect(warnSpy).toHaveBeenCalled();
    // pino child loggers pass (mergingObj, msg) — check msg arg
    const lastCall = warnSpy.mock.calls[0];
    const msgArg = lastCall[lastCall.length - 1] as string;
    expect(msgArg).toContain('Embedding model mismatch');
    expect(msgArg).toContain('text-embedding-ada-002');
    expect(msgArg).toContain('mock-test-embedding');

    warnSpy.mockRestore();
  });

  test('no warning when embeddingModel matches current embedder', async () => {
    const content = 'Machine learning algorithms learn patterns from data.';
    const vec = await embedder.embed(content);
    await store.upsert([{
      id: 'doc-1',
      vector: vec,
      content,
      metadata: {
        source: 'test.md',
        embeddingModel: 'mock-test-embedding', // Same as embedder.modelName
      },
    }]);

    const pipeline = new RetrievalPipeline(store, embedder, reranker, {
      topK: 5,
      hybridWeight: 1.0,
      rerankTopK: 5,
    });

    const warnSpy = spyOn(_retrievalLog, 'warn');

    await pipeline.retrieve('machine learning', { mode: 'vector' });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('no warning when documents have no embeddingModel metadata (backwards compat)', async () => {
    const content = 'Machine learning algorithms learn patterns from data.';
    const vec = await embedder.embed(content);
    await store.upsert([{
      id: 'doc-1',
      vector: vec,
      content,
      metadata: { source: 'test.md' }, // No embeddingModel field
    }]);

    const pipeline = new RetrievalPipeline(store, embedder, reranker, {
      topK: 5,
      hybridWeight: 1.0,
      rerankTopK: 5,
    });

    const warnSpy = spyOn(_retrievalLog, 'warn');

    await pipeline.retrieve('machine learning', { mode: 'vector' });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('warning fires during hybrid search mode too', async () => {
    const content = 'Machine learning algorithms learn patterns from data.';
    const vec = await embedder.embed(content);
    await store.upsert([{
      id: 'doc-1',
      vector: vec,
      content,
      metadata: {
        source: 'test.md',
        embeddingModel: 'old-model-v1',
      },
    }]);

    const pipeline = new RetrievalPipeline(store, embedder, reranker, {
      topK: 5,
      hybridWeight: 0.7,
      rerankTopK: 5,
    });
    pipeline.indexDocuments([{
      id: 'doc-1',
      content,
      metadata: { source: 'test.md' },
    }]);

    const warnSpy = spyOn(_retrievalLog, 'warn');

    await pipeline.retrieve('machine learning', { mode: 'hybrid' });

    expect(warnSpy).toHaveBeenCalled();
    const lastCall = warnSpy.mock.calls[0];
    const msgArg = lastCall[lastCall.length - 1] as string;
    expect(msgArg).toContain('old-model-v1');

    warnSpy.mockRestore();
  });

  test('no warning in keyword-only mode (no vector search)', async () => {
    const pipeline = new RetrievalPipeline(store, embedder, reranker, {
      topK: 5,
      hybridWeight: 0.5,
      rerankTopK: 5,
    });
    pipeline.indexDocuments([{
      id: 'doc-1',
      content: 'Machine learning algorithms',
      metadata: { source: 'test.md', embeddingModel: 'mismatched-model' },
    }]);

    const warnSpy = spyOn(_retrievalLog, 'warn');

    await pipeline.retrieve('machine learning', { mode: 'keyword' });

    // Keyword-only mode doesn't do vector search, so no mismatch check
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
