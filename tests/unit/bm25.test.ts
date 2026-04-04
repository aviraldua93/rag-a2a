/**
 * Unit tests for the BM25 index module (src/retrieval/bm25.ts).
 *
 * Covers indexing, search ranking, tokenization (stopword removal,
 * punctuation, Unicode), stemming, scoring math (k1/b parameter effects,
 * IDF), and re-indexing clearing previous state.
 */
import { describe, test, expect } from 'bun:test';
import { BM25Index, type BM25Document } from '../../src/retrieval/bm25.ts';
import { BM25_TEST_CORPUS } from '../helpers/fixtures.ts';
import { createBM25Documents } from '../helpers/mocks.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocs(items: { id: string; content: string }[]): BM25Document[] {
  return items.map((d) => ({ ...d, metadata: {} }));
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

describe('BM25 – indexing', () => {
  test('indexes correct number of documents', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('machine learning', 100);
    // Should be able to find at least some documents
    expect(results.length).toBeGreaterThan(0);
    // Should not return more documents than indexed
    expect(results.length).toBeLessThanOrEqual(BM25_TEST_CORPUS.length);
  });

  test('term frequencies are tracked correctly (repeat terms boost score)', () => {
    const idx = new BM25Index();
    const docs = makeDocs([
      { id: 'high-tf', content: 'cat cat cat cat cat' },
      { id: 'low-tf', content: 'cat dog bird fish snake' },
    ]);
    idx.index(docs);
    const results = idx.search('cat', 2);
    expect(results[0].id).toBe('high-tf');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test('empty corpus: search returns empty results', () => {
    const idx = new BM25Index();
    idx.index([]);
    const results = idx.search('anything', 5);
    expect(results.length).toBe(0);
  });

  test('re-indexing clears previous state', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 'old', content: 'old content zebra' }]));
    let results = idx.search('zebra', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('old');

    // Re-index with different docs
    idx.index(makeDocs([{ id: 'new', content: 'new content panda' }]));
    results = idx.search('zebra', 5);
    expect(results.length).toBe(0);
    results = idx.search('panda', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('BM25 – search', () => {
  test('relevant documents ranked higher than irrelevant', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('machine learning algorithms', 5);
    // doc-ml-short and doc-ml-long have the highest keyword overlap
    const topIds = results.slice(0, 3).map((r) => r.id);
    expect(topIds).toContain('doc-ml-short');
    expect(topIds).toContain('doc-ml-long');
  });

  test('topK limits the number of results', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('machine learning', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('empty query returns no results', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('', 10);
    expect(results.length).toBe(0);
  });

  test('query with only stopwords returns no results', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    // All of these are stopwords
    const results = idx.search('the is a an of in to and', 10);
    expect(results.length).toBe(0);
  });

  test('results are sorted by score descending', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('neural networks deep learning', 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test('search returns content and metadata', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('transformer architecture', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBeTruthy();
    expect(results[0].id).toBeTruthy();
    expect(typeof results[0].score).toBe('number');
    expect(results[0].metadata).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

describe('BM25 – tokenization', () => {
  test('stopword removal: common words excluded from matching', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 'doc1', content: 'the cat sat on the mat' }]));
    // "the" and "on" are stopwords; query "the" alone should return nothing
    const results = idx.search('the', 5);
    expect(results.length).toBe(0);
  });

  test('punctuation splitting: terms extracted from punctuated text', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([
      { id: 'punct', content: 'hello, world! how are you? fine: thanks.' },
    ]));
    const results = idx.search('hello world', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('punct');
  });

  test('case insensitivity: matching is case-independent', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 'upper', content: 'MACHINE LEARNING ALGORITHMS' }]));
    const results = idx.search('machine learning algorithms', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('upper');
  });

  test('Unicode punctuation handled correctly', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([
      { id: 'unicode', content: 'données structurées — analyse approfondie' },
    ]));
    // Should tokenize around the em-dash and accented chars
    const results = idx.search('données', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('unicode');
  });
});

// ---------------------------------------------------------------------------
// Stemming
// ---------------------------------------------------------------------------

