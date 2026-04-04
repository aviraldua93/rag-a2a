import type { SearchResult } from '../store/types.ts';

/** Build the system prompt for the RAG assistant */
export function buildSystemPrompt(): string {
  return `You are a helpful, accurate research assistant. Follow these rules strictly:

1. Answer ONLY based on the provided context documents. Do not use prior knowledge.
2. Cite your sources using [Source N] format, where N corresponds to the context number.
3. If the answer is not contained in the provided context, clearly state: "I cannot find the answer in the provided documents."
4. Be concise and factual. Avoid speculation.
5. When multiple sources support a claim, cite all relevant ones.
6. Preserve technical accuracy — do not paraphrase in ways that change meaning.`;
}

/** Estimate token count (rough: 1 token ≈ 4 chars for English text) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Build the RAG prompt with retrieved context chunks and the user query */
export function buildRAGPrompt(
  query: string,
  contexts: SearchResult[],
  maxContextTokens: number = 4000,
): string {
  if (contexts.length === 0) {
    return `No relevant documents were found for the following question. Please indicate that you cannot answer.\n\nQuestion: ${query}`;
  }

  // Sort by score descending (should already be, but be safe)
  const sorted = [...contexts].sort((a, b) => b.score - a.score);

  const includedContexts: SearchResult[] = [];
  let tokenBudget = maxContextTokens;

  for (const ctx of sorted) {
    const tokens = estimateTokens(ctx.content);
    if (tokenBudget - tokens < 0 && includedContexts.length > 0) break;
    includedContexts.push(ctx);
    tokenBudget -= tokens;
  }

  const contextBlock = includedContexts
    .map((ctx, i) => {
      const source = ctx.metadata?.source ?? ctx.id;
      return `[Source ${i + 1}] (id: ${ctx.id}, source: ${source}, score: ${ctx.score.toFixed(3)})\n${ctx.content}`;
    })
    .join('\n\n---\n\n');

  return `Use the following context documents to answer the question. Cite sources using [Source N] format.

Context:
${contextBlock}

---

Question: ${query}`;
}
