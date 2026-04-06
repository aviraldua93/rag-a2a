import type { SearchResult } from '../store/types.ts';
import type { Reranker } from './reranker.ts';

/**
 * Response shape from the Cohere Rerank API v2.
 * @see https://docs.cohere.com/reference/rerank
 */
interface CohereRerankResponse {
  id: string;
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
  meta?: {
    api_version?: { version: string };
    billed_units?: { search_units: number };
  };
}

/** Error response from the Cohere API. */
interface CohereErrorResponse {
  message?: string;
}

export const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
export const DEFAULT_MODEL = 'rerank-v3.5';
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/**
 * Cross-encoder reranker powered by the Cohere Rerank API.
 *
 * Uses the `rerank-v3.5` model by default to score each document against
 * the query with a cross-encoder, providing significantly better relevance
 * ranking than term-overlap heuristics.
 *
 * Requires the `COHERE_API_KEY` environment variable. If the key is missing,
 * the server bootstrap falls back to {@link ScoreReranker}.
 *
 * @example
 * ```ts
 * const reranker = new CohereReranker(process.env.COHERE_API_KEY!);
 * const reranked = await reranker.rerank('What is RAG?', results, 5);
 * ```
 */
export class CohereReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn?: typeof fetch;

  /**
   * @param apiKey  Cohere API key. Throws if empty or missing.
   * @param model   Cohere rerank model (default: rerank-v3.5).
   * @param fetchFn Optional fetch override for testing. Uses globalThis.fetch when omitted.
   */
  constructor(apiKey: string, model?: string, fetchFn?: typeof fetch) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        'CohereReranker requires a valid COHERE_API_KEY. ' +
        'Set the COHERE_API_KEY environment variable or pass the key to the constructor.',
      );
    }
    this.apiKey = apiKey.trim();
    this.model = model ?? DEFAULT_MODEL;
    this.fetchFn = fetchFn;
  }

  /**
   * Rerank search results using the Cohere cross-encoder API.
   *
   * Sends each result's content as a document to the Cohere Rerank endpoint,
   * receives relevance scores, and returns the top-K results sorted by
   * cross-encoder score descending. Includes retry logic for transient errors.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    topK: number,
  ): Promise<SearchResult[]> {
    if (results.length === 0) return [];
    if (!query || query.trim().length === 0) return results.slice(0, topK);

    const documents = results.map((r) => r.content);
    const data = await this.callCohereRerank(query, documents, topK);

    // Map Cohere results back to our SearchResult format
    const reranked: SearchResult[] = data.results.map((r) => {
      const original = results[r.index];
      return {
        id: original.id,
        content: original.content,
        score: r.relevance_score,
        metadata: original.metadata,
      };
    });

    // Cohere returns results sorted by relevance_score desc, but ensure it
    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, topK);
  }

  /**
   * Call the Cohere Rerank API with retry logic for rate-limit and server errors.
   */
  private async callCohereRerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<CohereRerankResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const doFetch = this.fetchFn ?? globalThis.fetch;
        const res = await doFetch(COHERE_RERANK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            query,
            documents,
            top_n: topN,
            return_documents: false,
          }),
        });

        if (!res.ok) {
          const status = res.status;
          let errorMessage: string;
          try {
            const errorBody = (await res.json()) as CohereErrorResponse;
            errorMessage = errorBody.message ?? res.statusText;
          } catch {
            errorMessage = res.statusText;
          }

          // Retry on rate-limit (429) or server errors (5xx)
          if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
            lastError = new Error(`Cohere Rerank API error (${status}): ${errorMessage}`);
            await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
            continue;
          }

          throw new Error(`Cohere Rerank API error (${status}): ${errorMessage}`);
        }

        return (await res.json()) as CohereRerankResponse;
      } catch (error: unknown) {
        lastError = error;

        // Network errors are retryable
        if (isNetworkError(error) && attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && (error as Error).message.includes('fetch')) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
