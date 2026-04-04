# 🧠 RAG-A2A

> Production-grade Retrieval-Augmented Generation pipeline exposed as an [A2A](https://google.github.io/A2A/) agent — hybrid search, reranking, streaming answers, zero required API keys.

![Tests](https://img.shields.io/badge/tests-236%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue)
![A2A](https://img.shields.io/badge/protocol-A2A-blueviolet)

---

## The Trilogy

This project is the **third pillar** of a portfolio trilogy exploring the frontier of multi-agent systems:

| # | Project | Protocol | What it proves |
|---|---------|----------|----------------|
| 1 | [**a2a-crews**](https://github.com/aviraldua93/a2a-crews) | A2A | Agent-to-agent orchestration — multi-agent crews coordinating via Google's A2A protocol |
| 2 | [**ag-ui-crews**](https://github.com/aviraldua93/ag-ui-crews) | AG-UI | Real-time agent dashboard — streaming agent state to a live UI via CopilotKit's AG-UI |
| 3 | **rag-a2a** ← you are here | A2A | Knowledge retrieval as a service — a RAG pipeline that any A2A agent can discover and query |

Together they demonstrate a full stack: **agents that coordinate** → **agents you can observe** → **agents that know things**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          RAG-A2A Pipeline                              │
│                                                                        │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────────┐  │
│   │          │   │          │   │          │   │                  │  │
│   │  📄 Docs │──▶│ ✂️ Chunk  │──▶│ 🔢 Embed │──▶│  💾 Store        │  │
│   │  Loader  │   │ sliding  │   │ OpenAI / │   │  Qdrant /       │  │
│   │          │   │ semantic │   │ Mock     │   │  In-Memory      │  │
│   │          │   │ recursive│   │          │   │                  │  │
│   └──────────┘   └──────────┘   └──────────┘   └────────┬─────────┘  │
│                                                          │            │
│                                                          ▼            │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                     🔍 Retrieval                             │    │
│   │                                                              │    │
│   │   Vector Search ──┐                                          │    │
│   │                   ├──▶ Reciprocal Rank Fusion ──▶ Reranker   │    │
│   │   BM25 Keyword ───┘                                          │    │
│   │                                                              │    │
│   └──────────────────────────────────┬───────────────────────────┘    │
│                                      │                                │
│                                      ▼                                │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  🤖 Generate                                                 │    │
│   │  Context + Query ──▶ LLM ──▶ Streaming SSE Response          │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  🌐 A2A Protocol Layer                                       │    │
│   │  Agent Card · JSON-RPC 2.0 · message/send · tasks/*          │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

- **Hybrid Search** — Vector similarity (Qdrant) fused with BM25 keyword search via Reciprocal Rank Fusion
- **Multi-Strategy Chunking** — Sliding-window, semantic, and recursive chunking with configurable size/overlap
- **Score-Based Reranking** — Post-retrieval reranking to push the most relevant results to the top
- **Streaming Answers** — Server-Sent Events deliver token-by-token LLM responses to the client
- **A2A Protocol** — Full compliance: discoverable agent card, JSON-RPC 2.0 endpoint, `message/send`, `tasks/*`
- **Zero API Keys Required** — Mock embedder + mock generator let you run the full pipeline locally without any external services
- **Custom Evaluation Metrics** — MRR, Precision@K, Recall@K, NDCG — all implemented in TypeScript, plus a RAGAS bridge
- **Web UI** — Dark-themed SPA with Search and Chat tabs, live streaming responses
- **236 Tests Passing** — 186 unit tests + 50 Playwright E2E tests, written by [a2a-crews](https://github.com/aviraldua93/a2a-crews) (dogfooding!)

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) ≥ 1.0
- [Docker](https://www.docker.com/) (for Qdrant)

### 1. Clone & Install

```bash
git clone https://github.com/aviraldua93/rag-a2a.git
cd rag-a2a
bun install
```

### 2. Start Qdrant

```bash
docker compose up -d
```

### 3. Run the Server

```bash
bun run dev
```

The server starts at **http://localhost:3737** — open it in your browser for the Web UI.

### 4. (Optional) Enable OpenAI

```bash
export OPENAI_API_KEY=sk-...
bun run dev
```

Without the key, the server uses mock providers — fully functional for development and testing.

### 5. Ingest Documents

```bash
bun run ingest
```

Or via API:

```bash
curl -X POST http://localhost:3737/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"directory": "./sample-docs"}'
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check — returns `{ status: "ok" }` |
| `POST` | `/api/search` | Hybrid retrieval — returns ranked document chunks |
| `POST` | `/api/ask` | RAG question answering — streams response via SSE |
| `POST` | `/api/ingest` | Ingest documents from a directory into the vector store |
| `GET` | `/api/stats` | Pipeline statistics (document count) |
| `GET` | `/.well-known/agent-card.json` | A2A agent card for service discovery |
| `POST` | `/a2a` | A2A JSON-RPC 2.0 endpoint (`message/send`, `tasks/*`) |

### Search Request

```json
POST /api/search
{
  "query": "What is retrieval-augmented generation?",
  "topK": 5,
  "mode": "hybrid"
}
```

### Ask Request (Streaming)

```json
POST /api/ask
{
  "query": "Explain the attention mechanism in transformers"
}
```

Response is a Server-Sent Events stream with `text`, `source`, `status`, `done`, and `error` events.

---

## A2A Integration

RAG-A2A is a fully compliant [A2A](https://google.github.io/A2A/) agent. Other agents discover it via the standard agent card:

```bash
curl http://localhost:3737/.well-known/agent-card.json
```

```json
{
  "name": "RAG-A2A Agent",
  "description": "A production-grade Retrieval-Augmented Generation agent...",
  "url": "http://localhost:3737/a2a",
  "version": "0.1.0",
  "capabilities": { "streaming": true, "pushNotifications": false },
  "skills": [
    { "id": "retrieve",  "name": "Retrieve Documents" },
    { "id": "answer",    "name": "Answer Questions" },
    { "id": "search",    "name": "Search Knowledge Base" }
  ]
}
```

### Sending a Message (JSON-RPC 2.0)

```bash
curl -X POST http://localhost:3737/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "What is RAG?" }]
      }
    }
  }'
```

Any A2A-compatible agent (including [a2a-crews](https://github.com/aviraldua93/a2a-crews)) can discover and query this agent automatically.

---

## Testing

**236 tests — all passing.** Written by [a2a-crews](https://github.com/aviraldua93/a2a-crews) using dogfooding: 4 agents, 3 waves, 10 tasks.

### Unit Tests (186)

```bash
bun test
```

Covers: chunking, BM25, hybrid search, reranking, retrieval pipeline, A2A server, agent card, executor, SSE streaming, config, prompts, mock providers, and evaluation metrics.

### E2E Tests (50)

```bash
bun run test:e2e
```

Playwright tests covering: app lifecycle, navigation, search tab, chat tab, and streaming responses.

| Suite | Tests | Coverage |
|-------|-------|----------|
| `chunker.test.ts` | Sliding-window, semantic, recursive strategies |
| `bm25.test.ts` | Term frequency, IDF, scoring, ranking |
| `hybrid.test.ts` | Reciprocal Rank Fusion, weight tuning |
| `reranker.test.ts` | Score-based reranking, top-K selection |
| `pipeline.test.ts` | End-to-end retrieval pipeline |
| `a2a-server.test.ts` | JSON-RPC dispatch, error handling |
| `agent-card.test.ts` | Card schema, skills, capabilities |
| `executor.test.ts` | Task lifecycle, message handling |
| `sse.test.ts` | SSE streaming, event formatting |
| `metrics.test.ts` | MRR, Precision@K, Recall@K, NDCG |
| `app.spec.ts` | Full app E2E (Playwright) |
| `search.spec.ts` | Search UI E2E |
| `chat.spec.ts` | Chat UI E2E |
| `navigation.spec.ts` | Tab navigation E2E |

---

## Evaluation

### Custom TypeScript Metrics

```bash
bun run evaluate
```

Built-in evaluation metrics — no Python required:

| Metric | Description |
|--------|-------------|
| **MRR** | Mean Reciprocal Rank — how high is the first relevant result? |
| **Precision@K** | Fraction of retrieved docs that are relevant |
| **Recall@K** | Fraction of relevant docs that are retrieved |
| **NDCG** | Normalized Discounted Cumulative Gain — rank-aware relevance |

### RAGAS Bridge

For deeper evaluation using the [RAGAS](https://docs.ragas.io/) framework:

```bash
cd evaluation
pip install -r requirements.txt
python evaluate_rag.py
```

Uses a golden dataset (`evaluation/golden-dataset.json`) to compute faithfulness, answer relevancy, context precision, and context recall.

---

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | [Bun](https://bun.sh/) | Fast TypeScript runtime, test runner, bundler |
| Language | TypeScript 5.x | End-to-end type safety |
| Vector DB | [Qdrant](https://qdrant.tech/) | Persistent vector storage and similarity search |
| Embeddings | OpenAI `text-embedding-3-small` | 1536-dim document/query embeddings |
| LLM | OpenAI `gpt-4o-mini` | Answer generation |
| Keyword Search | Custom BM25 | TypeScript implementation of Okapi BM25 |
| Fusion | Reciprocal Rank Fusion | Merges vector + keyword rankings |
| Protocol | [A2A](https://google.github.io/A2A/) | Agent-to-agent discovery and communication |
| Streaming | Server-Sent Events | Token-by-token response delivery |
| E2E Tests | [Playwright](https://playwright.dev/) | Browser-based end-to-end testing |
| Unit Tests | Bun Test | Native Bun test runner |
| Evaluation | RAGAS + custom metrics | Retrieval quality measurement |
| Containerization | Docker Compose | Qdrant orchestration |

---

## Project Structure

```
rag-a2a/
├── src/
│   ├── a2a/                    # A2A protocol layer
│   │   ├── agent-card.ts       #   Agent card definition & skills
│   │   ├── executor.ts         #   Task executor for A2A messages
│   │   └── server.ts           #   JSON-RPC 2.0 dispatcher
│   ├── embeddings/             # Embedding providers
│   │   ├── openai.ts           #   OpenAI text-embedding-3-small
│   │   ├── mock.ts             #   Deterministic mock (no API key needed)
│   │   └── provider.ts         #   Provider interface
│   ├── generation/             # Answer generation
│   │   ├── generator.ts        #   RAG generator + mock generator
│   │   ├── prompt.ts           #   Prompt templates
│   │   └── types.ts            #   Generation types
│   ├── ingestion/              # Document ingestion
│   │   ├── chunker.ts          #   Multi-strategy chunking engine
│   │   ├── loader.ts           #   File loader
│   │   └── pipeline.ts         #   Ingestion orchestrator
│   ├── retrieval/              # Search & retrieval
│   │   ├── bm25.ts             #   BM25 keyword search
│   │   ├── hybrid.ts           #   Reciprocal Rank Fusion
│   │   ├── pipeline.ts         #   Retrieval pipeline orchestrator
│   │   ├── reranker.ts         #   Score-based reranker
│   │   └── vector-search.ts    #   Vector similarity search
│   ├── store/                  # Vector storage
│   │   ├── qdrant.ts           #   Qdrant client
│   │   ├── memory.ts           #   In-memory fallback store
│   │   └── types.ts            #   Store interface
│   ├── evaluation/             # Retrieval evaluation
│   │   ├── metrics.ts          #   MRR, P@K, R@K, NDCG
│   │   └── runner.ts           #   Evaluation runner
│   ├── server/                 # HTTP server
│   │   ├── index.ts            #   Bootstrap & dependency wiring
│   │   ├── routes.ts           #   API route handlers
│   │   └── sse.ts              #   SSE stream helper
│   └── config.ts               # Environment-based configuration
├── client/                     # Web UI (dark theme SPA)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── evaluation/                 # RAGAS evaluation bridge
│   ├── evaluate_rag.py
│   ├── golden-dataset.json
│   └── requirements.txt
├── tests/
│   ├── unit/                   # 186 unit tests (Bun Test)
│   ├── e2e/                    # 50 E2E tests (Playwright)
│   ├── helpers/
│   └── setup.test.ts
├── sample-docs/                # Sample documents for ingestion
├── docker-compose.yml          # Qdrant container
├── playwright.config.ts
├── tsconfig.json
├── package.json
└── bunfig.toml
```

---

## Configuration

All configuration is via environment variables with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _(empty — uses mock)_ | OpenAI API key |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `GENERATION_MODEL` | `gpt-4o-mini` | LLM for answer generation |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | `rag-a2a` | Qdrant collection name |
| `PORT` | `3737` | Server port |
| `HOST` | `localhost` | Server host |
| `TOP_K` | `10` | Number of results to retrieve |
| `HYBRID_WEIGHT` | `0.7` | Vector vs BM25 weight (1.0 = pure vector) |
| `RERANK_TOP_K` | `5` | Results after reranking |
| `CHUNK_STRATEGY` | `recursive` | Chunking strategy |
| `CHUNK_SIZE` | `512` | Chunk size in characters |
| `CHUNK_OVERLAP` | `64` | Overlap between chunks |

---

## License

[MIT](LICENSE) © Aviral Dua
