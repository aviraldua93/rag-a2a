/**
 * Unit tests for the RAG prompt builder.
 */
import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt, buildRAGPrompt } from '../../src/generation/prompt.ts';
import type { SearchResult } from '../../src/store/types.ts';

describe('buildSystemPrompt', () => {
  test('contains citation instructions with [Source N] format', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('[Source N]');
    expect(prompt).toContain('Cite');
  });

  test('instructs to only answer based on provided context', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('ONLY based on the provided context');
  });

  test('instructs to state when answer is not found in context', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('cannot find the answer');
  });
});

describe('buildRAGPrompt', () => {
  const sampleContexts: SearchResult[] = [
    {
      id: 'doc-1',
      score: 0.95,
      content: 'Machine learning is a subset of AI.',
      metadata: { source: 'ml.md' },
    },
    {
      id: 'doc-2',
      score: 0.88,
      content: 'Deep learning uses neural networks.',
      metadata: { source: 'dl.md' },
    },
  ];

  test('includes context block with source labels and content', () => {
    const prompt = buildRAGPrompt('What is ML?', sampleContexts);
    expect(prompt).toContain('[Source 1]');
    expect(prompt).toContain('[Source 2]');
    expect(prompt).toContain('Machine learning is a subset of AI.');
    expect(prompt).toContain('Deep learning uses neural networks.');
    expect(prompt).toContain('What is ML?');
    expect(prompt).toContain('id: doc-1');
    expect(prompt).toContain('source: ml.md');
  });

  test('includes score in context block', () => {
    const prompt = buildRAGPrompt('Query', sampleContexts);
    expect(prompt).toContain('0.950');
    expect(prompt).toContain('0.880');
  });

  test('produces fallback message when contexts are empty', () => {
    const prompt = buildRAGPrompt('What is quantum computing?', []);
    expect(prompt).toContain('No relevant documents were found');
    expect(prompt).toContain('cannot answer');
    expect(prompt).toContain('What is quantum computing?');
  });
});
