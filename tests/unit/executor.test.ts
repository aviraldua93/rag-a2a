/**
 * Unit tests for TaskExecutor — A2A task lifecycle management.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { TaskExecutor, type A2ATask } from '../../src/a2a/executor.ts';
import type { RetrievalPipeline, RetrievalResult } from '../../src/retrieval/pipeline.ts';
import type { GenerationResult } from '../../src/generation/types.ts';
import { createSearchResults } from '../helpers/index.ts';

// ---------------------------------------------------------------------------
// Mock retrieval pipeline
// ---------------------------------------------------------------------------

function createMockPipeline(results = createSearchResults(3)): RetrievalPipeline {
  return {
    retrieve: async (_query: string): Promise<RetrievalResult> => ({
      results,
      metadata: {
        vectorResultCount: results.length,
        keywordResultCount: results.length,
        hybridResultCount: results.length,
        rerankResultCount: results.length,
        durationMs: 10,
      },
    }),
    indexDocuments: () => {},
  } as unknown as RetrievalPipeline;
}

function createMockGenerator() {
  return {
    async generate(query: string, contexts: any[]): Promise<GenerationResult> {
      return {
        answer: `Generated answer for: ${query}`,
        sources: contexts.map((c: any) => ({ id: c.id, content: c.content, score: c.score })),
        model: 'mock',
        tokensUsed: 42,
        durationMs: 5,
      };
    },
    async *generateStream() {
      yield { type: 'text' as const, content: 'chunk' };
      yield { type: 'done' as const, content: '' };
    },
  };
}

function createFailingPipeline(): RetrievalPipeline {
  return {
    retrieve: async () => {
      throw new Error('Pipeline failure');
    },
    indexDocuments: () => {},
  } as unknown as RetrievalPipeline;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskExecutor', () => {
  let executor: TaskExecutor;

  beforeEach(() => {
    executor = new TaskExecutor(createMockPipeline(), createMockGenerator());
  });

  test('execute() creates task with submitted→working→completed lifecycle', async () => {
    const task = await executor.execute('t1', 'What is ML?');
    expect(task.id).toBe('t1');
    expect(task.status).toBe('completed');
    expect(task.message).toBe('What is ML?');
  });

  test('execute() with generator produces generated-answer artifact', async () => {
    const task = await executor.execute('t2', 'Explain RAG');
    expect(task.artifacts).toBeDefined();
    expect(task.artifacts!.length).toBe(2);

    const answerArtifact = task.artifacts!.find(a => a.name === 'generated-answer');
    expect(answerArtifact).toBeDefined();
    expect(answerArtifact!.parts[0].text).toContain('Generated answer for: Explain RAG');
  });

  test('execute() produces retrieval-results artifact', async () => {
    const task = await executor.execute('t3', 'Test query');
    const retrievalArtifact = task.artifacts!.find(a => a.name === 'retrieval-results');
    expect(retrievalArtifact).toBeDefined();
    expect(retrievalArtifact!.parts.length).toBe(3); // 3 results
  });

  test('execute() without generator returns retrieval summary', async () => {
    const noGenExecutor = new TaskExecutor(createMockPipeline(), null);
    const task = await noGenExecutor.execute('t4', 'No gen query');
    expect(task.result).toContain('Found 3 relevant document(s)');
    expect(task.status).toBe('completed');
  });

  test('execute() without generator and no results returns no-results message', async () => {
    const emptyPipeline = createMockPipeline([]);
    const noGenExecutor = new TaskExecutor(emptyPipeline, null);
    const task = await noGenExecutor.execute('t5', 'Empty');
    expect(task.result).toBe('No relevant documents found for the query.');
  });

  test('getTask() returns correct task after execution', async () => {
    await executor.execute('task-123', 'Hello');
    const task = executor.getTask('task-123');
    expect(task).toBeDefined();
    expect(task!.id).toBe('task-123');
    expect(task!.status).toBe('completed');
  });

  test('getTask() returns undefined for non-existent task', () => {
    expect(executor.getTask('nonexistent')).toBeUndefined();
  });

  test('listTasks() returns all executed tasks', async () => {
    await executor.execute('a', 'Q1');
    await executor.execute('b', 'Q2');
    await executor.execute('c', 'Q3');
    const tasks = executor.listTasks();
    expect(tasks.length).toBe(3);
    const ids = tasks.map(t => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  test('cancelTask() transitions working/submitted task to failed', async () => {
    // We'll execute a task (it becomes completed), then manually set it
    // to working to test cancel
    await executor.execute('cancel-me', 'Some query');
    const task = executor.getTask('cancel-me')!;
    // Manually revert status to test cancel path
    (task as any).status = 'working';
    const cancelled = executor.cancelTask('cancel-me');
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe('failed');
    expect(cancelled!.result).toBe('Task was cancelled');
  });

  test('cancelTask() returns undefined for non-existent task', () => {
    expect(executor.cancelTask('no-such-task')).toBeUndefined();
  });

  test('execute() failure sets status=failed with error message', async () => {
    const failExecutor = new TaskExecutor(createFailingPipeline(), null);
    const task = await failExecutor.execute('fail-1', 'Broken query');
    expect(task.status).toBe('failed');
    expect(task.result).toBe('Pipeline failure');
  });

  test('task timestamps are ISO strings and updatedAt changes', async () => {
    const task = await executor.execute('ts-test', 'Timestamps');
    expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(task.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // updatedAt should be >= createdAt
    expect(new Date(task.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.createdAt).getTime(),
    );
  });

  test('generated-answer artifact includes model metadata', async () => {
    const task = await executor.execute('meta-test', 'Metadata check');
    const answerArtifact = task.artifacts!.find(a => a.name === 'generated-answer');
    expect(answerArtifact).toBeDefined();
    const meta = JSON.parse(answerArtifact!.parts[1].text);
    expect(meta.model).toBe('mock');
    expect(meta.tokensUsed).toBe(42);
    expect(typeof meta.durationMs).toBe('number');
    expect(typeof meta.sourceCount).toBe('number');
  });
});
