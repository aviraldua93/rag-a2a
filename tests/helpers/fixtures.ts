/**
 * Reusable test fixtures — sample queries, documents, and constants
 * designed for deterministic BM25 scoring and evaluation testing.
 */

import type { SearchResult } from '../../src/store/types.ts';
import type { BM25Document } from '../../src/retrieval/bm25.ts';

// ---------------------------------------------------------------------------
// Sample queries grouped by expected topic
// ---------------------------------------------------------------------------

/** Queries that should match ML-related documents */
export const ML_QUERIES = [
  'What is machine learning?',
  'How does supervised learning work?',
  'Explain artificial intelligence and machine learning',
  'What are the types of machine learning algorithms?',
] as const;

/** Queries that should match NLP / transformer documents */
export const NLP_QUERIES = [
  'What is natural language processing?',
  'Explain the transformer architecture',
  'How does self-attention work in transformers?',
  'What is tokenization in NLP?',
] as const;

/** Queries that should match RAG / search documents */
export const RAG_QUERIES = [
  'What is retrieval-augmented generation?',
  'How does hybrid search work?',
  'Explain BM25 ranking algorithm',
  'What are vector databases used for?',
] as const;

/** A general set of queries for pipeline tests */
export const SAMPLE_QUERIES = [
  ...ML_QUERIES.slice(0, 2),
  ...NLP_QUERIES.slice(0, 2),
  ...RAG_QUERIES.slice(0, 2),
] as const;

// ---------------------------------------------------------------------------
// BM25 documents with known content for deterministic scoring
// ---------------------------------------------------------------------------

/**
 * Documents specifically crafted so that BM25 scoring is predictable:
 * - Each document has a clear primary topic.
 * - Term frequencies are controlled.
 * - Document lengths vary to test length normalization.
 */
export const BM25_TEST_CORPUS: BM25Document[] = [
  {
    id: 'doc-ml-short',
    content: 'Machine learning algorithms learn patterns from data.',
    metadata: { source: 'ml.md', topic: 'ml' },
  },
  {
    id: 'doc-ml-long',
    content:
      'Machine learning is a field of computer science that gives computers the ability to learn without being explicitly programmed. Machine learning algorithms build mathematical models based on sample data, known as training data, to make predictions or decisions. Machine learning is closely related to computational statistics.',
    metadata: { source: 'ml-detailed.md', topic: 'ml' },
  },
  {
    id: 'doc-dl',
    content:
      'Deep learning is a subset of machine learning that uses artificial neural networks with multiple layers. Deep learning models can learn hierarchical representations of data.',
    metadata: { source: 'dl.md', topic: 'deep-learning' },
  },
  {
    id: 'doc-nlp',
    content:
      'Natural language processing is a field of artificial intelligence concerned with interactions between computers and human language. Tokenization and stemming are key preprocessing steps.',
    metadata: { source: 'nlp.md', topic: 'nlp' },
  },
  {
    id: 'doc-search',
    content:
      'Information retrieval systems rank documents by relevance to a query. BM25 is a bag-of-words retrieval function that ranks documents based on query terms appearing in each document.',
    metadata: { source: 'search.md', topic: 'search' },
  },
  {
    id: 'doc-rag',
    content:
      'Retrieval-augmented generation combines a retrieval component with a generative language model. The retrieval step finds relevant documents, and the generation step produces answers grounded in the retrieved context.',
    metadata: { source: 'rag.md', topic: 'rag' },
  },
  {
    id: 'doc-embeddings',
    content:
      'Word embeddings map words to dense vectors in a continuous space. Similar words have similar vector representations. Embeddings capture semantic relationships between words.',
    metadata: { source: 'embeddings.md', topic: 'embeddings' },
  },
  {
    id: 'doc-transformers',
    content:
      'Transformers use self-attention to weigh the importance of different parts of the input. The transformer architecture has an encoder and a decoder. BERT uses only the encoder, while GPT uses only the decoder.',
    metadata: { source: 'transformers.md', topic: 'transformers' },
  },
  {
    id: 'doc-vector-db',
    content:
      'Vector databases index high-dimensional vectors for efficient similarity search. They use approximate nearest neighbor algorithms like HNSW. Popular vector databases include Qdrant, Pinecone, and Milvus.',
    metadata: { source: 'vector-db.md', topic: 'databases' },
  },
  {
    id: 'doc-evaluation',
    content:
      'Evaluation metrics for information retrieval include precision, recall, F1 score, mean reciprocal rank, and normalized discounted cumulative gain. These metrics measure how well a system ranks relevant documents.',
    metadata: { source: 'evaluation.md', topic: 'evaluation' },
  },
];

