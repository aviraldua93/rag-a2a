import type { VectorStore, SearchResult } from '../store/types.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import type { Reranker } from './reranker.ts';
import { VectorSearcher } from './vector-search.ts';
import { BM25Index, type BM25Document } from './bm25.ts';
import { reciprocalRankFusion } from './hybrid.ts';

/** Configuration for the retrieval pipeline. */
export interface RetrievalPipelineOptions {
  /** Number of results to fetch from each search stage. */
  topK: number;
  /** Weight for vector results in hybrid fusion (0–1). */
  hybridWeight: number;
  /** Number of results to return after reranking. */
  rerankTopK: number;
}

/** Result of a full retrieval pipeline run, including timing metadata. */
export interface RetrievalResult {
  results: SearchResult[];
  metadata: {
    vectorResultCount: number;
    keywordResultCount: number;
    hybridResultCount: number;
    rerankResultCount: number;
    durationMs: number;
  };
}

/**
 * Full retrieval pipeline: vector search → BM25 → hybrid fusion → rerank.
 *
 * Orchestrates semantic vector search and keyword-based BM25 search in parallel,
 * fuses the results using Reciprocal Rank Fusion, and applies a reranker to
 * produce the final ranked result set.
 */
export class RetrievalPipeline {
  private vectorSearcher: VectorSearcher;
  private bm25Index: BM25Index;
  private reranker: Reranker;

  constructor(
    store: VectorStore,
    embedder: EmbeddingProvider,
    reranker: Reranker,
    private options: RetrievalPipelineOptions,
  ) {
    this.vectorSearcher = new VectorSearcher(store, embedder);
    this.bm25Index = new BM25Index();
    this.reranker = reranker;
  }

  /** Index documents for BM25 keyword search. */
  indexDocuments(documents: BM25Document[]): void {
    this.bm25Index.index(documents);
  }

  /**
   * Execute the full retrieval pipeline for a query.
   *
   * 1. Run vector search and BM25 search in parallel
   * 2. Fuse results using Reciprocal Rank Fusion
   * 3. Rerank the fused results
   *
   * @returns The final results with pipeline metadata.
   */
  async retrieve(query: string): Promise<RetrievalResult> {
    const start = performance.now();

    // Run vector and keyword search in parallel
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearcher.search(query, this.options.topK),
      Promise.resolve(this.bm25Index.search(query, this.options.topK)),
    ]);

    // Hybrid fusion
    const hybridResults = reciprocalRankFusion(vectorResults, keywordResults, {
      vectorWeight: this.options.hybridWeight,
      k: 60,
    });

    // Rerank
    const rerankedResults = await this.reranker.rerank(
      query,
      hybridResults,
      this.options.rerankTopK,
    );

    const durationMs = performance.now() - start;

    return {
      results: rerankedResults,
      metadata: {
        vectorResultCount: vectorResults.length,
        keywordResultCount: keywordResults.length,
        hybridResultCount: hybridResults.length,
        rerankResultCount: rerankedResults.length,
        durationMs,
      },
    };
  }
}
