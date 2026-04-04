import type { VectorStore, VectorDocument, SearchResult, SearchFilter } from './types.ts';

/**
 * Compute the cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * In-memory vector store for testing and development.
 *
 * Implements cosine similarity search over documents stored in a Map.
 * Not suitable for production workloads with large document counts.
 */
export class MemoryStore implements VectorStore {
  private documents: Map<string, VectorDocument> = new Map();
  private vectorSize: number = 0;

  /** Initialize the store with the expected vector dimensionality. */
  async initialize(vectorSize: number): Promise<void> {
    this.vectorSize = vectorSize;
  }

  /** Upsert documents into the in-memory store. */
  async upsert(documents: VectorDocument[]): Promise<void> {
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
  }

  /** Search by cosine similarity, returning the top-K most similar documents. */
  async search(vector: number[], topK: number, filter?: SearchFilter): Promise<SearchResult[]> {
    if (this.documents.size === 0) return [];

    const scored: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      if (filter && !matchesFilter(doc.metadata, filter)) continue;
      const score = cosineSimilarity(vector, doc.vector);
      scored.push({
        id: doc.id,
        content: doc.content,
        score,
        metadata: doc.metadata,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Delete documents by IDs. */
  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  /** Return the total number of stored documents. */
  async count(): Promise<number> {
    return this.documents.size;
  }

  /** Retrieve all documents from the store. */
  async getAll(): Promise<SearchResult[]> {
    return Array.from(this.documents.values()).map(doc => ({
      id: doc.id,
      content: doc.content,
      score: 1.0,
      metadata: doc.metadata,
    }));
  }
}

/** Check if a document's metadata matches the given filter criteria. */
function matchesFilter(
  metadata: Record<string, unknown>,
  filter: SearchFilter,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    const actual = metadata[key];
    if (Array.isArray(value)) {
      if (!value.includes(actual as string)) return false;
    } else if (actual !== value) {
      return false;
    }
  }
  return true;
}
