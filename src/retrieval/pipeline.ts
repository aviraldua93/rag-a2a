import type { VectorStore, SearchResult } from '../store/types.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import type { Reranker } from './reranker.ts';
import { VectorSearcher } from './vector-search.ts';
import { BM25Index, type BM25Document } from './bm25.ts';
import { reciprocalRankFusion } from './hybrid.ts';
import { LRUCache } from './cache.ts';

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
    cacheHit?: boolean;
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
  private cache: LRUCache<string, RetrievalResult>;

  constructor(
    store: VectorStore,
    embedder: EmbeddingProvider,
    reranker: Reranker,
    private options: RetrievalPipelineOptions,
  ) {
    this.vectorSearcher = new VectorSearcher(store, embedder);
    this.bm25Index = new BM25Index();
    this.reranker = reranker;
    this.cache = new LRUCache<string, RetrievalResult>(100, 300_000);
  }

  /** Index documents for BM25 keyword search. */
  indexDocuments(documents: BM25Document[]): void {
    this.bm25Index.index(documents);
  }

  /** Invalidate the query cache (e.g. after ingestion). */
  invalidateCache(): void {
    this.cache.invalidate();
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
  async retrieve(query: string, overrides?: { topK?: number; mode?: string }): Promise<RetrievalResult> {
    const topK = overrides?.topK ?? this.options.topK;
    const mode = overrides?.mode ?? 'hybrid';
    const rerankTopK = this.options.rerankTopK;

    const cacheKey = `${query}|${topK}|${mode}|${this.options.hybridWeight}|${rerankTopK}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
    }

    const start = performance.now();

    // Run vector and keyword search based on mode
    let vectorResults: SearchResult[] = [];
    let keywordResults: SearchResult[] = [];

    if (mode === 'vector' || mode === 'hybrid') {
      vectorResults = await this.vectorSearcher.search(query, topK);
    }
    if (mode === 'keyword' || mode === 'hybrid') {
      keywordResults = this.bm25Index.search(query, topK);
    }

    const durationMs = performance.now() - start;

    // Single-mode: skip fusion, just rerank and return
    if (mode === 'vector') {
      const rerankedResults = await this.reranker.rerank(query, vectorResults, rerankTopK);
      const result: RetrievalResult = {
        results: rerankedResults,
        metadata: {
          vectorResultCount: vectorResults.length,
          keywordResultCount: 0,
          hybridResultCount: vectorResults.length,
          rerankResultCount: rerankedResults.length,
          durationMs: performance.now() - start,
          cacheHit: false,
        },
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    if (mode === 'keyword') {
      const rerankedResults = await this.reranker.rerank(query, keywordResults, rerankTopK);
      const result: RetrievalResult = {
        results: rerankedResults,
        metadata: {
          vectorResultCount: 0,
          keywordResultCount: keywordResults.length,
          hybridResultCount: keywordResults.length,
          rerankResultCount: rerankedResults.length,
          durationMs: performance.now() - start,
          cacheHit: false,
        },
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    // Hybrid fusion
    const hybridResults = reciprocalRankFusion(vectorResults, keywordResults, {
      vectorWeight: this.options.hybridWeight,
      k: 60,
    });

    // Rerank
    const rerankedResults = await this.reranker.rerank(
      query,
      hybridResults,
      rerankTopK,
    );

    const result: RetrievalResult = {
      results: rerankedResults,
      metadata: {
        vectorResultCount: vectorResults.length,
        keywordResultCount: keywordResults.length,
        hybridResultCount: hybridResults.length,
        rerankResultCount: rerankedResults.length,
        durationMs: performance.now() - start,
        cacheHit: false,
      },
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
