/**
 * Abstract embedding provider interface.
 *
 * All embedding implementations (OpenAI, local models, mocks) must
 * conform to this contract so the rest of the pipeline stays
 * provider-agnostic.
 */
export interface EmbeddingProvider {
  /** Embed a single text string and return its vector. */
  embed(text: string): Promise<number[]>;

  /** Embed a batch of texts in one call. Implementations should handle
   *  rate-limiting / chunking internally. */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Dimensionality of the returned vectors. */
  readonly dimensions: number;

  /** Human-readable model identifier (e.g. "text-embedding-3-small"). */
  readonly modelName: string;
}
