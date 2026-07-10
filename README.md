# RAG-A2A

A Bun/TypeScript Retrieval-Augmented Generation service that exposes search, answer generation, and A2A JSON-RPC endpoints for local agent experiments.

## What it does

- Loads local documents, chunks them, embeds them, and stores vectors in Qdrant or an in-memory fallback.
- Retrieves with vector search plus BM25 keyword ranking and reranks results.
- Streams answers over Server-Sent Events.
- Publishes an A2A agent card and handles `message/send` and task JSON-RPC methods.
- Runs without API keys by using mock embedding and generation providers.

## Requirements

- [Bun](https://bun.sh/) 1.0 or newer. The npm scripts call `bun`.
- npm, using the checked-in `package-lock.json` for install.
- Optional: Docker if you want Qdrant via `docker compose up -d`.

## Quickstart / install

```bash
git clone https://github.com/aviraldua93/rag-a2a.git
cd rag-a2a
npm install
```

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3737` | HTTP port |
| `HOST` | `localhost` | HTTP host |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint; the server falls back to memory if unavailable |
| `QDRANT_COLLECTION` | `rag-a2a` | Qdrant collection |
| `OPENAI_API_KEY` | empty | Enables OpenAI embeddings and generation; empty uses mocks |
| `COHERE_API_KEY` | empty | Enables Cohere reranking; empty uses score reranking |

## Run

Start the development server:

```bash
npm run dev
```

Or start without hot reload:

```bash
npm start
```

The server listens at `http://localhost:3737` by default and serves the web UI from `/`.

Common endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health and index status |
| `POST` | `/api/ingest` | Ingest documents from a local directory |
| `POST` | `/api/search` | Search indexed chunks |
| `POST` | `/api/ask` | Stream a RAG answer with SSE |
| `GET` | `/.well-known/agent-card.json` | A2A agent card |
| `POST` | `/a2a` | A2A JSON-RPC endpoint |

Example ingest and search:

```bash
curl -X POST http://localhost:3737/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"directory":"./sample-docs"}'

curl -X POST http://localhost:3737/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"What is RAG?","topK":5,"mode":"hybrid"}'
```

## Test

Run the checks used for cleanup:

```bash
npm run typecheck
npm test
```

`npm test` runs `bun test tests/setup.test.ts tests/unit/`.

End-to-end tests are available but are not part of the default cleanup verification because they start the app through Playwright:

```bash
npm run test:e2e
```

## Other scripts

| Script | Description |
| --- | --- |
| `npm run ingest` | Run the ingestion pipeline entrypoint |
| `npm run evaluate` | Run TypeScript retrieval metrics |
| `npm run docker:up` | Start Qdrant with Docker Compose |
| `npm run docker:down` | Stop Docker Compose services |

## Project layout

```text
src/a2a/         A2A agent card, executor, JSON-RPC handler
src/embeddings/  OpenAI and mock embedding providers
src/generation/  RAG prompt and generator implementations
src/ingestion/   file loading, chunking, ingestion pipeline
src/retrieval/   BM25, hybrid retrieval, reranking, cache helpers
src/server/      HTTP routes and SSE helpers
src/store/       Qdrant and in-memory vector stores
client/          Static web UI
tests/unit/      Bun unit tests
tests/e2e/       Playwright end-to-end tests
sample-docs/     Local sample documents
```

## License

[MIT](LICENSE) © Aviral Dua
