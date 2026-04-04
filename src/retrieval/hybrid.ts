import type { SearchResult } from '../store/types.ts';

/** Options for hybrid search via Reciprocal Rank Fusion. */
export interface HybridSearchOptions {
  /** Weight for vector results (0–1). Keyword weight is 1 − vectorWeight. */
  vectorWeight: number;
  /** RRF constant (default 60). Higher values reduce the impact of rank position. */
  k: number;
}

/**
 * Combine vector and keyword search results using Reciprocal Rank Fusion (RRF).
 *
 * For each result list, a document at rank r receives a score of 1 / (k + r),
 * where r is 1-based. The vector and keyword contributions are weighted by
 * `vectorWeight` and `(1 - vectorWeight)` respectively. Documents appearing in
 * both lists receive the sum of their weighted RRF scores. The final list is
 * deduplicated and sorted by combined score descending.
 */
export function reciprocalRankFusion(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  options: HybridSearchOptions,
): SearchResult[] {
  const { vectorWeight, k } = options;
  const keywordWeight = 1 - vectorWeight;

  const scoreMap = new Map<string, number>();
  const resultMap = new Map<string, SearchResult>();

  // Score vector results
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const result = vectorResults[rank];
    const rrfScore = vectorWeight * (1 / (k + rank + 1));
    scoreMap.set(result.id, (scoreMap.get(result.id) ?? 0) + rrfScore);
    if (!resultMap.has(result.id)) {
      resultMap.set(result.id, result);
    }
  }

  // Score keyword results
  for (let rank = 0; rank < keywordResults.length; rank++) {
    const result = keywordResults[rank];
    const rrfScore = keywordWeight * (1 / (k + rank + 1));
    scoreMap.set(result.id, (scoreMap.get(result.id) ?? 0) + rrfScore);
    if (!resultMap.has(result.id)) {
      resultMap.set(result.id, result);
    }
  }

  // Build final results with combined scores
  const combined: SearchResult[] = [];
  for (const [id, score] of scoreMap) {
    const original = resultMap.get(id)!;
    combined.push({
      id: original.id,
      content: original.content,
      score,
      metadata: original.metadata,
    });
  }

  combined.sort((a, b) => b.score - a.score);
  return combined;
}
