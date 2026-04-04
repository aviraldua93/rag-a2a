import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import type { VectorStore, VectorDocument, SearchResult, SearchFilter } from './types.ts';

/** UUID v5 namespace used for deterministic ID hashing. */
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Regex to validate UUID format. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convert an arbitrary string ID to a valid UUID.
 * If the ID is already a UUID, return it as-is; otherwise hash it deterministically.
 */
function toUuid(id: string): string {
  if (UUID_REGEX.test(id)) {
    return id;
  }
  return uuidv5(id, UUID_NAMESPACE);
}

/**
 * Qdrant-backed vector store adapter.
 *
 * Uses the default (unnamed) vector configuration and stores document
 * content + metadata in the point payload.
 */
export class QdrantStore implements VectorStore {
  private client: QdrantClient;
  private collectionName: string;

  constructor(url: string, collectionName: string) {
    this.client = new QdrantClient({ url });
    this.collectionName = collectionName;
  }

  /** Create the Qdrant collection if it does not already exist. */
  async initialize(vectorSize: number): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName,
      );

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        });
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize Qdrant collection "${this.collectionName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Upsert documents as Qdrant points with content and metadata in the payload. */
  async upsert(documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;

    try {
      const points = documents.map((doc) => ({
        id: toUuid(doc.id),
        vector: doc.vector,
        payload: {
          original_id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
        },
      }));

      await this.client.upsert(this.collectionName, { points });
    } catch (error) {
      throw new Error(
        `Failed to upsert documents into Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Search by vector similarity, returning the top-K results sorted by score. */
  async search(vector: number[], topK: number, filter?: SearchFilter): Promise<SearchResult[]> {
    try {
      const searchParams: Record<string, unknown> = {
        vector,
        limit: topK,
        with_payload: true,
      };

      if (filter && Object.keys(filter).length > 0) {
        searchParams.filter = {
          must: Object.entries(filter).map(([key, value]) => ({
            key: `metadata.${key}`,
            match: { value },
          })),
        };
      }

      const results = await this.client.search(this.collectionName, searchParams as any);

      return results.map((r) => {
        const payload = r.payload ?? {};
        return {
          id: (payload.original_id as string) ?? String(r.id),
          content: (payload.content as string) ?? '',
          score: r.score,
          metadata: (payload.metadata as Record<string, unknown>) ?? {},
        };
      });
    } catch (error) {
      throw new Error(
        `Failed to search Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Delete documents by their original IDs. */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    try {
      const pointIds = ids.map(toUuid);
      await this.client.delete(this.collectionName, {
        points: pointIds,
      });
    } catch (error) {
      throw new Error(
        `Failed to delete documents from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Return the total number of points in the collection. */
  async count(): Promise<number> {
    try {
      const result = await this.client.count(this.collectionName);
      return result.count;
    } catch (error) {
      throw new Error(
        `Failed to count documents in Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Retrieve all documents from the store by scrolling through all points. */
  async getAll(): Promise<SearchResult[]> {
    try {
      const results: SearchResult[] = [];
      let offset: string | number | undefined = undefined;

      while (true) {
        const response = await this.client.scroll(this.collectionName, {
          limit: 100,
          offset,
          with_payload: true,
        });

        for (const point of response.points) {
          const payload = point.payload ?? {};
          results.push({
            id: (payload.original_id as string) ?? String(point.id),
            content: (payload.content as string) ?? '',
            score: 1.0,
            metadata: (payload.metadata as Record<string, unknown>) ?? {},
          });
        }

        if (!response.next_page_offset) break;
        offset = response.next_page_offset as string | number;
      }

      return results;
    } catch (error) {
      throw new Error(
        `Failed to retrieve all documents from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
