/**
 * Unit tests for CohereReranker (src/retrieval/cohere-reranker.ts).
 *
 * Injects a mock fetch function via the constructor's fetchFn parameter.
 * Covers: reranking order, top-K slicing, error handling, empty inputs,
 * constructor validation, metadata preservation, and API request format.
 */
import { describe, test, expect } from 'bun:test';
import { CohereReranker } from '../../src/retrieval/cohere-reranker.ts';
import type { SearchResult } from '../../src/store/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(id: string, score: number, content: string, metadata: Record<string, unknown> = {}): SearchResult {
  return { id, score, content, metadata };
}

/** Build a mock Cohere Rerank API success response. */
function cohereSuccessResponse(results: Array<{ index: number; relevance_score: number }>) {
  return new Response(
    JSON.stringify({
      id: 'test-rerank-id',
      results,
      meta: { api_version: { version: '2' } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Build a mock Cohere Rerank API error response. */
function cohereErrorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Create a mock fetch that records calls and returns the given response. */
function createMockFetch(responseFn: () => Response | Promise<Response>) {
  const calls: Array<{ url: string | URL | Request; init?: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url as string, init });
    return responseFn();
  }) as typeof fetch;
  return { fn, calls };
}

/** Create a mock fetch that rejects with the given error. */
function createFailingFetch(error: Error) {
  const calls: Array<{ url: string | URL | Request; init?: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url as string, init });
    throw error;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CohereReranker', () => {
  // --- Constructor validation ---

  test('constructor throws when API key is empty', () => {
    const { fn } = createMockFetch(() => cohereSuccessResponse([]));
    expect(() => new CohereReranker('', undefined, fn)).toThrow('COHERE_API_KEY');
  });

  test('constructor throws when API key is whitespace-only', () => {
    const { fn } = createMockFetch(() => cohereSuccessResponse([]));
    expect(() => new CohereReranker('   ', undefined, fn)).toThrow('COHERE_API_KEY');
  });

  test('constructor succeeds with a valid API key', () => {
    const { fn } = createMockFetch(() => cohereSuccessResponse([]));
    const reranker = new CohereReranker('test-api-key', undefined, fn);
    expect(reranker).toBeDefined();
  });

  // --- Empty / edge case inputs ---

  test('returns empty array for empty results', async () => {
    const { fn, calls } = createMockFetch(() => cohereSuccessResponse([]));
    const reranker = new CohereReranker('test-key', undefined, fn);
    const result = await reranker.rerank('query', [], 5);
    expect(result).toEqual([]);
    expect(calls.length).toBe(0); // Should not call the API
  });

  test('returns results sliced to topK when query is empty', async () => {
    const { fn, calls } = createMockFetch(() => cohereSuccessResponse([]));
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [
      makeResult('a', 0.9, 'doc A'),
      makeResult('b', 0.8, 'doc B'),
      makeResult('c', 0.7, 'doc C'),
    ];
    const result = await reranker.rerank('', results, 2);
    expect(result.length).toBe(2);
    expect(calls.length).toBe(0); // Should not call the API
  });

  // --- Reranking order ---

  test('reranks results according to Cohere relevance scores', async () => {
    // Cohere says doc-3 (index 2) is most relevant, then doc-1, then doc-2
    const { fn } = createMockFetch(() =>
      cohereSuccessResponse([
        { index: 2, relevance_score: 0.98 },
        { index: 0, relevance_score: 0.75 },
        { index: 1, relevance_score: 0.42 },
      ]),
    );
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [
      makeResult('doc-1', 0.9, 'Machine learning overview'),
      makeResult('doc-2', 0.5, 'Deep learning neural networks'),
      makeResult('doc-3', 0.3, 'Natural language processing'),
    ];

    const reranked = await reranker.rerank('NLP query', results, 10);

    expect(reranked.length).toBe(3);
    expect(reranked[0].id).toBe('doc-3');
    expect(reranked[0].score).toBeCloseTo(0.98);
    expect(reranked[1].id).toBe('doc-1');
    expect(reranked[1].score).toBeCloseTo(0.75);
    expect(reranked[2].id).toBe('doc-2');
    expect(reranked[2].score).toBeCloseTo(0.42);
  });

  // --- Top-K slicing ---

  test('topK limits the number of returned results', async () => {
    const { fn } = createMockFetch(() =>
      cohereSuccessResponse([
        { index: 0, relevance_score: 0.95 },
        { index: 2, relevance_score: 0.80 },
      ]),
    );
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [
      makeResult('d1', 0.9, 'content 1'),
      makeResult('d2', 0.8, 'content 2'),
      makeResult('d3', 0.7, 'content 3'),
      makeResult('d4', 0.6, 'content 4'),
      makeResult('d5', 0.5, 'content 5'),
    ];

    const reranked = await reranker.rerank('test query', results, 2);
    expect(reranked.length).toBe(2);
    expect(reranked[0].id).toBe('d1');
    expect(reranked[1].id).toBe('d3');
  });

  // --- API request format ---

  test('sends correct request to Cohere API', async () => {
    const { fn, calls } = createMockFetch(() =>
      cohereSuccessResponse([
        { index: 0, relevance_score: 0.9 },
        { index: 1, relevance_score: 0.8 },
      ]),
    );
    const reranker = new CohereReranker('my-secret-key', 'rerank-v3.5', fn);
    const results = [
      makeResult('a', 0.9, 'First document'),
      makeResult('b', 0.8, 'Second document'),
    ];

    await reranker.rerank('test query', results, 5);

    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call.url).toBe('https://api.cohere.com/v2/rerank');
    expect(call.init!.method).toBe('POST');

    const headers = call.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call.init!.body as string);
    expect(body.model).toBe('rerank-v3.5');
    expect(body.query).toBe('test query');
    expect(body.documents).toEqual(['First document', 'Second document']);
    expect(body.top_n).toBe(5);
    expect(body.return_documents).toBe(false);
  });

  // --- Error handling ---

  test('throws descriptive error on API 401', async () => {
    const { fn } = createMockFetch(() => cohereErrorResponse(401, 'invalid api token'));
    const reranker = new CohereReranker('bad-key', undefined, fn);
    const results = [makeResult('a', 0.9, 'doc')];

    await expect(reranker.rerank('query', results, 5)).rejects.toThrow(
      /Cohere Rerank API error \(401\)/,
    );
  });

  test('throws descriptive error on API 429 rate limit (after retries)', async () => {
    const { fn } = createMockFetch(() => cohereErrorResponse(429, 'rate limit exceeded'));
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [makeResult('a', 0.9, 'doc')];

    await expect(reranker.rerank('query', results, 5)).rejects.toThrow(
      /Cohere Rerank API error \(429\)/,
    );
  });

  test('throws descriptive error on API 500 (after retries)', async () => {
    const { fn } = createMockFetch(() => cohereErrorResponse(500, 'internal server error'));
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [makeResult('a', 0.9, 'doc')];

    await expect(reranker.rerank('query', results, 5)).rejects.toThrow(
      /Cohere Rerank API error \(500\)/,
    );
  });

  test('throws on network fetch failure', async () => {
    const { fn } = createFailingFetch(new Error('Network error'));
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [makeResult('a', 0.9, 'doc')];

    await expect(reranker.rerank('query', results, 5)).rejects.toThrow('Network error');
  });

  test('retries on 429 and succeeds on subsequent attempt', async () => {
    let callCount = 0;
    const fn = (async () => {
      callCount++;
      if (callCount <= 1) return cohereErrorResponse(429, 'rate limited');
      return cohereSuccessResponse([{ index: 0, relevance_score: 0.95 }]);
    }) as unknown as typeof fetch;

    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [makeResult('a', 0.9, 'doc')];
    const reranked = await reranker.rerank('query', results, 5);

    expect(reranked).toHaveLength(1);
    expect(reranked[0].score).toBe(0.95);
    expect(callCount).toBe(2); // 1 failure + 1 success
  });

  test('retries on 500 server error and eventually succeeds', async () => {
    let callCount = 0;
    const fn = (async () => {
      callCount++;
      if (callCount <= 2) return cohereErrorResponse(500, 'server error');
      return cohereSuccessResponse([{ index: 0, relevance_score: 0.88 }]);
    }) as unknown as typeof fetch;

    const reranker = new CohereReranker('test-key', undefined, fn);
    const results = [makeResult('a', 0.5, 'doc')];
    const reranked = await reranker.rerank('query', results, 5);

    expect(reranked).toHaveLength(1);
    expect(reranked[0].score).toBe(0.88);
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  // --- Metadata preservation ---

  test('preserves metadata through reranking', async () => {
    const { fn } = createMockFetch(() =>
      cohereSuccessResponse([{ index: 0, relevance_score: 0.95 }]),
    );
    const reranker = new CohereReranker('test-key', undefined, fn);
    const results: SearchResult[] = [
      {
        id: 'doc-1',
        score: 0.9,
        content: 'Machine learning content',
        metadata: { source: 'ml.md', topic: 'ml', chunkIndex: 3 },
      },
    ];

    const reranked = await reranker.rerank('ML query', results, 5);
    expect(reranked[0].metadata).toEqual({
      source: 'ml.md',
      topic: 'ml',
      chunkIndex: 3,
    });
  });

  // --- Reranker interface compliance ---

  test('implements the Reranker interface', () => {
    const { fn } = createMockFetch(() => cohereSuccessResponse([]));
    const reranker = new CohereReranker('test-key', undefined, fn);
    expect(typeof reranker.rerank).toBe('function');
  });

  // --- Custom model ---

  test('uses custom model when specified', async () => {
    const { fn, calls } = createMockFetch(() =>
      cohereSuccessResponse([{ index: 0, relevance_score: 0.9 }]),
    );
    const reranker = new CohereReranker('test-key', 'rerank-english-v2.0', fn);
    const results = [makeResult('a', 0.9, 'doc')];

    await reranker.rerank('test', results, 5);

    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.model).toBe('rerank-english-v2.0');
  });
});
