import OpenAI from 'openai';
import type { EmbeddingProvider } from './provider.ts';

const DEFAULT_MODEL = 'text-embedding-3-small';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Embedding provider backed by the OpenAI embeddings API.
 *
 * Uses exponential back-off (up to {@link MAX_RETRIES} attempts) for
 * transient / rate-limit errors.
 *
 * @example
 * ```ts
 * const embedder = new OpenAIEmbedder(process.env.OPENAI_API_KEY!);
 * const vec = await embedder.embed("hello world");
 * ```
 */
export class OpenAIEmbedder implements EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;

  private client: OpenAI;

  constructor(apiKey: string, model?: string) {
    this.modelName = model ?? DEFAULT_MODEL;
    // text-embedding-3-small → 1536, text-embedding-3-large → 3072
    this.dimensions = this.modelName.includes('large') ? 3072 : 1536;
    this.client = new OpenAI({ apiKey });
  }

  /** Embed a single text string. */
  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  /** Embed a batch of texts in a single API call with retry logic. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.modelName,
          input: texts,
        });

        // The API may return embeddings out of order; sort by index.
        const sorted = response.data.sort((a, b) => a.index - b.index);
        return sorted.map((d) => d.embedding);
      } catch (error: unknown) {
        lastError = error;
        // Only retry on rate-limit (429) or server errors (5xx)
        if (isRetryable(error)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    return status === 429 || (status !== undefined && status >= 500);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
