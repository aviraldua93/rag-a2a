/**
 * Unit tests for config loading.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { loadConfig, type RagConfig } from '../../src/config.ts';

describe('loadConfig', () => {
  // Save original env and restore after each test
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test('returns correct default values when no env vars are set', () => {
    // Clear relevant env vars
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_COLLECTION;
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.GENERATION_MODEL;
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.TOP_K;
    delete process.env.HYBRID_WEIGHT;
    delete process.env.RERANK_TOP_K;
    delete process.env.CHUNK_STRATEGY;
    delete process.env.CHUNK_SIZE;
    delete process.env.CHUNK_OVERLAP;

    const config = loadConfig();

    expect(config.qdrant.url).toBe('http://localhost:6333');
    expect(config.qdrant.collectionName).toBe('rag-a2a');
    expect(config.qdrant.vectorSize).toBe(1536);
    expect(config.openai.apiKey).toBe('');
    expect(config.openai.embeddingModel).toBe('text-embedding-3-small');
    expect(config.openai.generationModel).toBe('gpt-4o-mini');
    expect(config.server.port).toBe(3737);
    expect(config.server.host).toBe('localhost');
    expect(config.retrieval.topK).toBe(10);
    expect(config.retrieval.hybridWeight).toBeCloseTo(0.7, 5);
    expect(config.retrieval.rerankTopK).toBe(5);
    expect(config.chunking.strategy).toBe('recursive');
    expect(config.chunking.chunkSize).toBe(512);
    expect(config.chunking.chunkOverlap).toBe(64);
  });

  test('env var overrides are applied correctly', () => {
    process.env.QDRANT_URL = 'http://custom:6334';
    process.env.QDRANT_COLLECTION = 'my-collection';
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.EMBEDDING_MODEL = 'text-embedding-ada-002';
    process.env.GENERATION_MODEL = 'gpt-4';
    process.env.PORT = '9999';
    process.env.HOST = '0.0.0.0';
    process.env.TOP_K = '20';
    process.env.HYBRID_WEIGHT = '0.5';
    process.env.RERANK_TOP_K = '3';
    process.env.CHUNK_STRATEGY = 'sliding-window';
    process.env.CHUNK_SIZE = '1024';
    process.env.CHUNK_OVERLAP = '128';

    const config = loadConfig();

    expect(config.qdrant.url).toBe('http://custom:6334');
    expect(config.qdrant.collectionName).toBe('my-collection');
    expect(config.openai.apiKey).toBe('sk-test-key');
    expect(config.openai.embeddingModel).toBe('text-embedding-ada-002');
    expect(config.openai.generationModel).toBe('gpt-4');
    expect(config.server.port).toBe(9999);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.retrieval.topK).toBe(20);
    expect(config.retrieval.hybridWeight).toBeCloseTo(0.5, 5);
    expect(config.retrieval.rerankTopK).toBe(3);
    expect(config.chunking.strategy).toBe('sliding-window');
    expect(config.chunking.chunkSize).toBe(1024);
    expect(config.chunking.chunkOverlap).toBe(128);
  });

  test('returns correctly typed values (numbers, strings)', () => {
    const config = loadConfig();

    // Numeric fields
    expect(typeof config.server.port).toBe('number');
    expect(typeof config.retrieval.topK).toBe('number');
    expect(typeof config.retrieval.hybridWeight).toBe('number');
    expect(typeof config.retrieval.rerankTopK).toBe('number');
    expect(typeof config.chunking.chunkSize).toBe('number');
    expect(typeof config.chunking.chunkOverlap).toBe('number');
    expect(typeof config.qdrant.vectorSize).toBe('number');

    // String fields
    expect(typeof config.qdrant.url).toBe('string');
    expect(typeof config.qdrant.collectionName).toBe('string');
    expect(typeof config.openai.apiKey).toBe('string');
    expect(typeof config.openai.embeddingModel).toBe('string');
    expect(typeof config.server.host).toBe('string');
    expect(typeof config.chunking.strategy).toBe('string');
  });
});
