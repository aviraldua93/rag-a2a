/**
 * Unit tests for evaluation metrics:
 *   MRR, Precision@K, Recall@K, NDCG, contextRelevance
 */
import { describe, test, expect } from 'bun:test';
import {
  meanReciprocalRank,
  precisionAtK,
  recallAtK,
  ndcg,
  contextRelevance,
} from '../../src/evaluation/metrics.ts';
import { createRankedResults, createSearchResults } from '../helpers/index.ts';
import type { SearchResult } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// Helper to build SearchResult arrays with known IDs
// ---------------------------------------------------------------------------

function makeResults(ids: string[]): SearchResult[] {
  return ids.map((id, i) => ({
    id,
    score: 1 - i * 0.1,
    content: `Content for ${id}`,
    metadata: { source: `${id}.md` },
  }));
}

// ---------------------------------------------------------------------------
// MRR (Mean Reciprocal Rank)
// ---------------------------------------------------------------------------

describe('meanReciprocalRank', () => {
  test('returns 1.0 when the first result is relevant', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['a']);
    expect(meanReciprocalRank(results, relevant)).toBe(1.0);
  });

  test('returns 0.5 when the second result is the first relevant', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['b']);
    expect(meanReciprocalRank(results, relevant)).toBe(0.5);
  });

  test('returns reciprocal of last position when only last result is relevant', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['e']);
    expect(meanReciprocalRank(results, relevant)).toBe(1 / 5);
  });

  test('returns 0 when no results are relevant', () => {
    const results = makeResults(['a', 'b', 'c']);
    const relevant = new Set(['z']);
    expect(meanReciprocalRank(results, relevant)).toBe(0);
  });

  test('returns 0 for empty results', () => {
    expect(meanReciprocalRank([], new Set(['a']))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Precision@K
// ---------------------------------------------------------------------------

describe('precisionAtK', () => {
  test('returns 1.0 when all top-K results are relevant', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['a', 'b', 'c']);
    expect(precisionAtK(results, relevant, 3)).toBe(1.0);
  });

  test('returns 0.0 when no top-K results are relevant', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['x', 'y', 'z']);
    expect(precisionAtK(results, relevant, 3)).toBe(0.0);
  });

  test('returns correct fraction for partial relevance', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['a', 'c']); // 2 of top 5
    expect(precisionAtK(results, relevant, 5)).toBeCloseTo(0.4, 10);
  });

  test('handles K larger than results array', () => {
    const results = makeResults(['a', 'b']);
    const relevant = new Set(['a', 'b']);
    // top-2 of K=5 → 2/5 = 0.4
    expect(precisionAtK(results, relevant, 5)).toBeCloseTo(0.4, 10);
  });
});

// ---------------------------------------------------------------------------
// Recall@K
// ---------------------------------------------------------------------------

describe('recallAtK', () => {
  test('returns 1.0 when all relevant docs are found in top-K', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['a', 'b']);
    expect(recallAtK(results, relevant, 5)).toBe(1.0);
  });

  test('returns 0.0 when none of the relevant docs are in top-K', () => {
    const results = makeResults(['a', 'b', 'c']);
    const relevant = new Set(['x', 'y']);
    expect(recallAtK(results, relevant, 3)).toBe(0.0);
  });

  test('returns 0 when relevant set is empty', () => {
    const results = makeResults(['a', 'b', 'c']);
    const relevant = new Set<string>();
    expect(recallAtK(results, relevant, 3)).toBe(0);
  });

  test('returns correct fraction when some relevant docs are found', () => {
    const results = makeResults(['a', 'b', 'c', 'd', 'e']);
    const relevant = new Set(['a', 'c', 'x']); // 2 of 3 found
    expect(recallAtK(results, relevant, 5)).toBeCloseTo(2 / 3, 10);
  });
});

// ---------------------------------------------------------------------------
// NDCG (Normalized Discounted Cumulative Gain)
// ---------------------------------------------------------------------------

