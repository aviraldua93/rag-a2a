export interface RagConfig {
  qdrant: {
    url: string;
    collectionName: string;
    vectorSize: number;
  };
  openai: {
    apiKey: string;
    embeddingModel: string;
    generationModel: string;
  };
  server: {
    port: number;
    host: string;
  };
  retrieval: {
    topK: number;
    hybridWeight: number; // 0 = pure BM25, 1 = pure vector
    rerankTopK: number;
  };
  chunking: {
    strategy: 'sliding-window' | 'semantic' | 'recursive';
    chunkSize: number;
    chunkOverlap: number;
  };
}

export function loadConfig(): RagConfig {
  return {
    qdrant: {
      url: process.env.QDRANT_URL ?? 'http://localhost:6333',
      collectionName: process.env.QDRANT_COLLECTION ?? 'rag-a2a',
      vectorSize: 1536, // text-embedding-3-small
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
      generationModel: process.env.GENERATION_MODEL ?? 'gpt-4o-mini',
    },
    server: {
      port: parseInt(process.env.PORT ?? '3737'),
      host: process.env.HOST ?? 'localhost',
    },
    retrieval: {
      topK: parseInt(process.env.TOP_K ?? '10'),
      hybridWeight: parseFloat(process.env.HYBRID_WEIGHT ?? '0.7'),
      rerankTopK: parseInt(process.env.RERANK_TOP_K ?? '5'),
    },
    chunking: {
      strategy: (process.env.CHUNK_STRATEGY as RagConfig['chunking']['strategy']) ?? 'recursive',
      chunkSize: parseInt(process.env.CHUNK_SIZE ?? '512'),
      chunkOverlap: parseInt(process.env.CHUNK_OVERLAP ?? '64'),
    },
  };
}
