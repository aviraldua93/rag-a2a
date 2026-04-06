import { loadDirectory } from './loader.ts';
import { chunkDocument } from './chunker.ts';
import type { RawDocument } from './loader.ts';
import type { TextChunk, ChunkStrategy } from './chunker.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import type { VectorStore, VectorDocument } from '../store/types.ts';
import { logger } from '../logger.ts';

const log = logger.child({ component: 'ingest' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Summary returned after a full ingestion run. */
export interface IngestionResult {
  documentsLoaded: number;
  chunksCreated: number;
  chunksEmbedded: number;
  chunksStored: number;
  errors: string[];
  durationMs: number;
}

/** Options for {@link ingestDirectory}. */
export interface IngestOptions {
  chunkStrategy?: ChunkStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
  /** File extensions to include (e.g. `['.md', '.ts']`). */
  extensions?: string[];
  /** Number of chunks to embed per API call (default 50). */
  batchSize?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = 'recursive';
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 64;
const DEFAULT_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * End-to-end ingestion pipeline:
 *
 * 1. Load all matching files from a directory tree.
 * 2. Chunk every document according to the chosen strategy.
 * 3. Embed chunks in batches via the provided {@link EmbeddingProvider}.
 * 4. Upsert the resulting vectors into the {@link VectorStore}.
 *
 * Errors on individual chunks are captured in {@link IngestionResult.errors}
 * rather than aborting the entire run.
 */
export async function ingestDirectory(
  dirPath: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  options?: IngestOptions,
): Promise<IngestionResult> {
  const start = Date.now();
  const errors: string[] = [];

  const strategy = options?.chunkStrategy ?? DEFAULT_CHUNK_STRATEGY;
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

  // 1. Load documents -------------------------------------------------------
  let docs: RawDocument[];
  try {
    docs = await loadDirectory(dirPath, options?.extensions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      documentsLoaded: 0,
      chunksCreated: 0,
      chunksEmbedded: 0,
      chunksStored: 0,
      errors: [`Failed to load directory: ${msg}`],
      durationMs: Date.now() - start,
    };
  }

  log.info({ dirPath, documentsLoaded: docs.length }, `Loaded ${docs.length} document(s) from ${dirPath}`);

  // 2. Chunk documents ------------------------------------------------------
  const allChunks: TextChunk[] = [];
  for (const doc of docs) {
    try {
      const chunks = chunkDocument(doc, { strategy, chunkSize, chunkOverlap });
      allChunks.push(...chunks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Chunking failed for ${doc.metadata.source}: ${msg}`);
    }
  }

  log.info({ chunksCreated: allChunks.length, strategy }, `Created ${allChunks.length} chunk(s)`);

  if (allChunks.length === 0) {
    return {
      documentsLoaded: docs.length,
      chunksCreated: 0,
      chunksEmbedded: 0,
      chunksStored: 0,
      errors,
      durationMs: Date.now() - start,
    };
  }

  // 3. Embed & store in batches ---------------------------------------------
  let chunksEmbedded = 0;
  let chunksStored = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const batchIdx = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(allChunks.length / batchSize);

    // 3a. Embed
    let vectors: number[][];
    try {
      vectors = await embedder.embedBatch(batch.map((c) => c.content));
      chunksEmbedded += vectors.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Embedding batch ${batchIdx}/${totalBatches} failed: ${msg}`);
      continue; // skip this batch
    }

    // 3b. Build vector documents
    const vectorDocs: VectorDocument[] = batch.map((chunk, idx) => ({
      id: chunk.id,
      vector: vectors[idx],
      content: chunk.content,
      metadata: {
        source: chunk.metadata.source,
        documentId: chunk.documentId,
        chunkIndex: chunk.metadata.chunkIndex,
        startChar: chunk.metadata.startChar,
        endChar: chunk.metadata.endChar,
        strategy: chunk.metadata.strategy,
        embeddingModel: embedder.modelName,
      },
    }));

    // 3c. Upsert
    try {
      await store.upsert(vectorDocs);
      chunksStored += vectorDocs.length;
      log.info({ batch: batchIdx, totalBatches, stored: vectorDocs.length }, `Batch ${batchIdx}/${totalBatches}: embedded & stored ${vectorDocs.length} chunk(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Store upsert batch ${batchIdx}/${totalBatches} failed: ${msg}`);
    }
  }

  const durationMs = Date.now() - start;
  log.info({
    durationMs,
    documentsLoaded: docs.length,
    chunksCreated: allChunks.length,
    chunksEmbedded,
    chunksStored,
    errorCount: errors.length,
  }, `Done in ${durationMs}ms`);

  return {
    documentsLoaded: docs.length,
    chunksCreated: allChunks.length,
    chunksEmbedded,
    chunksStored,
    errors,
    durationMs,
  };
}
