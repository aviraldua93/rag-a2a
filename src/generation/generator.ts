import OpenAI from 'openai';
import type { SearchResult } from '../store/types.ts';
import type { GenerationResult, StreamChunk } from './types.ts';
import { buildRAGPrompt, buildSystemPrompt } from './prompt.ts';

/** LLM-powered RAG answer generator using OpenAI */
export class RAGGenerator {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model ?? 'gpt-4o-mini';
  }

  /** Generate a complete answer (non-streaming) */
  async generate(query: string, contexts: SearchResult[]): Promise<GenerationResult> {
    const start = performance.now();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildRAGPrompt(query, contexts);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    });

    const choice = response.choices[0];
    const answer = choice?.message?.content ?? '';
    const durationMs = Math.round(performance.now() - start);

    return {
      answer,
      sources: contexts.map(ctx => ({
        id: ctx.id,
        content: ctx.content,
        score: ctx.score,
      })),
      model: this.model,
      tokensUsed: response.usage?.total_tokens,
      durationMs,
    };
  }

  /** Generate a streaming answer via async generator */
  async *generateStream(query: string, contexts: SearchResult[]): AsyncGenerator<StreamChunk> {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildRAGPrompt(query, contexts);

    // Emit source metadata first
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

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield { type: 'text' as const, content: delta };
        }
      }

      yield { type: 'done' as const, content: '' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown generation error';
      yield { type: 'error' as const, content: message };
    }
  }
}

/** Mock generator for testing — returns deterministic answers without calling an LLM */
export class MockGenerator {
  /** Generate a deterministic answer from the query and contexts */
  async generate(query: string, contexts: SearchResult[]): Promise<GenerationResult> {
    const start = performance.now();

    const firstContent = contexts[0]?.content ?? 'No context available';
    const sourceRefs = contexts
      .map((_, i) => `[Source ${i + 1}]`)
      .join(', ');

    const answer = contexts.length > 0
      ? `Based on the provided documents ${sourceRefs}: ${firstContent.slice(0, 300)}\n\nThis answers the question: "${query}"`
      : `I cannot find the answer to "${query}" in the provided documents.`;

    const durationMs = Math.round(performance.now() - start);

    return {
      answer,
      sources: contexts.map(ctx => ({
        id: ctx.id,
        content: ctx.content,
        score: ctx.score,
      })),
      model: 'mock',
      tokensUsed: answer.length,
      durationMs,
    };
  }

  /** Generate a streaming answer — emits the mock answer in small chunks */
  async *generateStream(query: string, contexts: SearchResult[]): AsyncGenerator<StreamChunk> {
    // Emit sources first
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

    // Generate the full answer then stream it in chunks
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
}
