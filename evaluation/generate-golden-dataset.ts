/**
 * Generate golden-dataset.json with actual chunk IDs from the ingestion pipeline.
 *
 * Runs the full ingestion pipeline (loadDirectory → chunkDocument → MockEmbedder.embedBatch
 * → MemoryStore.upsert) on sample-docs/ and maps document-level references to real chunk IDs.
 *
 * Usage: bun run evaluation/generate-golden-dataset.ts
 */
import { resolve, basename } from 'node:path';
import { ingestDirectory } from '../src/ingestion/pipeline.ts';
import { MockEmbedder } from '../src/embeddings/mock.ts';
import { MemoryStore } from '../src/store/memory.ts';

// ---------------------------------------------------------------------------
// Golden queries with document-level references (filename stems)
// ---------------------------------------------------------------------------

const GOLDEN_QUERIES = [
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
      'Hybrid search uses Reciprocal Rank Fusion (RRF) to combine vector similarity and BM25 keyword results. Each document gets a score based on its rank in each result list, weighted by a configurable hybrid weight parameter.',
  },
  {
    query: 'What is wave-based execution in multi-agent systems?',
    relevantDocNames: ['a2a-crews-overview', 'multi-agent-patterns'],
    expectedAnswer:
      'Wave-based execution is dependency-based scheduling where tasks are organized into waves. Each wave contains tasks that can run in parallel, and the next wave starts only when all tasks in the current wave complete.',
  },
  {
    query: 'What protocol does ag-ui-crews use for real-time updates?',
    relevantDocNames: ['ag-ui-crews-overview'],
    expectedAnswer:
      'ag-ui-crews uses the AG-UI protocol with Server-Sent Events (SSE) for real-time streaming of agent execution events to the web dashboard.',
  },
  {
    query: 'What is BM25 and how does it score documents?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'BM25 (Best Matching 25) is a probabilistic keyword search algorithm that scores documents based on term frequency, inverse document frequency, and document length normalization.',
  },
  {
    query: 'How do agents discover each other in the A2A protocol?',
    relevantDocNames: ['a2a-crews-overview', 'multi-agent-patterns'],
    expectedAnswer:
      'Agents discover each other through Agent Cards published at /.well-known/agent-card.json, which describe the agent\'s capabilities, skills, and communication endpoints.',
  },
  {
    query: 'What evaluation metrics are used for RAG systems?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'Key metrics include Mean Reciprocal Rank (MRR), Precision@K, Recall@K, NDCG, context relevance, faithfulness, and answer relevancy. The RAGAS framework automates evaluation.',
  },
  {
    query: 'What is the docs-as-bus pattern?',
    relevantDocNames: ['multi-agent-patterns'],
    expectedAnswer:
      'Docs-as-bus is a coordination pattern where agents write output to shared files instead of communicating directly. The repository or file system serves as the shared memory bus.',
  },
  {
    query: 'How does the retrieval pipeline rerank results?',
    relevantDocNames: ['rag-concepts'],
    expectedAnswer:
      'After hybrid search combines results, a cross-encoder reranker evaluates each result against the query to produce more accurate relevance scores. Results are re-sorted by the reranker\'s scores.',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const store = new MemoryStore();
  const embedder = new MockEmbedder();
  await store.initialize(embedder.dimensions);

  const sampleDocsPath = resolve(import.meta.dir, '..', 'sample-docs');

  console.log(`Ingesting sample-docs from: ${sampleDocsPath}`);
  const result = await ingestDirectory(sampleDocsPath, embedder, store, {
    extensions: ['.md'],
  });

  console.log(
    `Ingestion complete: ${result.documentsLoaded} docs, ${result.chunksCreated} chunks, ${result.errors.length} errors`,
  );

  if (result.errors.length > 0) {
    console.error('Errors:', result.errors);
    process.exit(1);
  }

  // Get all stored chunks and build filename-stem → chunk-IDs mapping
  const allChunks = await store.getAll();
  const fileToChunkIds = new Map<string, string[]>();

  for (const chunk of allChunks) {
    const source = chunk.metadata.source as string;
    const stem = basename(source, '.md');
    if (!fileToChunkIds.has(stem)) {
      fileToChunkIds.set(stem, []);
    }
    fileToChunkIds.get(stem)!.push(chunk.id);
  }

  console.log('\nChunk ID mapping:');
  for (const [stem, ids] of fileToChunkIds) {
    console.log(`  ${stem}: ${ids.length} chunks → [${ids.join(', ')}]`);
  }

  // Build the golden dataset with actual chunk IDs
  const goldenDataset = GOLDEN_QUERIES.map((q) => ({
    query: q.query,
    relevantDocumentIds: q.relevantDocNames.flatMap(
      (name) => fileToChunkIds.get(name) ?? [],
    ),
    expectedAnswer: q.expectedAnswer,
  }));

  // Validate that all queries have at least one relevant chunk
  for (const example of goldenDataset) {
    if (example.relevantDocumentIds.length === 0) {
      console.error(`WARNING: No chunk IDs found for query "${example.query}"`);
    }
  }

  // Write the updated golden dataset
  const outputPath = resolve(import.meta.dir, 'golden-dataset.json');
  await Bun.write(outputPath, JSON.stringify(goldenDataset, null, 2) + '\n');
  console.log(`\nWritten golden dataset to: ${outputPath}`);
  console.log(`Total queries: ${goldenDataset.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
