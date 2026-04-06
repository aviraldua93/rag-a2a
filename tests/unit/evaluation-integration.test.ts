/**
 * Integration test: Evaluation against real ingested data.
 *
 * Runs the full ingestion pipeline on sample-docs/ using MockEmbedder + MemoryStore,
 * dynamically builds a golden dataset with actual chunk IDs, constructs a RetrievalPipeline,
 * runs runEvaluation, and asserts that metrics are non-zero.
 *
 * No external API keys or services required.
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { resolve, basename } from 'node:path';
import { ingestDirectory } from '../../src/ingestion/pipeline.ts';
import { MockEmbedder } from '../../src/embeddings/mock.ts';
import { MemoryStore } from '../../src/store/memory.ts';
import { RetrievalPipeline } from '../../src/retrieval/pipeline.ts';
import { ScoreReranker } from '../../src/retrieval/reranker.ts';
import { runEvaluation, type GoldenExample } from '../../src/evaluation/runner.ts';
import type { BM25Document } from '../../src/retrieval/bm25.ts';
import type { SearchResult } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_DOCS_DIR = resolve(import.meta.dir, '..', '..', 'sample-docs');

/**
 * Queries with references to source document filename stems.
 * These are mapped to actual chunk IDs at runtime after ingestion.
 */
const GOLDEN_QUERIES: Array<{
  query: string;
  relevantDocNames: string[];
  expectedAnswer?: string;
}> = [
  {
    query: 'How does the A2A bridge coordinate agents?',
    relevantDocNames: ['a2a-crews-overview'],
    expectedAnswer:
      'The A2A bridge is an embedded HTTP server that coordinates agents using JSON-RPC 2.0 endpoints, SSE streaming, and agent registration with heartbeat monitoring.',
  },
  {
    query: 'What chunking strategies are available for RAG?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'Three main strategies: sliding window (fixed-size with overlap), semantic (paragraph-boundary splitting), and recursive (hierarchical splitting on separators like paragraphs, lines, sentences, then words).',
  },
  {
    query: 'How does hybrid search combine vector and keyword results?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'Hybrid search uses Reciprocal Rank Fusion (RRF) to combine vector similarity and BM25 keyword results.',
  },
  {
    query: 'What is wave-based execution in multi-agent systems?',
    relevantDocNames: ['a2a-crews-overview', 'multi-agent-patterns'],
    expectedAnswer:
      'Wave-based execution is dependency-based scheduling where tasks are organized into waves.',
  },
  {
    query: 'What protocol does ag-ui-crews use for real-time updates?',
    relevantDocNames: ['ag-ui-crews-overview'],
    expectedAnswer:
      'ag-ui-crews uses the AG-UI protocol with Server-Sent Events (SSE) for real-time streaming.',
  },
  {
    query: 'What is BM25 and how does it score documents?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'BM25 is a probabilistic keyword search algorithm that scores documents based on term frequency, inverse document frequency, and document length normalization.',
  },
  {
    query: 'How do agents discover each other in the A2A protocol?',
    relevantDocNames: ['a2a-crews-overview', 'multi-agent-patterns'],
    expectedAnswer:
      'Agents discover each other through Agent Cards published at /.well-known/agent-card.json.',
  },
  {
    query: 'What evaluation metrics are used for RAG systems?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'Key metrics include Mean Reciprocal Rank (MRR), Precision@K, Recall@K, NDCG, and context relevance.',
  },
  {
    query: 'What is the docs-as-bus pattern?',
    relevantDocNames: ['multi-agent-patterns'],
    expectedAnswer:
      'Docs-as-bus is a coordination pattern where agents write output to shared files instead of communicating directly.',
  },
  {
    query: 'How does the retrieval pipeline rerank results?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'After hybrid search combines results, a cross-encoder reranker evaluates each result against the query.',
  },
];

// ---------------------------------------------------------------------------
// Shared state (populated in beforeAll)
// ---------------------------------------------------------------------------

let store: MemoryStore;
let pipeline: RetrievalPipeline;
let fileToChunkIds: Map<string, string[]>;
let allChunks: SearchResult[];

// ---------------------------------------------------------------------------
// Setup: ingest sample-docs and build retrieval pipeline
// ---------------------------------------------------------------------------

