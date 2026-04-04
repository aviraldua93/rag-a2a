/**
 * Shared mock implementations and factory functions for testing.
 *
 * Provides typed mocks for VectorStore, EmbeddingProvider, and factory
 * helpers to create SearchResult[], BM25Document[], and RawDocument
 * instances with sensible defaults.
 */

import type {
  VectorStore,
  VectorDocument,
  SearchResult,
  SearchFilter,
} from '../../src/store/types.ts';
import type { EmbeddingProvider } from '../../src/embeddings/provider.ts';
import type { BM25Document } from '../../src/retrieval/bm25.ts';
import type { RawDocument } from '../../src/ingestion/loader.ts';
import type { GenerationResult, StreamChunk } from '../../src/generation/types.ts';

// ---------------------------------------------------------------------------
// MockVectorStore — in-memory VectorStore with call tracking
// ---------------------------------------------------------------------------

/**
 * Mock VectorStore that stores documents in memory and supports cosine
 * similarity search. Tracks all calls for assertion in tests.
 */
export class MockVectorStore implements VectorStore {
  private documents: Map<string, VectorDocument> = new Map();
  private _vectorSize = 0;

  /** Track calls for test assertions */
  readonly calls = {
    initialize: [] as number[],
    upsert: [] as VectorDocument[][],
    search: [] as { vector: number[]; topK: number }[],
    delete: [] as string[][],
    count: 0,
  };

  get vectorSize(): number {
    return this._vectorSize;
  }

  get storedDocuments(): Map<string, VectorDocument> {
    return this.documents;
  }

  async initialize(vectorSize: number): Promise<void> {
    this._vectorSize = vectorSize;
    this.calls.initialize.push(vectorSize);
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    this.calls.upsert.push(documents);
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
  }