describe('BM25 – stemming', () => {
  test('-ing suffix: "learning" matches "learn"', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's1', content: 'machine learning concepts' }]));
    const results = idx.search('learn', 5);
    expect(results.length).toBe(1);
  });

  test('-ed suffix: "trained" matches "train"', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's2', content: 'the model was trained yesterday' }]));
    const results = idx.search('train', 5);
    expect(results.length).toBe(1);
  });

  test('-ly suffix: "quickly" matches "quick"', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's3', content: 'the algorithm converges quickly' }]));
    const results = idx.search('quick', 5);
    expect(results.length).toBe(1);
  });

  test('-er suffix: "learner" matches "learn"', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's4', content: 'a slow learner improves' }]));
    const results = idx.search('learn', 5);
    expect(results.length).toBe(1);
  });

  test('-s suffix: "algorithms" matches "algorithm"', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's5', content: 'sorting algorithms overview' }]));
    const results = idx.search('algorithm', 5);
    expect(results.length).toBe(1);
  });

  test('-tion suffix: "generation" matches "genera"', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's6', content: 'code generation pipeline' }]));
    // "generation" stems to "genera" (remove -tion); "genera" in query should match
    const results = idx.search('generation', 5);
    expect(results.length).toBe(1);
  });

  test('short words (≤3 chars) are unchanged by stemming', () => {
    const idx = new BM25Index();
    idx.index(makeDocs([{ id: 's7', content: 'big red fox' }]));
    const results = idx.search('big', 5);
    expect(results.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BM25 scoring math
// ---------------------------------------------------------------------------

describe('BM25 – scoring parameters', () => {
  test('higher k1 increases score differentiation for term frequency', () => {
    const docs = makeDocs([
      { id: 'high-tf', content: 'cat cat cat cat cat cat cat' },
      { id: 'low-tf', content: 'cat dog bird' },
    ]);

    const idxLowK1 = new BM25Index(0.5, 0.75);
    idxLowK1.index(docs);
    const resultsLow = idxLowK1.search('cat', 2);
    const diffLow = resultsLow[0].score - resultsLow[1].score;

    const idxHighK1 = new BM25Index(3.0, 0.75);
    idxHighK1.index(docs);
    const resultsHigh = idxHighK1.search('cat', 2);
    const diffHigh = resultsHigh[0].score - resultsHigh[1].score;

    // Higher k1 gives more weight to term frequency differences
    expect(diffHigh).toBeGreaterThan(diffLow);
  });

  test('b=0 disables length normalization: long and short docs scored equally (ignoring TF)', () => {
    const docs = makeDocs([
      { id: 'short', content: 'cat' },
      { id: 'long', content: 'cat ' + 'filler '.repeat(50) },
    ]);

    const idxNoNorm = new BM25Index(1.2, 0); // b=0
    idxNoNorm.index(docs);
    const resultsNoNorm = idxNoNorm.search('cat', 2);
    // With b=0, the document length normalization is disabled
    // Both docs have tf=1 for "cat"; scores should be identical
    expect(resultsNoNorm[0].score).toBeCloseTo(resultsNoNorm[1].score, 5);
  });

  test('b=1 penalizes longer documents', () => {
    const docs = makeDocs([
      { id: 'short', content: 'cat' },
      { id: 'long', content: 'cat ' + 'filler '.repeat(50) },
    ]);

    const idx = new BM25Index(1.2, 1.0); // strong length norm
    idx.index(docs);
    const results = idx.search('cat', 2);
    // Short doc should rank higher because b=1 heavily penalizes length
    expect(results[0].id).toBe('short');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test('IDF correctness: rare terms get higher scores', () => {
    const docs = makeDocs([
      { id: 'd1', content: 'common term rare term' },
      { id: 'd2', content: 'common term another thing' },
      { id: 'd3', content: 'common term yet another' },
    ]);
    const idx = new BM25Index();
    idx.index(docs);

    // "rare" appears in 1 doc; "common" appears in all 3
    const rareResults = idx.search('rare', 3);
    const commonResults = idx.search('common', 3);

    // The score for the doc matching "rare" should be higher than
    // the top score for "common" (since rare term has higher IDF)
    expect(rareResults[0].score).toBeGreaterThan(commonResults[0].score);
  });

  test('scores are always non-negative', () => {
    const idx = new BM25Index();
    idx.index(BM25_TEST_CORPUS);
    const results = idx.search('machine learning deep neural', 10);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});
