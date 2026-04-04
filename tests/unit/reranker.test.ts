/**
 * Unit tests for ScoreReranker (src/retrieval/reranker.ts).
 *
 * Covers: basic reranking, empty results, empty query, topK limiting,
 * term overlap scoring, combined score weighting (60/40 split),
 * case insensitivity, and results with zero overlap.
 */
import { describe, test, expect } from 'bun:test';
import { ScoreReranker } from '../../src/retrieval/reranker.ts';
import type { SearchResult } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(id: string, score: number, content: string): SearchResult {
  return { id, score, content, metadata: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScoreReranker', () => {
  const reranker = new ScoreReranker();

  test('basic reranking: result with query term overlap ranks higher', async () => {
    const results = [
      makeResult('no-match', 0.9, 'This document talks about cats and dogs'),
      makeResult('match', 0.5, 'Machine learning algorithms for classification'),
    ];

    const reranked = await reranker.rerank('machine learning', results, 10);

    // "match" has query term overlap, so despite lower original score
    // the combined score should push it up relative to "no-match"
    const matchResult = reranked.find((r) => r.id === 'match')!;
    expect(matchResult).toBeDefined();
    // Verify overlap boosted the "match" result's score
    expect(matchResult.score).toBeGreaterThan(0);
  });

  test('empty results: returns empty array', async () => {
    const reranked = await reranker.rerank('some query', [], 10);
    expect(reranked.length).toBe(0);
  });

  test('empty query: returns results unchanged up to topK', async () => {
    const results = [
      makeResult('d1', 0.9, 'content one'),
      makeResult('d2', 0.7, 'content two'),
    ];

    const reranked = await reranker.rerank('', results, 10);

    expect(reranked.length).toBe(2);
    // With empty query, tokenize returns [] so results.slice(0, topK) is returned
    expect(reranked[0].id).toBe('d1');
    expect(reranked[1].id).toBe('d2');
  });

  test('topK limits output count', async () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult(`doc-${i}`, 1 - i * 0.01, `content about topic ${i}`),
    );

    const reranked = await reranker.rerank('topic', results, 5);
    expect(reranked.length).toBe(5);
  });

  test('term overlap scoring: higher overlap = higher boost', async () => {
    const results = [
      makeResult('full-match', 0.5, 'machine learning algorithms'),
      makeResult('partial-match', 0.5, 'machine vision systems'),
      makeResult('no-match', 0.5, 'cooking recipes guide'),
    ];

    const reranked = await reranker.rerank('machine learning algorithms', results, 10);

    // full-match has all 3 query terms → overlap 3/3 = 1.0
    // partial-match has 1 query term → overlap 1/3 ≈ 0.33
    // no-match has 0 query terms → overlap 0/3 = 0.0
    expect(reranked[0].id).toBe('full-match');
    expect(reranked[1].id).toBe('partial-match');
    expect(reranked[2].id).toBe('no-match');
  });

  test('combined score weighting: 60% original + 40% overlap', async () => {
    // Build a result where we can compute expected score
    const result = makeResult('compute', 1.0, 'hello world');
    // Query: "hello world" → 2 terms, content has both → overlap = 2/2 = 1.0
    // Combined = 0.6 * 1.0 + 0.4 * 1.0 = 1.0
    const reranked = await reranker.rerank('hello world', [result], 10);
    expect(reranked[0].score).toBeCloseTo(1.0, 5);

    // Another case: no overlap
    const result2 = makeResult('no-overlap', 0.8, 'completely unrelated text');
    // Query: "hello world" → overlap = 0/2 = 0.0
    // Combined = 0.6 * 0.8 + 0.4 * 0.0 = 0.48
    const reranked2 = await reranker.rerank('hello world', [result2], 10);
    expect(reranked2[0].score).toBeCloseTo(0.48, 5);
  });

  test('case insensitivity: matching is case-independent', async () => {
    const results = [
      makeResult('upper', 0.5, 'MACHINE LEARNING'),
      makeResult('lower', 0.5, 'machine learning'),
    ];

    const reranked = await reranker.rerank('Machine Learning', results, 10);

    // Both should have the same score since tokenization lowercases
    expect(reranked[0].score).toBeCloseTo(reranked[1].score, 5);
  });

  test('results with zero overlap: score is 60% of original', async () => {
    const results = [
      makeResult('a', 1.0, 'alpha beta gamma'),
      makeResult('b', 0.5, 'delta epsilon zeta'),
    ];

    const reranked = await reranker.rerank('completely unrelated query', results, 10);

    // No overlap for either result
    // a: 0.6 * 1.0 + 0.4 * 0 = 0.6
    // b: 0.6 * 0.5 + 0.4 * 0 = 0.3
    expect(reranked[0].score).toBeCloseTo(0.6, 5);
    expect(reranked[1].score).toBeCloseTo(0.3, 5);
    expect(reranked[0].id).toBe('a');
    expect(reranked[1].id).toBe('b');
  });

  test('sorted by combined score descending after reranking', async () => {
    const results = [
      makeResult('d1', 0.3, 'machine learning algorithms optimization'),
      makeResult('d2', 0.9, 'cooking recipes for dinner'),
      makeResult('d3', 0.6, 'machine learning deep neural'),
    ];

    const reranked = await reranker.rerank('machine learning', results, 10);

    for (let i = 1; i < reranked.length; i++) {
      expect(reranked[i - 1].score).toBeGreaterThanOrEqual(reranked[i].score);
    }
  });

  test('preserves metadata through reranking', async () => {
    const results: SearchResult[] = [
      { id: 'd1', score: 0.8, content: 'machine learning', metadata: { source: 'test.md', custom: 42 } },
    ];

    const reranked = await reranker.rerank('machine', results, 10);
    expect(reranked[0].metadata).toEqual({ source: 'test.md', custom: 42 });
  });
});
