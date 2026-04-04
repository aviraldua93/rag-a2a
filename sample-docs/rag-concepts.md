# RAG: Retrieval-Augmented Generation

## What is RAG?

Retrieval-Augmented Generation (RAG) is a technique that enhances Large Language Model (LLM) outputs by grounding them in external knowledge retrieved at query time. Instead of relying solely on the parametric knowledge baked into model weights during training, RAG systems fetch relevant documents from a knowledge base and inject them into the LLM's context window alongside the user's question. This dramatically reduces hallucination, keeps answers current without retraining, and provides traceable source citations that users can verify.

## The RAG Pipeline

A production RAG system is a pipeline with seven distinct stages. Each stage has its own design decisions, trade-offs, and failure modes.

### 1. Document Ingestion

Raw documents — Markdown files, PDFs, HTML pages, code repositories — are loaded, cleaned, and normalized into plain text. Ingestion handles format conversion, metadata extraction (title, author, date, source URL), and deduplication. A robust ingestion pipeline is idempotent: re-ingesting the same document produces the same output without duplicating data in the store.

### 2. Chunking Strategies

Documents are split into chunks — the atomic units of retrieval. Chunk size directly impacts retrieval quality: too large and chunks contain irrelevant information that dilutes the signal; too small and chunks lose context needed for coherent answers. The optimal chunk size depends on the embedding model's context window, the domain, and the types of questions users ask.

#### Sliding Window

The simplest strategy. A fixed-size window (e.g., 512 tokens) slides across the document with a configurable overlap (e.g., 64 tokens). Overlap ensures that information at chunk boundaries isn't lost. Fast and predictable, but blind to semantic boundaries — a chunk might split a paragraph or code block mid-thought.

#### Semantic Chunking

Uses embedding similarity to detect natural breakpoints. Adjacent sentences are embedded, and a new chunk boundary is created when the cosine similarity between consecutive sentence embeddings drops below a threshold. This produces variable-length chunks that respect topical coherence, but is more computationally expensive and sensitive to the threshold parameter.

#### Recursive Chunking

A hierarchical approach that first splits on the largest structural boundaries (e.g., headings, double newlines), then recursively splits oversized chunks on smaller boundaries (single newlines, sentences, words) until all chunks are below the target size. This preserves document structure while respecting size limits. It's the default strategy in most production systems because it balances quality and simplicity.

### 3. Embedding Generation

Each chunk is converted into a dense vector representation using an embedding model. The embedding captures semantic meaning — chunks about similar topics will have vectors that are close together in the embedding space. Common models include OpenAI's `text-embedding-3-small` (1536 dimensions), Cohere's `embed-v3`, and open-source alternatives like `bge-large` or `e5-mistral`. The choice of embedding model determines the quality ceiling for retrieval: no amount of clever retrieval logic can compensate for poor embeddings.

### 4. Vector Storage

Embeddings and their associated metadata are stored in a vector database optimized for approximate nearest neighbor (ANN) search. Popular options include Qdrant, Pinecone, Weaviate, Milvus, and pgvector. Vector databases use indexing algorithms like HNSW (Hierarchical Navigable Small World) or IVF (Inverted File Index) to enable sub-millisecond similarity search over millions of vectors. Key considerations include dimensionality support, filtering capabilities, multi-tenancy, and whether the database supports hybrid search natively.

### 5. Retrieval

At query time, the user's question is embedded using the same model used during ingestion, and the resulting vector is used to search the vector store for the most similar chunks. The `top_k` parameter controls how many chunks are retrieved. Retrieval can operate in three modes:

- **Vector-only**: Pure cosine similarity search. Excellent for semantic matching ("What is the purpose of the wave executor?") but can miss exact keyword matches.
- **Keyword-only**: BM25 or similar term-frequency algorithms. Excellent for precise terminology and proper nouns but blind to paraphrases.
- **Hybrid**: Combines both approaches for maximum recall (see Hybrid Search section below).

### 6. Reranking

The initial retrieval step optimizes for recall — casting a wide net. Reranking optimizes for precision. A cross-encoder model (e.g., Cohere Rerank, `bge-reranker-large`) takes each (query, chunk) pair and produces a relevance score that's more accurate than the cosine similarity from step 5, because it attends to both texts jointly rather than comparing pre-computed embeddings. Reranking is applied to the top-k results from retrieval, and only the top-n (where n < k) are passed to the generator. This two-stage approach balances speed (fast vector search) with accuracy (slow but precise cross-encoding).

### 7. Answer Generation

The reranked chunks are formatted into a prompt template and sent to an LLM along with the user's question. The prompt instructs the model to answer based only on the provided context, cite sources, and say "I don't know" when the context is insufficient. Streaming the response token-by-token over SSE provides a responsive user experience. The generation step should also return metadata about which chunks were used, enabling source attribution in the UI.

## Hybrid Search

Hybrid search combines the semantic understanding of vector similarity with the precision of keyword matching. Neither approach alone is sufficient for production use.

### Vector Similarity (Dense Retrieval)

Embeds the query and retrieves chunks whose vectors are closest by cosine similarity. Handles paraphrasing, synonyms, and conceptual queries well. Struggles with rare terms, acronyms, and exact-match requirements.

### BM25 Keyword Search (Sparse Retrieval)

A probabilistic ranking function based on term frequency and inverse document frequency. Excels at exact matches and rare terms. Fails on semantic similarity — "automobile" won't match "car" unless both appear in the corpus.

### Reciprocal Rank Fusion (RRF)

RRF is the most common method for combining ranked lists from different retrieval systems. For each result, its RRF score is computed as:

```
RRF(d) = Σ 1 / (k + rank_i(d))
```

where `k` is a constant (typically 60) and `rank_i(d)` is the rank of document `d` in the i-th ranked list. RRF is robust because it doesn't require score normalization across systems — it only uses rank positions. A document that appears at rank 1 in one system and rank 10 in another will still score higher than a document at rank 5 in both.

An alternative approach uses a configurable weight parameter (`hybridWeight`) to blend normalized scores: `score = w * vector_score + (1 - w) * keyword_score`. This gives operators direct control over the balance but requires careful score normalization.

## Evaluation

Evaluating RAG systems requires metrics that go beyond standard NLP benchmarks. The RAGAS framework provides a comprehensive evaluation suite.

### Faithfulness

Measures whether the generated answer is faithful to the retrieved context. A faithfulness score of 1.0 means every claim in the answer can be traced to the provided chunks. Low faithfulness indicates hallucination — the model is generating information not present in the context.

### Context Precision

Measures whether the retrieved chunks are relevant to the question. High precision means most retrieved chunks contain useful information. Low precision means the retrieval is returning noise that wastes context window tokens and can confuse the generator.

### Context Recall

Measures whether all the information needed to answer the question was retrieved. Low recall means relevant chunks exist in the knowledge base but weren't surfaced by the retrieval step.

### Answer Relevancy

Measures whether the generated answer actually addresses the question asked. An answer can be faithful to the context (high faithfulness) but still irrelevant if it focuses on the wrong aspect of the retrieved information. Answer relevancy uses the LLM to generate hypothetical questions from the answer and measures their similarity to the original question.

### End-to-End Evaluation

Production RAG systems should track these metrics continuously, not just during development. A common approach is to maintain a golden dataset of question-answer pairs with annotated relevant chunks, and run automated evaluation after each ingestion or configuration change. Regression alerts fire when any metric drops below a threshold, catching quality degradation before it reaches users.
