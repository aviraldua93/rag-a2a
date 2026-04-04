import type { RetrievalPipeline } from '../retrieval/pipeline.ts';
import {
  meanReciprocalRank,
  precisionAtK,
  recallAtK,
  ndcg,
  contextRelevance,
  type EvaluationResult,
  type EvaluationSummary,
} from './metrics.ts';

export interface GoldenExample {
  query: string;
  relevantDocumentIds: string[];
  expectedAnswer?: string;
}

/** Load golden dataset from JSON file */
export async function loadGoldenDataset(path: string): Promise<GoldenExample[]> {
  const file = Bun.file(path);
  const text = await file.text();
  return JSON.parse(text) as GoldenExample[];
}

/** Run evaluation against the retrieval pipeline */
export async function runEvaluation(
  pipeline: RetrievalPipeline,
  dataset: GoldenExample[],
): Promise<EvaluationSummary> {
  const results: EvaluationResult[] = [];

  for (const example of dataset) {
    const relevantIds = new Set(example.relevantDocumentIds);
    const retrieval = await pipeline.retrieve(example.query);

    results.push({
      query: example.query,
      mrr: meanReciprocalRank(retrieval.results, relevantIds),
      precisionAt5: precisionAtK(retrieval.results, relevantIds, 5),
      recallAt5: recallAtK(retrieval.results, relevantIds, 5),
      ndcgAt5: ndcg(retrieval.results, relevantIds, 5),
      contextRelevance: contextRelevance(example.query, retrieval.results),
    });
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

  return {
    totalQueries: results.length,
    avgMRR: avg(results.map(r => r.mrr)),
    avgPrecisionAt5: avg(results.map(r => r.precisionAt5)),
    avgRecallAt5: avg(results.map(r => r.recallAt5)),
    avgNDCGAt5: avg(results.map(r => r.ndcgAt5)),
    avgContextRelevance: avg(results.map(r => r.contextRelevance)),
    results,
  };
}

/** Print evaluation summary to console */
export function printSummary(summary: EvaluationSummary): void {
  console.log('\n📊 RAG Evaluation Results');
  console.log('═'.repeat(50));
  console.log(`  Queries evaluated: ${summary.totalQueries}`);
  console.log(`  Mean Reciprocal Rank:  ${(summary.avgMRR * 100).toFixed(1)}%`);
  console.log(`  Precision@5:           ${(summary.avgPrecisionAt5 * 100).toFixed(1)}%`);
  console.log(`  Recall@5:              ${(summary.avgRecallAt5 * 100).toFixed(1)}%`);
  console.log(`  NDCG@5:                ${(summary.avgNDCGAt5 * 100).toFixed(1)}%`);
  console.log(`  Context Relevance:     ${(summary.avgContextRelevance * 100).toFixed(1)}%`);
  console.log('═'.repeat(50));

  // Per-query breakdown
  console.log('\nPer-query breakdown:');
  for (const r of summary.results) {
    const mrr = (r.mrr * 100).toFixed(0);
    const p5 = (r.precisionAt5 * 100).toFixed(0);
    console.log(`  "${r.query.slice(0, 50)}..." → MRR: ${mrr}%, P@5: ${p5}%`);
  }
}