beforeAll(async () => {
  store = new MemoryStore();
  const embedder = new MockEmbedder();
  await store.initialize(embedder.dimensions);

  // Run the full ingestion pipeline
  const result = await ingestDirectory(SAMPLE_DOCS_DIR, embedder, store, {
    extensions: ['.md'],
  });

  if (result.errors.length > 0) {
    throw new Error(`Ingestion errors: ${result.errors.join('; ')}`);
  }

  // Get all stored chunks
  allChunks = await store.getAll();

  // Build filename-stem → chunk-IDs mapping
  fileToChunkIds = new Map();
  for (const chunk of allChunks) {
    const source = chunk.metadata.source as string;
    const stem = basename(source, '.md');
    if (!fileToChunkIds.has(stem)) {
      fileToChunkIds.set(stem, []);
    }
    fileToChunkIds.get(stem)!.push(chunk.id);
  }

  // Set up retrieval pipeline
  const reranker = new ScoreReranker();
  pipeline = new RetrievalPipeline(store, embedder, reranker, {
    topK: 10,
    hybridWeight: 0.5,
    rerankTopK: 5,
  });

  // Index all chunks for BM25 keyword search
  const bm25Docs: BM25Document[] = allChunks.map((c) => ({
    id: c.id,
    content: c.content,
    metadata: c.metadata,
  }));
  pipeline.indexDocuments(bm25Docs);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Evaluation Integration', () => {
  test('ingestion produces chunks for all 4 sample documents', () => {
    const expectedDocs = [
      'a2a-crews-overview',
      'ag-ui-crews-overview',
      'multi-agent-patterns',
      'rag-concepts',
    ];

    expect(fileToChunkIds.size).toBeGreaterThanOrEqual(4);
    for (const docName of expectedDocs) {
      const chunkIds = fileToChunkIds.get(docName);
      expect(chunkIds).toBeDefined();
      expect(chunkIds!.length).toBeGreaterThan(0);
    }
  });

  test('chunk IDs follow the expected format: <hash>-<index>', () => {
    for (const chunk of allChunks) {
      expect(chunk.id).toMatch(/^[0-9a-f]+-\d+$/);
    }
  });

  test('golden dataset maps to real chunk IDs', () => {
    for (const q of GOLDEN_QUERIES) {
      const chunkIds = q.relevantDocNames.flatMap(
        (name) => fileToChunkIds.get(name) ?? [],
      );
      expect(chunkIds.length).toBeGreaterThan(0);
    }
  });

  test('retrieval pipeline returns results for sample queries', async () => {
    const result = await pipeline.retrieve('What is RAG?');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.metadata.durationMs).toBeGreaterThan(0);
  });

  test('runEvaluation returns non-zero avgMRR', async () => {
    const goldenDataset = buildGoldenDataset();
    const summary = await runEvaluation(pipeline, goldenDataset);
    expect(summary.avgMRR).toBeGreaterThan(0);
  });

  test('runEvaluation returns non-zero avgPrecisionAt5', async () => {
    const goldenDataset = buildGoldenDataset();
    const summary = await runEvaluation(pipeline, goldenDataset);
    expect(summary.avgPrecisionAt5).toBeGreaterThan(0);
  });

  test('runEvaluation returns non-zero avgRecallAt5', async () => {
    const goldenDataset = buildGoldenDataset();
    const summary = await runEvaluation(pipeline, goldenDataset);
    expect(summary.avgRecallAt5).toBeGreaterThan(0);
  });

  test('runEvaluation evaluates all golden queries', async () => {
    const goldenDataset = buildGoldenDataset();
    const summary = await runEvaluation(pipeline, goldenDataset);
    expect(summary.totalQueries).toBe(GOLDEN_QUERIES.length);
    expect(summary.results.length).toBe(GOLDEN_QUERIES.length);
  });

  test('per-query MRR values are all non-negative', async () => {
    const goldenDataset = buildGoldenDataset();
    const summary = await runEvaluation(pipeline, goldenDataset);
    for (const result of summary.results) {
      expect(result.mrr).toBeGreaterThanOrEqual(0);
    }
  });

  test('full evaluation summary has valid ranges', async () => {
    const goldenDataset = buildGoldenDataset();
    const summary = await runEvaluation(pipeline, goldenDataset);

    // All averages should be in [0, 1]
    expect(summary.avgMRR).toBeGreaterThanOrEqual(0);
    expect(summary.avgMRR).toBeLessThanOrEqual(1);
    expect(summary.avgPrecisionAt5).toBeGreaterThanOrEqual(0);
    expect(summary.avgPrecisionAt5).toBeLessThanOrEqual(1);
    expect(summary.avgRecallAt5).toBeGreaterThanOrEqual(0);
    expect(summary.avgRecallAt5).toBeLessThanOrEqual(1);
    expect(summary.avgNDCGAt5).toBeGreaterThanOrEqual(0);
    expect(summary.avgNDCGAt5).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Helper: build golden dataset with real chunk IDs
// ---------------------------------------------------------------------------

function buildGoldenDataset(): GoldenExample[] {
  return GOLDEN_QUERIES.map((q) => ({
    query: q.query,
    relevantDocumentIds: q.relevantDocNames.flatMap(
      (name) => fileToChunkIds.get(name) ?? [],
    ),
    expectedAnswer: q.expectedAnswer,
  }));
}