  async search(vector: number[], topK: number, filter?: SearchFilter): Promise<SearchResult[]> {
    this.calls.search.push({ vector, topK });
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

  async delete(ids: string[]): Promise<void> {
    this.calls.delete.push(ids);
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  async count(): Promise<number> {
    this.calls.count++;
    return this.documents.size;
  }

  async getAll(): Promise<SearchResult[]> {
    return Array.from(this.documents.values()).map(doc => ({
      id: doc.id,
      content: doc.content,
      score: 1.0,
      metadata: doc.metadata,
    }));
  }

  /** Reset all stored data and call tracking */
  reset(): void {
    this.documents.clear();
    this.calls.initialize.length = 0;
    this.calls.upsert.length = 0;
    this.calls.search.length = 0;
    this.calls.delete.length = 0;
    this.calls.count = 0;
  }
}

// ---------------------------------------------------------------------------
// MockEmbeddingProvider — deterministic embeddings with call tracking
// ---------------------------------------------------------------------------

/**
 * Mock EmbeddingProvider that produces deterministic vectors from text hashing.
 * Same text always yields the same vector. Tracks calls for assertions.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName = 'mock-test-embedding';

  readonly calls = {
    embed: [] as string[],
    embedBatch: [] as string[][],
  };

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    this.calls.embed.push(text);
    return deterministicVector(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    this.calls.embedBatch.push(texts);
    return texts.map((t) => deterministicVector(t, this.dimensions));
  }

  reset(): void {
    this.calls.embed.length = 0;
    this.calls.embedBatch.length = 0;
  }
}

// ---------------------------------------------------------------------------
// MockGenerator — deterministic generation for testing
// ---------------------------------------------------------------------------

/**
 * Mock generator that returns deterministic answers.
 * Useful for testing the pipeline without actual LLM calls.
 */
export class MockTestGenerator {
  readonly calls = {
    generate: [] as { query: string; contexts: SearchResult[] }[],
    generateStream: [] as { query: string; contexts: SearchResult[] }[],
  };

  async generate(
    query: string,
    contexts: SearchResult[],
  ): Promise<GenerationResult> {
    this.calls.generate.push({ query, contexts });
    const firstContent = contexts[0]?.content ?? 'No context available';
    const sourceRefs = contexts.map((_, i) => `[Source ${i + 1}]`).join(', ');

    const answer =
      contexts.length > 0
        ? `Based on the provided documents ${sourceRefs}: ${firstContent.slice(0, 300)}\n\nThis answers the question: "${query}"`
        : `I cannot find the answer to "${query}" in the provided documents.`;

    return {
      answer,
      sources: contexts.map((ctx) => ({
        id: ctx.id,
        content: ctx.content,
        score: ctx.score,
      })),
      model: 'mock-test',
      tokensUsed: answer.length,
      durationMs: 1,
    };
  }

  async *generateStream(
    query: string,
    contexts: SearchResult[],
  ): AsyncGenerator<StreamChunk> {
    this.calls.generateStream.push({ query, contexts });

    for (let i = 0; i < contexts.length; i++) {
      const ctx = contexts[i]!;
      yield {
        type: 'source' as const,
        content: JSON.stringify({
          index: i + 1,
          id: ctx.id,
          content: ctx.content.slice(0, 200),
          score: ctx.score,
        }),
      };
    }

    const result = await this.generate(query, contexts);
    const words = result.answer.split(' ');
    const chunkSize = 3;

    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      const suffix = i + chunkSize < words.length ? ' ' : '';
      yield { type: 'text' as const, content: chunk + suffix };
    }

    yield { type: 'done' as const, content: '' };
  }

  reset(): void {
    this.calls.generate.length = 0;
    this.calls.generateStream.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/** Create a SearchResult with sensible defaults, overridable via partial. */
export function createSearchResult(
  overrides: Partial<SearchResult> & { id?: string } = {},
): SearchResult {
  return {
    id: overrides.id ?? `doc-${Math.random().toString(36).slice(2, 8)}`,
    score: overrides.score ?? 0.85,
    content:
      overrides.content ?? 'This is a test document about machine learning.',
    metadata: overrides.metadata ?? { source: 'test.md' },
  };
}

/** Create an array of SearchResults with sequential IDs. */
export function createSearchResults(
  count: number,
  baseOverrides: Partial<SearchResult> = {},
): SearchResult[] {
  return Array.from({ length: count }, (_, i) =>
    createSearchResult({
      id: `doc-${i + 1}`,
      score: 1 - i * 0.1,
      ...baseOverrides,
    }),
  );
}

/** Create a BM25Document with sensible defaults. */
export function createBM25Document(
  overrides: Partial<BM25Document> = {},
): BM25Document {
  return {
    id: overrides.id ?? `bm25-${Math.random().toString(36).slice(2, 8)}`,
    content:
      overrides.content ?? 'Machine learning is a subset of artificial intelligence.',
    metadata: overrides.metadata ?? { source: 'test.md' },
  };
}

/** Create an array of BM25Documents. */
export function createBM25Documents(
  count: number,
  contentsOrOverrides?: string[] | Partial<BM25Document>[],
): BM25Document[] {
  return Array.from({ length: count }, (_, i) => {
    if (Array.isArray(contentsOrOverrides) && contentsOrOverrides[i]) {
      const item = contentsOrOverrides[i];
      if (typeof item === 'string') {
        return createBM25Document({ id: `bm25-${i + 1}`, content: item });
      }
      return createBM25Document({ id: `bm25-${i + 1}`, ...item });
    }
    return createBM25Document({ id: `bm25-${i + 1}` });
  });
}

/** Create a RawDocument with sensible defaults. */
export function createRawDocument(
  overrides: Partial<RawDocument> & {
    metadata?: Partial<RawDocument['metadata']>;
  } = {},
): RawDocument {
  return {
    id: overrides.id ?? `raw-${Math.random().toString(36).slice(2, 8)}`,
    content: overrides.content ?? 'This is a test document with some content.',
    metadata: {
      source: overrides.metadata?.source ?? '/test/document.md',
      filename: overrides.metadata?.filename ?? 'document.md',
      extension: overrides.metadata?.extension ?? '.md',
      sizeBytes: overrides.metadata?.sizeBytes ?? 42,
      loadedAt: overrides.metadata?.loadedAt ?? '2025-01-01T00:00:00.000Z',
    },
  };
}

/** Create a VectorDocument with sensible defaults. */
export function createVectorDocument(
  overrides: Partial<VectorDocument> = {},
  dims: number = 384,
): VectorDocument {
  const id =
    overrides.id ?? `vec-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    vector: overrides.vector ?? deterministicVector(id, dims),
    content: overrides.content ?? 'Test vector document content.',
    metadata: overrides.metadata ?? { source: 'test.md' },
  };
}

// ---------------------------------------------------------------------------
// Pre-built test datasets
// ---------------------------------------------------------------------------

/** A set of documents about different topics for testing hybrid search. */
export const TEST_DOCUMENTS: BM25Document[] = [
  {
    id: 'ml-basics',
    content:
      'Machine learning is a branch of artificial intelligence that focuses on building systems that learn from data. Supervised learning uses labeled examples to train models.',
    metadata: { source: 'ml-guide.md', topic: 'machine-learning' },
  },
  {
    id: 'deep-learning',
    content:
      'Deep learning uses neural networks with many layers to model complex patterns. Convolutional neural networks excel at image recognition tasks.',
    metadata: { source: 'dl-guide.md', topic: 'deep-learning' },
  },
  {
    id: 'nlp-intro',
    content:
      'Natural language processing enables computers to understand human language. Techniques include tokenization, stemming, and named entity recognition.',
    metadata: { source: 'nlp-guide.md', topic: 'nlp' },
  },
  {
    id: 'transformers',
    content:
      'The transformer architecture uses self-attention mechanisms to process sequences in parallel. BERT and GPT are popular transformer-based models.',
    metadata: { source: 'transformers.md', topic: 'transformers' },
  },
  {
    id: 'rag-overview',
    content:
      'Retrieval-augmented generation combines information retrieval with language models. The system first retrieves relevant documents, then generates answers based on the retrieved context.',
    metadata: { source: 'rag.md', topic: 'rag' },
  },
  {
    id: 'vector-db',
    content:
      'Vector databases store embeddings and enable fast similarity search. They use algorithms like HNSW and IVF for approximate nearest neighbor search.',
    metadata: { source: 'vector-db.md', topic: 'databases' },
  },
  {
    id: 'bm25-algo',
    content:
      'BM25 is a ranking function used by search engines to rank documents by relevance. It considers term frequency, inverse document frequency, and document length.',
    metadata: { source: 'bm25.md', topic: 'search' },
  },
  {
    id: 'embeddings',
    content:
      'Text embeddings represent words and sentences as dense numerical vectors. Similar texts have vectors that are close together in the embedding space.',
    metadata: { source: 'embeddings.md', topic: 'embeddings' },
  },
  {
    id: 'eval-metrics',
    content:
      'Information retrieval metrics include precision, recall, MRR, and NDCG. These metrics evaluate how well a search system ranks relevant documents.',
    metadata: { source: 'eval.md', topic: 'evaluation' },
  },
  {
    id: 'hybrid-search',
    content:
      'Hybrid search combines keyword-based search like BM25 with vector similarity search. Reciprocal rank fusion is used to merge results from both approaches.',
    metadata: { source: 'hybrid.md', topic: 'search' },
  },
];

/** Pre-built raw documents for ingestion/chunker tests. */
export const TEST_RAW_DOCUMENTS: RawDocument[] = [
  {
    id: 'raw-ml',
    content: `# Machine Learning Guide

Machine learning is a subset of artificial intelligence.

It focuses on building systems that can learn from data.

## Supervised Learning

Supervised learning uses labeled training data to learn a mapping from inputs to outputs. Common algorithms include linear regression, decision trees, and neural networks.

## Unsupervised Learning

Unsupervised learning finds hidden patterns in unlabeled data. Clustering and dimensionality reduction are key techniques.`,
    metadata: {
      source: '/docs/ml-guide.md',
      filename: 'ml-guide.md',
      extension: '.md',
      sizeBytes: 400,
      loadedAt: '2025-01-01T00:00:00.000Z',
    },
  },
  {
    id: 'raw-rag',
    content: `# Retrieval-Augmented Generation

RAG combines retrieval with generation. The pipeline has three stages:

1. Document ingestion and indexing
2. Query-time retrieval of relevant passages
3. LLM-based answer generation from retrieved context

## Benefits

RAG reduces hallucination by grounding answers in retrieved documents. It also enables updating knowledge without retraining the model.`,
    metadata: {
      source: '/docs/rag-guide.md',
      filename: 'rag-guide.md',
      extension: '.md',
      sizeBytes: 350,
      loadedAt: '2025-01-01T00:00:00.000Z',
    },
  },
];

/** Pre-built search results for reranker / pipeline tests */
export const TEST_SEARCH_RESULTS: SearchResult[] = [
  {
    id: 'ml-basics',
    score: 0.92,
    content:
      'Machine learning is a branch of artificial intelligence that focuses on building systems that learn from data.',
    metadata: { source: 'ml-guide.md' },
  },
  {
    id: 'deep-learning',
    score: 0.87,
    content:
      'Deep learning uses neural networks with many layers to model complex patterns.',
    metadata: { source: 'dl-guide.md' },
  },
  {
    id: 'transformers',
    score: 0.82,
    content:
      'The transformer architecture uses self-attention mechanisms to process sequences in parallel.',
    metadata: { source: 'transformers.md' },
  },
  {
    id: 'rag-overview',
    score: 0.78,
    content:
      'Retrieval-augmented generation combines information retrieval with language models.',
    metadata: { source: 'rag.md' },
  },
  {
    id: 'nlp-intro',
    score: 0.73,
    content:
      'Natural language processing enables computers to understand human language.',
    metadata: { source: 'nlp-guide.md' },
  },
];

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

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

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Produce a deterministic, unit-length vector for a given text. */
export function deterministicVector(text: string, dims: number): number[] {
  const rng = mulberry32(hashString(text));
  const raw = Array.from({ length: dims }, () => rng() * 2 - 1);
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0)) || 1;
  return raw.map((v) => v / norm);
}
