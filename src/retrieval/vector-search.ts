import type { VectorStore, SearchResult, SearchFilter } from '../store/types.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';

/**
 * Vector-based semantic search.
 *
 * Embeds a text query using the configured embedding provider and
 * searches the vector store for the most similar documents.
 */
export class VectorSearcher {
  constructor(
    private store: VectorStore,
    private embedder: EmbeddingProvider,
  ) {}

  /**
   * Embed the query string and search the vector store for the top-K
   * most similar documents.
   */
  async search(query: string, topK: number, filter?: SearchFilter): Promise<SearchResult[]> {
    const vector = await this.embedder.embed(query);
    return this.store.search(vector, topK, filter);
  }
}
