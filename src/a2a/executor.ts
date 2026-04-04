import type { RetrievalPipeline } from '../retrieval/pipeline.ts';
import type { RAGGenerator } from '../generation/generator.ts';
import type { MockGenerator } from '../generation/generator.ts';

/** An A2A task representing a retrieval / generation request */
export interface A2ATask {
  id: string;
  status: 'submitted' | 'working' | 'completed' | 'failed';
  message: string;
  result?: string;
  artifacts?: { name: string; parts: { type: string; text: string }[] }[];
  createdAt: string;
  updatedAt: string;
}

/** Executes A2A tasks against the retrieval pipeline and optional generator */
export class TaskExecutor {
  private tasks: Map<string, A2ATask> = new Map();

  constructor(
    private pipeline: RetrievalPipeline,
    private generator: RAGGenerator | MockGenerator | null,
  ) {}

  /** Execute a retrieval (and optionally generation) task */
  async execute(taskId: string, message: string): Promise<A2ATask> {
    const now = new Date().toISOString();
    const task: A2ATask = {
      id: taskId,
      status: 'submitted',
      message,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);

    // Transition to working
    task.status = 'working';
    task.updatedAt = new Date().toISOString();

    try {
      // Run retrieval
      const retrieval = await this.pipeline.retrieve(message);
      const results = retrieval.results;

      // Build retrieval artifact
      const retrievalArtifact = {
        name: 'retrieval-results',
        parts: results.map((r, i) => ({
          type: 'text' as const,
          text: JSON.stringify({
            rank: i + 1,
            id: r.id,
            score: r.score,
            content: r.content,
          }),
        })),
      };

      task.artifacts = [retrievalArtifact];

      // If a generator is available, produce an answer
      if (this.generator && results.length > 0) {
        const generation = await this.generator.generate(message, results);

        task.artifacts.push({
          name: 'generated-answer',
          parts: [
            { type: 'text', text: generation.answer },
            {
              type: 'text',
              text: JSON.stringify({
                model: generation.model,
                tokensUsed: generation.tokensUsed,
                durationMs: generation.durationMs,
                sourceCount: generation.sources.length,
              }),
            },
          ],
        });

        task.result = generation.answer;
      } else {
        // No generator — return a summary of retrieval results
        task.result =
          results.length > 0
            ? `Found ${results.length} relevant document(s). Top result (score ${results[0]!.score.toFixed(3)}): ${results[0]!.content.slice(0, 200)}...`
            : 'No relevant documents found for the query.';
      }

      task.status = 'completed';
      task.updatedAt = new Date().toISOString();
    } catch (err) {
      task.status = 'failed';
      task.result =
        err instanceof Error ? err.message : 'Unknown error during task execution';
      task.updatedAt = new Date().toISOString();
    }

    return task;
  }

  /** Get a task by its ID */
  getTask(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId);
  }

  /** List all tasks */
  listTasks(): A2ATask[] {
    return Array.from(this.tasks.values());
  }

  /** Cancel a task if it is still pending or working */
  cancelTask(taskId: string): A2ATask | undefined {
    const task = this.tasks.get(taskId);
    if (task && (task.status === 'submitted' || task.status === 'working')) {
      task.status = 'failed';
      task.result = 'Task was cancelled';
      task.updatedAt = new Date().toISOString();
    }
    return task;
  }
}
