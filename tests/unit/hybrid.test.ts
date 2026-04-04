/**
 * Unit tests for hybrid search via Reciprocal Rank Fusion
 * (src/retrieval/hybrid.ts).
 *
 * Covers: overlapping results, disjoint results, single-source results,
 * pure keyword (vectorWeight=0), pure vector (vectorWeight=1), k parameter
 * effect, score monotonicity, and deduplication.
 */
import { describe, test, expect } from 'bun:test';
import { reciprocalRankFusion, type HybridSearchOptions } from '../../src/retrieval/hybrid.ts';
import type { SearchResult } from '../../src/store/types.ts';
import { createSearchResults } from '../helpers/mocks.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(id: string, score: number): SearchResult {
  return { id, score, content: `Content for ${id}`, metadata: {} };
}

function defaultOpts(overrides: Partial<HybridSearchOptions> = {}): HybridSearchOptions {
  return { vectorWeight: 0.5, k: 60, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hybrid search – reciprocalRankFusion', () => {
  test('overlapping results: shared docs get summed scores from both lists', () => {
    const vector = [makeResult('shared', 0.9), makeResult('vec-only', 0.8)];
    const keyword = [makeResult('shared', 0.95), makeResult('kw-only', 0.85)];

    const fused = reciprocalRankFusion(vector, keyword, defaultOpts());

    // "shared" should be ranked first because it gets score from both lists
    expect(fused[0].id).toBe('shared');
    // "shared" score should be greater than either single-source result
    const sharedScore = fused.find((r) => r.id === 'shared')!.score;
    const vecOnlyScore = fused.find((r) => r.id === 'vec-only')!.score;
    const kwOnlyScore = fused.find((r) => r.id === 'kw-only')!.score;
    expect(sharedScore).toBeGreaterThan(vecOnlyScore);
    expect(sharedScore).toBeGreaterThan(kwOnlyScore);
  });

  test('disjoint results: all docs appear in output', () => {
    const vector = [makeResult('v1', 0.9), makeResult('v2', 0.8)];
    const keyword = [makeResult('k1', 0.9), makeResult('k2', 0.8)];

    const fused = reciprocalRankFusion(vector, keyword, defaultOpts());

    const ids = fused.map((r) => r.id);
    expect(ids).toContain('v1');
    expect(ids).toContain('v2');
    expect(ids).toContain('k1');
    expect(ids).toContain('k2');
    expect(fused.length).toBe(4);
  });

  test('single-source results (empty keyword): only vector results appear', () => {
    const vector = [makeResult('v1', 0.9), makeResult('v2', 0.8)];

    const fused = reciprocalRankFusion(vector, [], defaultOpts());

    expect(fused.length).toBe(2);
    expect(fused[0].id).toBe('v1');
    expect(fused[1].id).toBe('v2');
  });

  test('vectorWeight=0 (pure keyword): vector results get zero contribution', () => {
    const vector = [makeResult('v1', 0.99)];
    const keyword = [makeResult('k1', 0.5)];

    const fused = reciprocalRankFusion(vector, keyword, defaultOpts({ vectorWeight: 0 }));

    // k1 should be first since vector weight is 0
    expect(fused[0].id).toBe('k1');
    // v1 should have score 0 (weight=0)
    const v1Score = fused.find((r) => r.id === 'v1')!.score;
    expect(v1Score).toBe(0);
  });

  test('vectorWeight=1 (pure vector): keyword results get zero contribution', () => {
    const vector = [makeResult('v1', 0.99)];
    const keyword = [makeResult('k1', 0.5)];

    const fused = reciprocalRankFusion(vector, keyword, defaultOpts({ vectorWeight: 1 }));

    expect(fused[0].id).toBe('v1');
    const k1Score = fused.find((r) => r.id === 'k1')!.score;
    expect(k1Score).toBe(0);
  });

  test('k parameter effect: smaller k amplifies rank differences', () => {
    const vector = [makeResult('r1', 0.9), makeResult('r2', 0.8)];
    const keyword: SearchResult[] = [];

    // Small k → bigger gap between rank 1 and rank 2
    const fusedSmallK = reciprocalRankFusion(vector, keyword, defaultOpts({ k: 1 }));
    const diffSmall = fusedSmallK[0].score - fusedSmallK[1].score;

    // Large k → smaller gap between rank 1 and rank 2
    const fusedLargeK = reciprocalRankFusion(vector, keyword, defaultOpts({ k: 100 }));
    const diffLarge = fusedLargeK[0].score - fusedLargeK[1].score;

    expect(diffSmall).toBeGreaterThan(diffLarge);
  });

  test('score monotonicity: results are sorted by descending combined score', () => {
    const vector = createSearchResults(5);
    const keyword = createSearchResults(5);

    const fused = reciprocalRankFusion(vector, keyword, defaultOpts());

    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1].score).toBeGreaterThanOrEqual(fused[i].score);
    }
  });

  test('deduplication: same doc in both lists appears only once in output', () => {
    const shared = makeResult('shared-doc', 0.9);
    const vector = [shared, makeResult('v2', 0.7)];
    const keyword = [{ ...shared, score: 0.95 }, makeResult('k2', 0.6)];

    const fused = reciprocalRankFusion(vector, keyword, defaultOpts());

    const sharedCount = fused.filter((r) => r.id === 'shared-doc').length;
    expect(sharedCount).toBe(1);
  });

  test('both empty: returns empty array', () => {
    const fused = reciprocalRankFusion([], [], defaultOpts());
    expect(fused.length).toBe(0);
  });

  test('RRF score formula is correct for known inputs', () => {
    // rank 1 (0-indexed 0) → 1/(k+1), rank 2 (0-indexed 1) → 1/(k+2)
    const vector = [makeResult('d1', 0.9)];
    const keyword = [makeResult('d1', 0.8)];
    const k = 60;
    const vw = 0.5;

    const fused = reciprocalRankFusion(vector, keyword, { vectorWeight: vw, k });

    const expectedScore = vw * (1 / (k + 1)) + (1 - vw) * (1 / (k + 1));
    expect(fused[0].score).toBeCloseTo(expectedScore, 10);
  });
});