describe('ndcg', () => {
  test('returns 1.0 for perfect ranking (all relevant at top)', () => {
    // Positions 0,1 are relevant; 2 relevant docs total in top-3
    const results = makeResults(['r1', 'r2', 'x', 'y', 'z']);
    const relevant = new Set(['r1', 'r2']);
    expect(ndcg(results, relevant, 5)).toBeCloseTo(1.0, 10);
  });

  test('returns < 1 for inverse ranking (relevant at bottom)', () => {
    const results = makeResults(['x', 'y', 'z', 'r1', 'r2']);
    const relevant = new Set(['r1', 'r2']);
    const score = ndcg(results, relevant, 5);
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0);
  });

  test('returns 0 when no results are relevant', () => {
    const results = makeResults(['a', 'b', 'c']);
    const relevant = new Set(['x']);
    expect(ndcg(results, relevant, 3)).toBe(0);
  });

  test('returns 0 for empty results', () => {
    expect(ndcg([], new Set(['a']), 5)).toBe(0);
  });

  test('returns 0 when relevant set is empty (idcg = 0)', () => {
    const results = makeResults(['a', 'b', 'c']);
    const relevant = new Set<string>();
    expect(ndcg(results, relevant, 3)).toBe(0);
  });

  test('calculates correct DCG for known arrangement', () => {
    // 5 results, relevant at positions 0 and 2
    const results = makeResults(['r1', 'x', 'r2', 'y', 'z']);
    const relevant = new Set(['r1', 'r2']);
    // DCG = 1/log2(2) + 0/log2(3) + 1/log2(4) = 1 + 0 + 0.5 = 1.5
    // IDCG = 1/log2(2) + 1/log2(3) = 1 + 0.6309... = 1.6309...
    // NDCG = 1.5 / 1.6309... ≈ 0.9197...
    const score = ndcg(results, relevant, 5);
    expect(score).toBeCloseTo(1.5 / (1 / Math.log2(2) + 1 / Math.log2(3)), 5);
  });
});

// ---------------------------------------------------------------------------
// contextRelevance
// ---------------------------------------------------------------------------

describe('contextRelevance', () => {
  test('returns 1.0 when all query terms appear in all results', () => {
    const results: SearchResult[] = [
      { id: '1', score: 0.9, content: 'machine learning algorithms', metadata: {} },
      { id: '2', score: 0.8, content: 'machine learning algorithms overview', metadata: {} },
    ];
    // Query terms (>2 chars): "machine", "learning", "algorithms"
    const score = contextRelevance('machine learning algorithms', results);
    expect(score).toBeCloseTo(1.0, 5);
  });

  test('returns 0 when no query terms appear in results', () => {
    const results: SearchResult[] = [
      { id: '1', score: 0.9, content: 'totally unrelated content here', metadata: {} },
    ];
    // Query terms: "quantum", "physics" — none in content
    const score = contextRelevance('quantum physics', results);
    expect(score).toBe(0);
  });

  test('returns 0 for empty results', () => {
    expect(contextRelevance('some query', [])).toBe(0);
  });

  test('filters out short query terms (≤2 chars)', () => {
    const results: SearchResult[] = [
      { id: '1', score: 0.9, content: 'information about AI and ML topics', metadata: {} },
    ];
    // "is" and "AI" are ≤2 chars, filtered out. Only "the", wait "the" is 3 chars
    // Actually: "what" (4), "is" (2 - filtered), "the" (3), "best" (4)
    // Content has: "information", "about", "and", "topics" — no overlap with "what", "the", "best"
    const score = contextRelevance('what is the best', results);
    // queryTerms: "what", "the", "best" (3 terms, 3 chars+)
    // Content words >2: "information", "about", "topics"
    // overlap: 0
    expect(score).toBe(0);
  });

  test('returns partial score when some query terms match', () => {
    const results: SearchResult[] = [
      { id: '1', score: 0.9, content: 'machine learning is a broad field', metadata: {} },
    ];
    // query terms (>2 chars): "machine", "learning", "deep", "neural"
    // content has: "machine", "learning" (2 of 4 match)
    const score = contextRelevance('machine learning deep neural', results);
    expect(score).toBeCloseTo(0.5, 5);
  });
});
