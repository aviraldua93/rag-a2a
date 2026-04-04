/** A2A Agent Card for service discovery */
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
  }[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  provider?: { organization: string; url: string };
}

/** Create an A2A agent card for this RAG service */
export function createAgentCard(baseUrl: string): AgentCard {
  return {
    name: 'RAG-A2A Agent',
    description:
      'A production-grade Retrieval-Augmented Generation agent that provides hybrid search (vector + BM25), reranking, and LLM-powered question answering over a knowledge base.',
    url: `${baseUrl}/a2a`,
    version: '0.1.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: [
      {
        id: 'retrieve',
        name: 'Retrieve Documents',
        description:
          'Retrieve relevant documents for a query using hybrid search',
        tags: ['retrieval', 'search', 'hybrid', 'vector', 'bm25'],
        examples: [
          'Retrieve documents about machine learning',
          'Find relevant context for: What is a transformer?',
        ],
      },
      {
        id: 'answer',
        name: 'Answer Questions',
        description:
          'Answer questions using retrieved context (RAG)',
        tags: ['rag', 'question-answering', 'generation', 'llm'],
        examples: [
          'What is retrieval-augmented generation?',
          'Explain the attention mechanism in transformers',
        ],
      },
      {
        id: 'search',
        name: 'Search Knowledge Base',
        description:
          'Search the knowledge base using semantic, keyword, or hybrid search',
        tags: ['search', 'semantic', 'keyword', 'hybrid'],
        examples: [
          'Search for: neural network architectures',
          'Keyword search: gradient descent optimization',
        ],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    provider: {
      organization: 'rag-a2a',
      url: 'https://github.com/aviraldua93/rag-a2a',
    },
  };
}
