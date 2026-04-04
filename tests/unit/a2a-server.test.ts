/**
 * Unit tests for the A2A JSON-RPC server dispatch.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { handleA2ARequest } from '../../src/a2a/server.ts';
import { TaskExecutor } from '../../src/a2a/executor.ts';
import type { RetrievalPipeline, RetrievalResult } from '../../src/retrieval/pipeline.ts';
import { createSearchResults } from '../helpers/index.ts';

// ---------------------------------------------------------------------------
// Mock pipeline + executor
// ---------------------------------------------------------------------------

function createMockPipeline(): RetrievalPipeline {
  const results = createSearchResults(2);
  return {
    retrieve: async (): Promise<RetrievalResult> => ({
      results,
      metadata: {
        vectorResultCount: 2,
        keywordResultCount: 2,
        hybridResultCount: 2,
        rerankResultCount: 2,
        durationMs: 5,
      },
    }),
    indexDocuments: () => {},
  } as unknown as RetrievalPipeline;
}

function createMockGenerator() {
  return {
    async generate(query: string, contexts: any[]) {
      return {
        answer: `Answer: ${query}`,
        sources: contexts.map((c: any) => ({ id: c.id, content: c.content, score: c.score })),
        model: 'mock',
        tokensUsed: 10,
        durationMs: 1,
      };
    },
    async *generateStream() {
      yield { type: 'done' as const, content: '' };
    },
  };
}

const BASE_URL = 'http://localhost:9999';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rpcRequest(method: string, params?: Record<string, unknown>, id: number = 1): Request {
  return new Request(`${BASE_URL}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A2A Server — handleA2ARequest', () => {
  let executor: TaskExecutor;

  beforeEach(() => {
    executor = new TaskExecutor(createMockPipeline(), createMockGenerator());
  });

  test('GET /.well-known/agent-card.json returns agent card', async () => {
    const req = new Request(`${BASE_URL}/.well-known/agent-card.json`, { method: 'GET' });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('RAG-A2A Agent');
    expect(body.url).toBe(`${BASE_URL}/a2a`);
    expect(body.skills).toBeInstanceOf(Array);
  });

  test('message/send creates and executes a task', async () => {
    const req = rpcRequest('message/send', {
      message: { parts: [{ type: 'text', text: 'What is RAG?' }] },
    });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result.task).toBeDefined();
    expect(body.result.task.status).toBe('completed');
    expect(body.result.task.result).toContain('Answer: What is RAG?');
  });

  test('message/send with query param works', async () => {
    const req = rpcRequest('message/send', { query: 'Explain ML' });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    const body = await res.json() as any;
    expect(body.result.task.status).toBe('completed');
  });

  test('message/send without text returns error', async () => {
    const req = rpcRequest('message/send', { message: { parts: [] } });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32600);
  });

  test('tasks/get returns a specific task', async () => {
    // First create a task
    const sendReq = rpcRequest('message/send', {
      message: { parts: [{ type: 'text', text: 'Test' }] },
    });
    const sendRes = await handleA2ARequest(sendReq, executor, BASE_URL);
    const sendBody = await sendRes.json() as any;
    const taskId = sendBody.result.task.id;

    // Then get it
    const getReq = rpcRequest('tasks/get', { taskId }, 2);
    const getRes = await handleA2ARequest(getReq, executor, BASE_URL);
    const getBody = await getRes.json() as any;
    expect(getBody.result.task.id).toBe(taskId);
    expect(getBody.result.task.status).toBe('completed');
  });

  test('tasks/get without taskId returns error', async () => {
    const req = rpcRequest('tasks/get', {});
    const res = await handleA2ARequest(req, executor, BASE_URL);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain('taskId');
  });

  test('tasks/list returns all tasks', async () => {
    await handleA2ARequest(
      rpcRequest('message/send', { message: { parts: [{ type: 'text', text: 'Q1' }] } }),
      executor,
      BASE_URL,
    );
    await handleA2ARequest(
      rpcRequest('message/send', { message: { parts: [{ type: 'text', text: 'Q2' }] } }),
      executor,
      BASE_URL,
    );

    const listReq = rpcRequest('tasks/list', {}, 3);
    const listRes = await handleA2ARequest(listReq, executor, BASE_URL);
    const body = await listRes.json() as any;
    expect(body.result.tasks.length).toBe(2);
  });

  test('tasks/cancel cancels a task', async () => {
    // Create a task, manually set it to working, then cancel
    const sendReq = rpcRequest('message/send', {
      message: { parts: [{ type: 'text', text: 'Cancel me' }] },
    });
    const sendRes = await handleA2ARequest(sendReq, executor, BASE_URL);
    const sendBody = await sendRes.json() as any;
    const taskId = sendBody.result.task.id;

    // Set task to working to allow cancel
    const task = executor.getTask(taskId)!;
    (task as any).status = 'working';

    const cancelReq = rpcRequest('tasks/cancel', { taskId }, 4);
    const cancelRes = await handleA2ARequest(cancelReq, executor, BASE_URL);
    const cancelBody = await cancelRes.json() as any;
    expect(cancelBody.result.task.status).toBe('failed');
    expect(cancelBody.result.task.result).toBe('Task was cancelled');
  });

  test('unknown method returns method-not-found error', async () => {
    const req = rpcRequest('nonexistent/method', {});
    const res = await handleA2ARequest(req, executor, BASE_URL);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('Method not found');
  });

  test('invalid JSON returns parse error', async () => {
    const req = new Request(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json !!!',
    });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe(-32700);
  });

  test('missing jsonrpc version returns invalid request', async () => {
    const req = new Request(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'tasks/list' }),
    });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32600);
  });

  test('non-matching path returns 404', async () => {
    const req = new Request(`${BASE_URL}/unknown`, { method: 'GET' });
    const res = await handleA2ARequest(req, executor, BASE_URL);
    expect(res.status).toBe(404);
  });
});
