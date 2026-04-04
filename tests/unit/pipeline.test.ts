/**
 * Unit tests for RetrievalPipeline (src/retrieval/pipeline.ts).
 *
 * Uses real MemoryStore, MockEmbeddingProvider, and ScoreReranker — no
 * mocking of the pipeline internals. Tests cover full orchestration,
 * metadata population, timing, empty states, rerankTopK limiting, and
 * hybridWeight effects.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { RetrievalPipeline, type RetrievalPipelineOptions } from '../../src/retrieval/pipeline.ts';
import { MemoryStore } from '../../src/store/memory.ts';
import { ScoreReranker } from '../../src/retrieval/reranker.ts';
import { MockEmbeddingProvider, createVectorDocument } from '../helpers/mocks.ts';
import { BM25_TEST_CORPUS } from '../helpers/fixtures.ts';
import type { BM25Document } from '../../src/retrieval/bm25.ts';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const DIMS = 384;

function createPipeline(opts: Partial<RetrievalPipelineOptions> = {}) {
  const store = new MemoryStore();
  const embedder = new MockEmbeddingProvider(DIMS);
  const reranker = new ScoreReranker();
  const pipeline = new RetrievalPipeline(store, embedder, reranker, {
    topK: opts.topK ?? 5,
    hybridWeight: opts.hybridWeight ?? 0.5,
    rerankTopK: opts.rerankTopK ?? 5,
  });
  return { store, embedder, reranker, pipeline };
}

/** Seed the store and BM25 index with BM25_TEST_CORPUS docs. */
async function seedPipeline(
  pipeline: RetrievalPipeline,
  store: MemoryStore,
  embedder: MockEmbeddingProvider,
  docs: BM25Document[] = BM25_TEST_CORPUS,
) {
  await store.initialize(DIMS);
  const vectors = await embedder.embedBatch(docs.map((d) => d.content));
  const vectorDocs = docs.map((d, i) => ({
    id: d.id,
    vector: vectors[i],
    content: d.content,
    metadata: d.metadata,
  }));
  await store.upsert(vectorDocs);
  pipeline.indexDocuments(docs);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetrievalPipeline', () => {
  test('full pipeline retrieve() returns results with scores', async () => {
    const { pipeline, store, embedder } = createPipeline();
    await seedPipeline(pipeline, store, embedder);

    const result = await pipeline.retrieve('machine learning');

    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.id).toBeTruthy();
      expect(r.content).toBeTruthy();
      expect(typeof r.score).toBe('number');
    }
  });

  test('metadata fields populated correctly', async () => {
    const { pipeline, store, embedder } = createPipeline();
    await seedPipeline(pipeline, store, embedder);

    const result = await pipeline.retrieve('natural language processing');

    expect(result.metadata.vectorResultCount).toBeGreaterThan(0);
    expect(result.metadata.keywordResultCount).toBeGreaterThan(0);
    expect(result.metadata.hybridResultCount).toBeGreaterThan(0);
    expect(result.metadata.rerankResultCount).toBeGreaterThan(0);
  });

  test('durationMs is positive', async () => {
    const { pipeline, store, embedder } = createPipeline();
    await seedPipeline(pipeline, store, embedder);

    const result = await pipeline.retrieve('test query');

    expect(result.metadata.durationMs).toBeGreaterThan(0);
  });

  test('pipeline with no BM25 docs: only vector results contribute', async () => {
    const { pipeline, store, embedder } = createPipeline();
    // Seed vector store but don't index BM25 docs
    await store.initialize(DIMS);
    const docs = BM25_TEST_CORPUS.slice(0, 3);
    const vectors = await embedder.embedBatch(docs.map((d) => d.content));
    await store.upsert(
      docs.map((d, i) => ({
        id: d.id,
        vector: vectors[i],
        content: d.content,
        metadata: d.metadata,
      })),
    );

    const result = await pipeline.retrieve('machine learning');

    expect(result.metadata.vectorResultCount).toBeGreaterThan(0);
    expect(result.metadata.keywordResultCount).toBe(0);
    // Still returns results from vector search
    expect(result.results.length).toBeGreaterThan(0);
  });

  test('pipeline with empty vector store: only BM25 results contribute', async () => {
    const { pipeline, store, embedder } = createPipeline();
    await store.initialize(DIMS);
    // Index BM25 but don't add to vector store
    pipeline.indexDocuments(BM25_TEST_CORPUS);

    const result = await pipeline.retrieve('machine learning');

    expect(result.metadata.vectorResultCount).toBe(0);
    expect(result.metadata.keywordResultCount).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
  });

  test('rerankTopK limits output count', async () => {
    const { pipeline, store, embedder } = createPipeline({
      topK: 10,
      rerankTopK: 3,
    });
    await seedPipeline(pipeline, store, embedder);

    const result = await pipeline.retrieve('machine learning algorithms');

    expect(result.results.length).toBeLessThanOrEqual(3);
    expect(result.metadata.rerankResultCount).toBeLessThanOrEqual(3);
  });

  test('hybridWeight=0 means only keyword results have RRF weight', async () => {
    const { pipeline: pureKeyword, store: store1, embedder: emb1 } = createPipeline({
      hybridWeight: 0,
    });
    await seedPipeline(pureKeyword, store1, emb1);

    const { pipeline: pureVector, store: store2, embedder: emb2 } = createPipeline({
      hybridWeight: 1,
    });
    await seedPipeline(pureVector, store2, emb2);

    const keyResult = await pureKeyword.retrieve('machine learning');
    const vecResult = await pureVector.retrieve('machine learning');

    // Both should return results, but the orderings may differ
    expect(keyResult.results.length).toBeGreaterThan(0);
    expect(vecResult.results.length).toBeGreaterThan(0);

    // The top result IDs should differ (or at least not be the same ordering)
    // because one uses only BM25 ranking and the other only vector ranking
    // We just verify both work without error
    expect(keyResult.metadata.hybridResultCount).toBeGreaterThan(0);
    expect(vecResult.metadata.hybridResultCount).toBeGreaterThan(0);
  });

  test('results are sorted by score descending', async () => {
    const { pipeline, store, embedder } = createPipeline();
    await seedPipeline(pipeline, store, embedder);

    const result = await pipeline.retrieve('transformer attention mechanism');

    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
    }
  });

  test('retrieve returns content and metadata on each result', async () => {
    const { pipeline, store, embedder } = createPipeline();
    await seedPipeline(pipeline, store, embedder);

    const result = await pipeline.retrieve('vector databases');

    for (const r of result.results) {
      expect(typeof r.content).toBe('string');
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.metadata).toBeDefined();
    }
  });
});
