/** Result from the RAG generation pipeline */
export interface GenerationResult {
  answer: string;
  sources: { id: string; content: string; score: number }[];
  model: string;
  tokensUsed?: number;
  durationMs: number;
}

/** A chunk emitted during streaming generation */
export interface StreamChunk {
  type: 'text' | 'source' | 'done' | 'error';
  content: string;
}
