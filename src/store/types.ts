/**
 * Shared types for the vector store layer.
 * Implementations (e.g. Qdrant) live in separate files.
 */

/** A document ready to be stored in the vector database. */
export interface VectorDocument {
  id: string;
  vector: number[];
  content: string;
  metadata: Record<string, unknown>;
}

/** Minimal result returned by a similarity search. */
export interface SearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}

/** Metadata filter for search queries. */
export interface SearchFilter {
  [key: string]: string | number | boolean | string[];
}

/** Abstract vector store contract consumed by the ingestion pipeline. */
export interface VectorStore {
  /** Initialize the store (create collection if needed). */
  initialize(vectorSize: number): Promise<void>;

  /** Upsert a batch of documents into the store. */
  upsert(documents: VectorDocument[]): Promise<void>;

  /** Search for the top-k nearest neighbours. */
  search(vector: number[], topK: number, filter?: SearchFilter): Promise<SearchResult[]>;

  /** Delete documents by their IDs. */
  delete(ids: string[]): Promise<void>;

  /** Get the total document count in the store. */
  count(): Promise<number>;

  /** Retrieve all documents from the store. */
  getAll(): Promise<SearchResult[]>;
}
