import type { SearchResult } from '../store/types.ts';

/** Mean Reciprocal Rank - measures how high the first relevant result appears */
export function meanReciprocalRank(
  results: SearchResult[],
  relevantIds: Set<string>
): number {
  for (let i = 0; i < results.length; i++) {
    if (relevantIds.has(results[i]!.id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/** Precision@K - fraction of top-K results that are relevant */
export function precisionAtK(
  results: SearchResult[],
  relevantIds: Set<string>,
  k: number
): number {
  const topK = results.slice(0, k);
  const relevant = topK.filter(r => relevantIds.has(r.id)).length;
  return relevant / k;
}

/** Recall@K - fraction of relevant documents found in top-K */
export function recallAtK(
  results: SearchResult[],
  relevantIds: Set<string>,
  k: number
): number {
  if (relevantIds.size === 0) return 0;
  const topK = results.slice(0, k);
  const found = topK.filter(r => relevantIds.has(r.id)).length;
  return found / relevantIds.size;
}

/** Normalized Discounted Cumulative Gain */
export function ndcg(
  results: SearchResult[],
  relevantIds: Set<string>,
  k: number
): number {
  const topK = results.slice(0, k);

  // DCG: sum of relevance / log2(position + 1)
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = relevantIds.has(topK[i]!.id) ? 1 : 0;
    dcg += rel / Math.log2(i + 2); // i+2 because position is 1-indexed
  }

  // Ideal DCG: all relevant docs at the top
  const idealCount = Math.min(relevantIds.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

/** Context relevance score — how much of the retrieved content is relevant to the query */
export function contextRelevance(
  query: string,
  results: SearchResult[]
): number {
  if (results.length === 0) return 0;

  const queryTerms = new Set(
    query.toLowerCase().split(/\W+/).filter(t => t.length > 2)
  );

  let totalOverlap = 0;
  for (const result of results) {
    const contentTerms = new Set(
      result.content.toLowerCase().split(/\W+/).filter(t => t.length > 2)
    );
    let overlap = 0;
    for (const term of queryTerms) {
      if (contentTerms.has(term)) overlap++;
    }
    totalOverlap += queryTerms.size > 0 ? overlap / queryTerms.size : 0;
  }

  return totalOverlap / results.length;
}

export interface EvaluationResult {
  query: string;
  mrr: number;
  precisionAt5: number;
  recallAt5: number;
  ndcgAt5: number;
  contextRelevance: number;
}

export interface EvaluationSummary {
  totalQueries: number;
  avgMRR: number;
  avgPrecisionAt5: number;
  avgRecallAt5: number;
  avgNDCGAt5: number;
  avgContextRelevance: number;
  results: EvaluationResult[];
}
