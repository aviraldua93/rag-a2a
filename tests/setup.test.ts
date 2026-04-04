/**
 * Smoke tests for the test infrastructure itself.
 * Verifies mocks, factories, and fixtures work correctly.
 */
import { describe, test, expect } from 'bun:test';
import {
  MockVectorStore,
  MockEmbeddingProvider,
  MockTestGenerator,
  createSearchResult,
  createSearchResults,
  createBM25Document,
  createBM25Documents,
  createRawDocument,
  createVectorDocument,
  deterministicVector,
  TEST_DOCUMENTS,
  TEST_RAW_DOCUMENTS,
  TEST_SEARCH_RESULTS,
} from './helpers/mocks.ts';
import {
  BM25_TEST_CORPUS,
  RELEVANCE_MAP,
  GOLDEN_DATASET,
  createRankedResults,
  LONG_DOCUMENT_CONTENT,
  SHORT_DOCUMENT_CONTENT,
  EMPTY_DOCUMENT_CONTENT,
  SINGLE_PARAGRAPH_CONTENT,
  SAMPLE_QUERIES,
  getTestPort,
} from './helpers/fixtures.ts';

// ---------------------------------------------------------------------------
// MockVectorStore
// ---------------------------------------------------------------------------

describe('MockVectorStore', () => {
  test('initializes with vector size', async () => {
    const store = new MockVectorStore();
    await store.initialize(384);
    expect(store.vectorSize).toBe(384);
  });

  test('upserts and counts documents', async () => {
    const store = new MockVectorStore();
    await store.initialize(4);
    const doc = createVectorDocument({ id: 'test-1' }, 4);
    await store.upsert([doc]);
    expect(await store.count()).toBe(1);
    expect(store.calls.upsert.length).toBe(1);
  });

  test('searches by cosine similarity', async () => {
    const store = new MockVectorStore();
    await store.initialize(4);
    await store.upsert([
      { id: 'a', vector: [1, 0, 0, 0], content: 'doc a', metadata: {} },
      { id: 'b', vector: [0, 1, 0, 0], content: 'doc b', metadata: {} },
    ]);
    const results = await store.search([1, 0, 0, 0], 2);
    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  test('deletes documents', async () => {
    const store = new MockVectorStore();
    await store.initialize(4);
    await store.upsert([
      { id: 'x', vector: [1, 0, 0, 0], content: 'x', metadata: {} },
    ]);
    await store.delete(['x']);
    expect(await store.count()).toBe(0);
  });

  test('tracks all calls', async () => {
    const store = new MockVectorStore();
    await store.initialize(10);
    await store.count();
    await store.count();
    expect(store.calls.initialize).toEqual([10]);
    expect(store.calls.count).toBe(2);
  });

  test('reset clears data and call tracking', async () => {
    const store = new MockVectorStore();
    await store.initialize(4);
    await store.upsert([
      { id: 'z', vector: [1, 0, 0, 0], content: 'z', metadata: {} },
    ]);
    store.reset();
    expect(await store.count()).toBe(0);
    expect(store.calls.upsert.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MockEmbeddingProvider
// ---------------------------------------------------------------------------

describe('MockEmbeddingProvider', () => {
  test('embeds with correct dimensions', async () => {
    const embedder = new MockEmbeddingProvider(128);
    const vec = await embedder.embed('hello');
    expect(vec.length).toBe(128);
    expect(embedder.dimensions).toBe(128);
  });

  test('produces deterministic vectors', async () => {
    const embedder = new MockEmbeddingProvider();
    const v1 = await embedder.embed('same text');
    const v2 = await embedder.embed('same text');
    expect(v1).toEqual(v2);
  });

  test('produces different vectors for different texts', async () => {
    const embedder = new MockEmbeddingProvider();
    const v1 = await embedder.embed('text a');
    const v2 = await embedder.embed('text b');
    expect(v1).not.toEqual(v2);
  });

  test('embedBatch works', async () => {
    const embedder = new MockEmbeddingProvider(64);
    const vecs = await embedder.embedBatch(['a', 'b', 'c']);
    expect(vecs.length).toBe(3);
    expect(vecs[0].length).toBe(64);
  });

  test('tracks calls', async () => {
    const embedder = new MockEmbeddingProvider();
    await embedder.embed('x');
    await embedder.embedBatch(['y', 'z']);
    expect(embedder.calls.embed).toEqual(['x']);
    expect(embedder.calls.embedBatch).toEqual([['y', 'z']]);
  });
});

// ---------------------------------------------------------------------------
// MockTestGenerator
// ---------------------------------------------------------------------------

describe('MockTestGenerator', () => {
  test('generates deterministic answers', async () => {
    const gen = new MockTestGenerator();
    const result = await gen.generate('What is ML?', TEST_SEARCH_RESULTS);
    expect(result.answer).toContain('Based on the provided documents');
    expect(result.model).toBe('mock-test');
    expect(result.sources.length).toBe(TEST_SEARCH_RESULTS.length);
  });

  test('handles empty contexts', async () => {
    const gen = new MockTestGenerator();
    const result = await gen.generate('query', []);
    expect(result.answer).toContain('cannot find the answer');
  });

  test('generateStream yields source, text, and done chunks', async () => {
    const gen = new MockTestGenerator();
    const chunks: { type: string }[] = [];
    for await (const chunk of gen.generateStream('query', [
      createSearchResult(),
    ])) {
      chunks.push(chunk);
    }
    expect(chunks.some((c) => c.type === 'source')).toBe(true);
    expect(chunks.some((c) => c.type === 'text')).toBe(true);
    expect(chunks[chunks.length - 1].type).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe('Factory functions', () => {
  test('createSearchResult creates valid result', () => {
    const result = createSearchResult({ id: 'custom', score: 0.99 });
    expect(result.id).toBe('custom');
    expect(result.score).toBe(0.99);
    expect(result.content).toBeTruthy();
    expect(result.metadata).toBeDefined();
  });

  test('createSearchResults creates N results with sequential IDs', () => {
    const results = createSearchResults(5);
    expect(results.length).toBe(5);
    expect(results[0].id).toBe('doc-1');
    expect(results[4].id).toBe('doc-5');
    expect(results[0].score).toBeGreaterThan(results[4].score);
  });

  test('createBM25Document creates valid document', () => {
    const doc = createBM25Document({ id: 'bm25-test' });
    expect(doc.id).toBe('bm25-test');
    expect(doc.content).toBeTruthy();
  });

  test('createBM25Documents creates N documents', () => {
    const docs = createBM25Documents(3, ['content a', 'content b', 'content c']);
    expect(docs.length).toBe(3);
    expect(docs[0].content).toBe('content a');
    expect(docs[2].content).toBe('content c');
  });

  test('createRawDocument creates valid document', () => {
    const doc = createRawDocument({ id: 'raw-test' });
    expect(doc.id).toBe('raw-test');
    expect(doc.metadata.source).toBeTruthy();
    expect(doc.metadata.filename).toBeTruthy();
    expect(doc.metadata.extension).toBeTruthy();
  });

  test('createVectorDocument creates doc with deterministic vector', () => {
    const doc = createVectorDocument({ id: 'vec-1' }, 128);
    expect(doc.vector.length).toBe(128);
    expect(doc.content).toBeTruthy();
  });

  test('deterministicVector is deterministic', () => {
    const v1 = deterministicVector('test', 64);
    const v2 = deterministicVector('test', 64);
    expect(v1).toEqual(v2);
  });

  test('deterministicVector produces unit-length vectors', () => {
    const vec = deterministicVector('normalized', 384);
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// Pre-built datasets
// ---------------------------------------------------------------------------

describe('Pre-built datasets', () => {
  test('TEST_DOCUMENTS has 10 diverse documents', () => {
    expect(TEST_DOCUMENTS.length).toBe(10);
    const ids = new Set(TEST_DOCUMENTS.map((d) => d.id));
    expect(ids.size).toBe(10);
  });

  test('TEST_RAW_DOCUMENTS has valid structure', () => {
    for (const doc of TEST_RAW_DOCUMENTS) {
      expect(doc.id).toBeTruthy();
      expect(doc.content).toBeTruthy();
      expect(doc.metadata.source).toBeTruthy();
      expect(doc.metadata.filename).toBeTruthy();
    }
  });

  test('TEST_SEARCH_RESULTS has 5 sorted results', () => {
    expect(TEST_SEARCH_RESULTS.length).toBe(5);
    for (let i = 1; i < TEST_SEARCH_RESULTS.length; i++) {
      expect(TEST_SEARCH_RESULTS[i - 1].score).toBeGreaterThan(
        TEST_SEARCH_RESULTS[i].score,
      );
    }
  });

  test('BM25_TEST_CORPUS has 10 documents', () => {
    expect(BM25_TEST_CORPUS.length).toBe(10);
  });

  test('RELEVANCE_MAP has entries for all topics', () => {
    expect(Object.keys(RELEVANCE_MAP).length).toBeGreaterThanOrEqual(5);
  });

  test('GOLDEN_DATASET matches RELEVANCE_MAP', () => {
    expect(GOLDEN_DATASET.length).toBe(Object.keys(RELEVANCE_MAP).length);
    for (const example of GOLDEN_DATASET) {
      expect(example.query).toBeTruthy();
      expect(example.relevantDocumentIds.length).toBeGreaterThan(0);
    }
  });

  test('createRankedResults creates correct structure', () => {
    const { results, relevantIds } = createRankedResults([0, 2, 4], 10);
    expect(results.length).toBe(10);
    expect(relevantIds.size).toBe(3);
    expect(relevantIds.has(results[0].id)).toBe(true);
    expect(relevantIds.has(results[2].id)).toBe(true);
    expect(relevantIds.has(results[4].id)).toBe(true);
    expect(relevantIds.has(results[1].id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('Fixtures', () => {
  test('SAMPLE_QUERIES has queries', () => {
    expect(SAMPLE_QUERIES.length).toBeGreaterThan(0);
  });

  test('getTestPort returns high port', () => {
    const port = getTestPort();
    expect(port).toBeGreaterThanOrEqual(49200);
    expect(port).toBeLessThan(50000);
  });

  test('document content fixtures are defined', () => {
    expect(LONG_DOCUMENT_CONTENT.length).toBeGreaterThan(500);
    expect(SHORT_DOCUMENT_CONTENT.length).toBeGreaterThan(0);
    expect(EMPTY_DOCUMENT_CONTENT).toBe('');
    expect(SINGLE_PARAGRAPH_CONTENT.length).toBeGreaterThan(100);
  });
});
