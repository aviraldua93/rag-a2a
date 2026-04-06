/**
 * Unit tests for the HyDE (Hypothetical Document Embedding) expander
 * (src/retrieval/hyde.ts).
 *
 * Verifies hypothetical generation, embedding of the hypothetical answer,
 * and graceful fallback when generation fails or no generator is configured.
 */
import { describe, test, expect } from 'bun:test';
import { HyDEExpander, type HyDEGenerator } from '../../src/retrieval/hyde.ts';
import { MockEmbeddingProvider, MockTestGenerator } from '../helpers/mocks.ts';
import { RetrievalPipeline, type RetrievalPipelineOptions } from '../../src/retrieval/pipeline.ts';
import { MemoryStore } from '../../src/store/memory.ts';
import { ScoreReranker } from '../../src/retrieval/reranker.ts';
import { BM25_TEST_CORPUS } from '../helpers/fixtures.ts';
import type { GenerationResult, StreamChunk } from '../../src/generation/types.ts';
import type { SearchResult } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIMS = 384;

/** A generator that always fails, simulating an unavailable LLM. */
class FailingGenerator implements HyDEGenerator {
  async generate(): Promise<GenerationResult> {
    throw new Error('LLM unavailable');
  }
}

/** A generator that returns an empty answer. */
class EmptyGenerator implements HyDEGenerator {
  async generate(query: string): Promise<GenerationResult> {
    return {
      answer: '',
      sources: [],
      model: 'empty-mock',
      durationMs: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// HyDEExpander – core behaviour
// ---------------------------------------------------------------------------

describe('HyDEExpander', () => {
  test('generates a hypothetical answer and returns its embedding', async () => {
    const generator = new MockTestGenerator();
    const embedder = new MockEmbeddingProvider(DIMS);
    const expander = new HyDEExpander(generator, embedder);

    const result = await expander.expand('What is machine learning?');

    expect(result).not.toBeNull();
    expect(result!.hypothetical).toBeTruthy();
    expect(result!.hypothetical.length).toBeGreaterThan(0);
    expect(result!.vector).toHaveLength(DIMS);

    // Verify the generator was called
    expect(generator.calls.generate.length).toBe(1);
    // Verify the embedder was called with the hypothetical answer
    expect(embedder.calls.embed.length).toBe(1);
    expect(embedder.calls.embed[0]).toBe(result!.hypothetical);
  });

  test('hypothetical embedding differs from direct query embedding', async () => {
    const embedder = new MockEmbeddingProvider(DIMS);
    const generator = new MockTestGenerator();
    const expander = new HyDEExpander(generator, embedder);

    const hydeResult = await expander.expand('What is machine learning?');
    const directEmbed = await embedder.embed('What is machine learning?');

    expect(hydeResult).not.toBeNull();
    // The HyDE vector is the embedding of the hypothetical answer, not the query
    // With deterministic mock embeddings, the vectors will differ because the
    // hypothetical text differs from the original query
    expect(hydeResult!.vector).not.toEqual(directEmbed);
  });

  test('returns null when generator throws', async () => {
    const generator = new FailingGenerator();
    const embedder = new MockEmbeddingProvider(DIMS);
    const expander = new HyDEExpander(generator, embedder);

    const result = await expander.expand('What is NLP?');

    expect(result).toBeNull();
    // Embedder should not have been called since generation failed
    expect(embedder.calls.embed.length).toBe(0);
  });

  test('returns null when generator returns empty answer', async () => {
    const generator = new EmptyGenerator();
    const embedder = new MockEmbeddingProvider(DIMS);
    const expander = new HyDEExpander(generator, embedder);

    const result = await expander.expand('What is NLP?');

    expect(result).toBeNull();
  });

  test('expand is called with a HyDE-specific prompt, not the raw query', async () => {
    const generator = new MockTestGenerator();
    const embedder = new MockEmbeddingProvider(DIMS);
    const expander = new HyDEExpander(generator, embedder);

    await expander.expand('What is deep learning?');

    // The generator should receive a prompt that instructs it to write a
    // hypothetical answer, not just the raw query
    const calledQuery = generator.calls.generate[0].query;
    expect(calledQuery).toContain('What is deep learning?');
    expect(calledQuery).toContain('paragraph');
  });
});

// ---------------------------------------------------------------------------
// HyDE integration with RetrievalPipeline
// ---------------------------------------------------------------------------

describe('HyDE + RetrievalPipeline', () => {
  function createPipelineWithHyDE(
    hydeExpander?: HyDEExpander,
    opts: Partial<RetrievalPipelineOptions> = {},
  ) {
    const store = new MemoryStore();
    const embedder = new MockEmbeddingProvider(DIMS);
    const reranker = new ScoreReranker();
    const pipeline = new RetrievalPipeline(
      store,
      embedder,
      reranker,
      {
        topK: opts.topK ?? 5,
        hybridWeight: opts.hybridWeight ?? 0.5,
        rerankTopK: opts.rerankTopK ?? 5,
      },
      hydeExpander,
    );
    return { store, embedder, reranker, pipeline };
  }

  async function seedStore(
    store: MemoryStore,
    embedder: MockEmbeddingProvider,
    pipeline: RetrievalPipeline,
  ) {
    await store.initialize(DIMS);
    const docs = BM25_TEST_CORPUS;
    const vectors = await embedder.embedBatch(docs.map((d) => d.content));
    await store.upsert(
      docs.map((d, i) => ({
        id: d.id,
        vector: vectors[i],
        content: d.content,
        metadata: d.metadata,
      })),
    );
    pipeline.indexDocuments(docs);
  }

  test('pipeline uses HyDE when expander is provided', async () => {
    const generator = new MockTestGenerator();
    const pipeEmbedder = new MockEmbeddingProvider(DIMS);
    const hydeExpander = new HyDEExpander(generator, pipeEmbedder);
    const { pipeline, store, embedder } = createPipelineWithHyDE(hydeExpander);
    await seedStore(store, embedder, pipeline);

    const result = await pipeline.retrieve('machine learning');

    expect(result.metadata.hydeUsed).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    // Generator should have been called once
    expect(generator.calls.generate.length).toBe(1);
  });

  test('pipeline falls back to direct embedding when HyDE fails', async () => {
    const failingGenerator = new FailingGenerator();
    const pipeEmbedder = new MockEmbeddingProvider(DIMS);
    const hydeExpander = new HyDEExpander(failingGenerator, pipeEmbedder);
    const { pipeline, store, embedder } = createPipelineWithHyDE(hydeExpander);
    await seedStore(store, embedder, pipeline);

    const result = await pipeline.retrieve('machine learning');

    expect(result.metadata.hydeUsed).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
  });

  test('pipeline works normally without HyDE (no expander provided)', async () => {
    const { pipeline, store, embedder } = createPipelineWithHyDE(undefined);
    await seedStore(store, embedder, pipeline);

    const result = await pipeline.retrieve('machine learning');

    expect(result.metadata.hydeUsed).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
  });

  test('HyDE is used in vector-only mode', async () => {
    const generator = new MockTestGenerator();
    const pipeEmbedder = new MockEmbeddingProvider(DIMS);
    const hydeExpander = new HyDEExpander(generator, pipeEmbedder);
    const { pipeline, store, embedder } = createPipelineWithHyDE(hydeExpander);
    await seedStore(store, embedder, pipeline);

    const result = await pipeline.retrieve('machine learning', { mode: 'vector' });

    expect(result.metadata.hydeUsed).toBe(true);
    expect(result.metadata.vectorResultCount).toBeGreaterThan(0);
    expect(result.metadata.keywordResultCount).toBe(0);
  });

  test('HyDE is not used in keyword-only mode', async () => {
    const generator = new MockTestGenerator();
    const pipeEmbedder = new MockEmbeddingProvider(DIMS);
    const hydeExpander = new HyDEExpander(generator, pipeEmbedder);
    const { pipeline, store, embedder } = createPipelineWithHyDE(hydeExpander);
    await seedStore(store, embedder, pipeline);

    const result = await pipeline.retrieve('machine learning', { mode: 'keyword' });

    expect(result.metadata.hydeUsed).toBe(false);
    expect(result.metadata.keywordResultCount).toBeGreaterThan(0);
    // Generator should NOT have been called in keyword mode
    expect(generator.calls.generate.length).toBe(0);
  });
});
