import type { EmbeddingProvider } from '../embeddings/provider.ts';
import type { SearchResult } from '../store/types.ts';
import type { GenerationResult } from '../generation/types.ts';

/**
 * Minimal generator interface used by HyDEExpander.
 * Both RAGGenerator and MockGenerator satisfy this contract.
 */
export interface HyDEGenerator {
  generate(query: string, contexts: SearchResult[]): Promise<GenerationResult>;
}

/**
 * HyDE (Hypothetical Document Embedding) query expansion.
 *
 * Instead of embedding the raw query for vector search, HyDE asks an LLM to
 * generate a *hypothetical* answer and then embeds that answer. The intuition
 * is that a hypothetical document is closer in embedding space to real
 * relevant documents than a short question would be.
 *
 * Reference: Gao et al., 2022 — "Precise Zero-Shot Dense Retrieval without
 * Relevance Labels" (https://arxiv.org/abs/2212.10496)
 */
export class HyDEExpander {
  constructor(
    private generator: HyDEGenerator,
    private embedder: EmbeddingProvider,
  ) {}

  /**
   * Generate a hypothetical answer for the query and return its embedding.
   *
   * @returns The embedding vector of the hypothetical answer, or `null` if
   *          generation fails (in which case the caller should fall back to
   *          embedding the original query).
   */
  async expand(query: string): Promise<{ vector: number[]; hypothetical: string } | null> {
    try {
      const prompt = buildHyDEPrompt(query);
      const result = await this.generator.generate(prompt, []);
      const hypothetical = result.answer.trim();
      if (!hypothetical) return null;

      const vector = await this.embedder.embed(hypothetical);
      return { vector, hypothetical };
    } catch {
      return null;
    }
  }
}

/**
 * Build the prompt that instructs the LLM to generate a hypothetical
 * document / answer for the given query.
 */
function buildHyDEPrompt(query: string): string {
  return (
    `Write a short, factual paragraph that directly answers the following question. ` +
    `Do not say "I don't know" or ask for clarification — just provide the best ` +
    `possible answer as if you were an authoritative reference document.\n\n` +
    `Question: ${query}`
  );
}