// ---------------------------------------------------------------------------
// Expected relevance mappings (for evaluation tests)
// ---------------------------------------------------------------------------

/** Maps query string to IDs of relevant documents in BM25_TEST_CORPUS. */
export const RELEVANCE_MAP: Record<string, string[]> = {
  'machine learning algorithms': ['doc-ml-short', 'doc-ml-long', 'doc-dl'],
  'natural language processing': ['doc-nlp', 'doc-transformers'],
  'retrieval augmented generation': ['doc-rag', 'doc-search'],
  'vector database similarity search': ['doc-vector-db', 'doc-embeddings'],
  'evaluation metrics precision recall': ['doc-evaluation'],
  'deep learning neural networks': ['doc-dl', 'doc-ml-long'],
  'transformer architecture attention': ['doc-transformers'],
  'BM25 ranking function': ['doc-search', 'doc-evaluation'],
  'word embeddings vectors': ['doc-embeddings', 'doc-vector-db'],
};

// ---------------------------------------------------------------------------
// Golden dataset for evaluation runner tests
// ---------------------------------------------------------------------------

export const GOLDEN_DATASET = Object.entries(RELEVANCE_MAP).map(
  ([query, relevantDocumentIds]) => ({
    query,
    relevantDocumentIds,
  }),
);

// ---------------------------------------------------------------------------
// Sample search results with known scores for metric tests
// ---------------------------------------------------------------------------

/** Results where item at index 0 is relevant (id: 'relevant-1') */
export function createRankedResults(
  relevantPositions: number[],
  total: number = 10,
): { results: SearchResult[]; relevantIds: Set<string> } {
  const relevantIds = new Set<string>();
  const results: SearchResult[] = [];

  for (let i = 0; i < total; i++) {
    const isRelevant = relevantPositions.includes(i);
    const id = isRelevant
      ? `relevant-${relevantIds.size + 1}`
      : `irrelevant-${i + 1}`;
    if (isRelevant) relevantIds.add(id);

    results.push({
      id,
      score: 1 - i * 0.05,
      content: isRelevant
        ? `This is relevant content about the query topic ${i}.`
        : `This is unrelated content about something else ${i}.`,
      metadata: { source: `doc-${i}.md` },
    });
  }

  return { results, relevantIds };
}

// ---------------------------------------------------------------------------
// Server test constants
// ---------------------------------------------------------------------------

/** Port range for test servers to avoid conflicts */
export const TEST_PORT_MIN = 49200;
export const TEST_PORT_MAX = 49999;

/** Get a random available test port */
export function getTestPort(): number {
  return (
    TEST_PORT_MIN + Math.floor(Math.random() * (TEST_PORT_MAX - TEST_PORT_MIN))
  );
}

/** Base URL for test server */
export function getTestBaseUrl(port: number): string {
  return `http://localhost:${port}`;
}

// ---------------------------------------------------------------------------
// Chunker test content
// ---------------------------------------------------------------------------

/** Long document with clear paragraph boundaries for semantic chunking tests */
export const LONG_DOCUMENT_CONTENT = `# Introduction to Machine Learning

Machine learning is a rapidly growing field of computer science that gives computers the ability to learn without being explicitly programmed.

## Supervised Learning

Supervised learning is a type of machine learning where the model is trained on labeled data. The algorithm learns a mapping from inputs to outputs based on example input-output pairs. Common supervised learning algorithms include linear regression, logistic regression, decision trees, random forests, and support vector machines.

## Unsupervised Learning

Unsupervised learning deals with unlabeled data. The goal is to find hidden patterns or intrinsic structures in the data. Key techniques include clustering algorithms like K-means and DBSCAN, and dimensionality reduction methods like PCA and t-SNE.

## Reinforcement Learning

Reinforcement learning is about training agents to make sequences of decisions. The agent learns to achieve a goal in an uncertain, potentially complex environment by receiving rewards or penalties for actions taken. Applications include game playing, robotics, and autonomous driving.

## Deep Learning

Deep learning is a subset of machine learning that uses artificial neural networks with many layers. These deep neural networks can learn complex hierarchical representations of data. Convolutional neural networks are used for image processing, while recurrent neural networks handle sequential data like text and time series.`;

/** Short document for edge case tests */
export const SHORT_DOCUMENT_CONTENT = 'Hello world.';

/** Empty document content */
export const EMPTY_DOCUMENT_CONTENT = '';

/** Document with no paragraph breaks (single block) */
export const SINGLE_PARAGRAPH_CONTENT =
  'This is a single paragraph without any paragraph breaks or double newlines. It should be treated as one semantic unit by the semantic chunker. The content continues without interruption for testing purposes. Additional words are added to make this paragraph long enough to potentially be split by the sliding window strategy with a small chunk size.';
