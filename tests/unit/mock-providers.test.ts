/**
 * Unit tests for MockEmbedder (from src/embeddings/mock.ts) and
 * MockGenerator (from src/generation/generator.ts).
 */
import { describe, test, expect } from 'bun:test';
import { MockEmbedder } from '../../src/embeddings/mock.ts';
import { MockGenerator } from '../../src/generation/generator.ts';
import type { SearchResult } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// MockEmbedder
// ---------------------------------------------------------------------------

describe('MockEmbedder', () => {
  test('same text produces identical vectors (determinism)', async () => {
    const embedder = new MockEmbedder();
    const v1 = await embedder.embed('hello world');
    const v2 = await embedder.embed('hello world');
    expect(v1).toEqual(v2);
    expect(v1.length).toBe(384);
  });

  test('different texts produce different vectors', async () => {
    const embedder = new MockEmbedder();
    const v1 = await embedder.embed('text alpha');
    const v2 = await embedder.embed('text beta');
    expect(v1).not.toEqual(v2);
  });

  test('vectors are unit-length (L2-normalized)', async () => {
    const embedder = new MockEmbedder();
    const vec = await embedder.embed('normalization test');
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  test('embedBatch returns correct number of vectors', async () => {
    const embedder = new MockEmbedder();
    const vecs = await embedder.embedBatch(['a', 'b', 'c']);
    expect(vecs.length).toBe(3);
    expect(vecs[0].length).toBe(384);
    expect(vecs[1].length).toBe(384);
  });

  test('dimensions and modelName are set correctly', () => {
    const embedder = new MockEmbedder();
    expect(embedder.dimensions).toBe(384);
    expect(embedder.modelName).toBe('mock-embedding');
  });
});

// ---------------------------------------------------------------------------
// MockGenerator
// ---------------------------------------------------------------------------

const sampleContexts: SearchResult[] = [
  { id: 'doc-1', score: 0.95, content: 'ML is great for data analysis', metadata: { source: 'ml.md' } },
  { id: 'doc-2', score: 0.85, content: 'Deep learning uses neural nets', metadata: { source: 'dl.md' } },
];

describe('MockGenerator', () => {
  test('generate() returns expected structure with answer, sources, model', async () => {
    const gen = new MockGenerator();
    const result = await gen.generate('What is ML?', sampleContexts);

    expect(result.answer).toBeTruthy();
    expect(result.answer).toContain('Based on the provided documents');
    expect(result.answer).toContain('[Source 1]');
    expect(result.answer).toContain('[Source 2]');
    expect(result.model).toBe('mock');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].id).toBe('doc-1');
    expect(typeof result.tokensUsed).toBe('number');
    expect(typeof result.durationMs).toBe('number');
  });

  test('generate() with empty contexts returns cannot-find message', async () => {
    const gen = new MockGenerator();
    const result = await gen.generate('Unknown query', []);
    expect(result.answer).toContain('cannot find the answer');
    expect(result.sources).toHaveLength(0);
  });

  test('generateStream() yields source, text, and done chunks in order', async () => {
    const gen = new MockGenerator();
    const chunks: { type: string; content: string }[] = [];

    for await (const chunk of gen.generateStream('What is ML?', sampleContexts)) {
      chunks.push(chunk);
    }

    // Should start with source chunks (one per context)
    expect(chunks[0].type).toBe('source');
    expect(chunks[1].type).toBe('source');

    // Followed by text chunks
    const textChunks = chunks.filter((c) => c.type === 'text');
    expect(textChunks.length).toBeGreaterThan(0);

    // Ends with done
    expect(chunks[chunks.length - 1].type).toBe('done');
    expect(chunks[chunks.length - 1].content).toBe('');
  });

  test('generateStream() source chunks contain valid JSON with id and score', async () => {
    const gen = new MockGenerator();
    const sources: any[] = [];

    for await (const chunk of gen.generateStream('Query', sampleContexts)) {
      if (chunk.type === 'source') {
        sources.push(JSON.parse(chunk.content));
      }
    }

    expect(sources).toHaveLength(2);
    expect(sources[0].id).toBe('doc-1');
    expect(sources[0].index).toBe(1);
    expect(sources[0].score).toBe(0.95);
    expect(sources[1].id).toBe('doc-2');
    expect(sources[1].index).toBe(2);
  });
});
