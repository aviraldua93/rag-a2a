import type { SearchResult } from '../store/types.ts';

/** Interface for reranking search results based on query relevance. */
export interface Reranker {
  /**
   * Rerank search results by relevance to the query.
   * @returns The top-K results after reranking, sorted by new score descending.
   */
  rerank(
    query: string,
    results: SearchResult[],
    topK: number,
  ): Promise<SearchResult[]>;
}

/**
 * Score-based reranker that boosts results containing query terms.
 *
 * Computes a term-overlap score between the query and each result's content,
 * combines it with the original retrieval score, and re-sorts. This is the
 * default fallback reranker when no external reranking API is configured.
 */
export class ScoreReranker implements Reranker {
  /**
   * Rerank results by combining the original score with a query term overlap boost.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    topK: number,
  ): Promise<SearchResult[]> {
    if (results.length === 0) return [];

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return results.slice(0, topK);

    const reranked = results.map((result) => {
      const contentTerms = new Set(this.tokenize(result.content));
      let matchCount = 0;
      for (const term of queryTerms) {
        if (contentTerms.has(term)) {
          matchCount++;
        }
      }

      // Term overlap ratio (0–1)
      const overlapScore = matchCount / queryTerms.length;

      // Combine: 60% original score + 40% term overlap boost
      const combinedScore = 0.6 * result.score + 0.4 * overlapScore;

      return {
        id: result.id,
        content: result.content,
        score: combinedScore,
        metadata: result.metadata,
      };
    });

    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, topK);
  }

  /** Tokenize text into lowercase terms split on whitespace/punctuation. */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((t) => t.length > 0);
  }
}
