import type { RetrievalPipeline } from '../retrieval/pipeline.ts';
import { logger } from '../logger.ts';
import {
  meanReciprocalRank,
  precisionAtK,
  recallAtK,
  ndcg,
  contextRelevance,
  type EvaluationResult,
  type EvaluationSummary,
} from './metrics.ts';

const log = logger.child({ component: 'evaluation' });

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

/** Print evaluation summary using structured logging */
export function printSummary(summary: EvaluationSummary): void {
  log.info({
    totalQueries: summary.totalQueries,
    avgMRR: +(summary.avgMRR * 100).toFixed(1),
    avgPrecisionAt5: +(summary.avgPrecisionAt5 * 100).toFixed(1),
    avgRecallAt5: +(summary.avgRecallAt5 * 100).toFixed(1),
    avgNDCGAt5: +(summary.avgNDCGAt5 * 100).toFixed(1),
    avgContextRelevance: +(summary.avgContextRelevance * 100).toFixed(1),
  }, 'RAG Evaluation Results');

  for (const r of summary.results) {
    log.info({
      query: r.query.slice(0, 50),
      mrr: +(r.mrr * 100).toFixed(0),
      precisionAt5: +(r.precisionAt5 * 100).toFixed(0),
    }, 'Per-query result');
  }
}
