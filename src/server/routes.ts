import type { RetrievalPipeline } from '../retrieval/pipeline.ts';
import type { RAGGenerator } from '../generation/generator.ts';
import type { MockGenerator } from '../generation/generator.ts';
import type { TaskExecutor } from '../a2a/executor.ts';
import type { VectorStore } from '../store/types.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import { handleA2ARequest } from '../a2a/server.ts';
import { SSEStream } from './sse.ts';
import { resolve, normalize } from 'node:path';
import { createRequestLogger } from '../logger.ts';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';

/** Dependencies injected into the request handler */
export interface RouteContext {
  pipeline: RetrievalPipeline;
  generator: RAGGenerator | MockGenerator | null;
  executor: TaskExecutor;
  baseUrl: string;
  store: VectorStore;
  embedder: EmbeddingProvider;
}

/** Add CORS headers to a response */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Main request router */
export async function handleRequest(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // Generate a unique request ID for tracing
  const requestId = req.headers.get('x-request-id') ?? uuidv4();
  const log = createRequestLogger(requestId);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

  log.info({ method: req.method, path: pathname }, 'Incoming request');

  // --- A2A routes ---
  if (pathname === '/.well-known/agent-card.json' || pathname === '/a2a') {
    return withCors(await handleA2ARequest(req, ctx.executor, ctx.baseUrl));
  }

  // --- Static files ---
  if (pathname === '/' || pathname === '/index.html') {
    return withCors(await serveStaticFile('client/index.html'));
  }
  if (pathname.startsWith('/client/')) {
    const filePath = pathname.slice(1); // strip leading /
    return withCors(await serveStaticFile(filePath));
  }

  // --- API routes ---
  if (pathname === '/api/health' && req.method === 'GET') {
    try {
      const docCount = await ctx.store.count();
      const bm25Count = ctx.pipeline.getIndexedCount();
      return withCors(Response.json({
        status: 'ok',
        version: '0.1.0',
        store: { connected: true, documents: docCount },
        bm25: { indexed: bm25Count },
      }));
    } catch {
      return withCors(Response.json({
        status: 'degraded',
        version: '0.1.0',
        store: { connected: false, documents: 0 },
        bm25: { indexed: 0 },
      }));
    }
  }

  if (pathname === '/api/search' && req.method === 'POST') {
    return withCors(await handleSearch(req, ctx, log));
  }

  if (pathname === '/api/ask' && req.method === 'POST') {
    return withCors(await handleAsk(req, ctx, log));
  }

  if (pathname === '/api/ingest' && req.method === 'POST') {
    return withCors(await handleIngest(req, ctx, log));
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    return withCors(await handleStats(ctx));
  }

  log.warn({ path: pathname }, 'Route not found');
  return withCors(Response.json({ error: 'Not Found' }, { status: 404 }));
}

/** POST /api/search — run retrieval pipeline */
async function handleSearch(req: Request, ctx: RouteContext, log: Logger): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = body.query as string | undefined;
  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'query is required and must be a string' }, { status: 400 });
  }

  const topK = typeof body.topK === 'number' ? body.topK : undefined;
  const mode = typeof body.mode === 'string' ? body.mode : undefined;

  try {
    log.info({ query, topK, mode }, 'Search request');
    const retrieval = await ctx.pipeline.retrieve(query, { topK, mode: mode as string });
    log.info({ resultCount: retrieval.results.length }, 'Search complete');
    return Response.json({
      query,
      results: retrieval.results,
      count: retrieval.results.length,
      metadata: retrieval.metadata,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    log.error({ err: message }, 'Search failed');
    return Response.json({ error: message }, { status: 500 });
  }
}

/** POST /api/ask — streaming RAG answer via SSE */
async function handleAsk(req: Request, ctx: RouteContext, log: Logger): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = body.query as string | undefined;
  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'query is required and must be a string' }, { status: 400 });
  }

  if (!ctx.generator) {
    return Response.json(
      { error: 'Generator not configured — set OPENAI_API_KEY to enable' },
      { status: 503 },
    );
  }

  log.info({ query }, 'Ask request (streaming)');

  const sse = new SSEStream();
  const response = sse.createResponse();

  // Run retrieval + generation in background so we can return the SSE response immediately
  (async () => {
    try {
      const retrieval = await ctx.pipeline.retrieve(query);
      log.info({ resultCount: retrieval.results.length }, 'Retrieval complete for ask');
      sse.send('status', { phase: 'retrieval_complete', count: retrieval.results.length });

      for await (const chunk of ctx.generator!.generateStream(query, retrieval.results)) {
        switch (chunk.type) {
          case 'text':
            sse.sendText(chunk.content);
            break;
          case 'source':
            sse.send('source', JSON.parse(chunk.content));
            break;
          case 'done':
            log.info('Generation stream complete');
            sse.send('done', { status: 'complete' });
            break;
          case 'error':
            log.error({ err: chunk.content }, 'Generation stream error');
            sse.send('error', { message: chunk.content });
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      log.error({ err: message }, 'Ask failed');
      sse.send('error', { message });
    } finally {
      sse.close();
    }
  })();

  return response;
}

/** POST /api/ingest — trigger document ingestion */
async function handleIngest(req: Request, ctx: RouteContext, log: Logger): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const directory = body.directory as string | undefined;
  if (!directory || typeof directory !== 'string') {
    return Response.json(
      { error: 'directory is required and must be a string' },
      { status: 400 },
    );
  }

  // Path traversal protection
  const ALLOWED_BASE = resolve(process.cwd());
  const resolved = resolve(directory);
  const normalized = normalize(resolved);

  if (!normalized.startsWith(ALLOWED_BASE)) {
    return withCors(Response.json(
      { error: 'Directory must be within the project root' },
      { status: 403 },
    ));
  }

  try {
    log.info({ directory }, 'Ingest request');
    const { ingestDirectory } = await import('../ingestion/pipeline.ts');
    const result = await ingestDirectory(directory, ctx.embedder, ctx.store);

    // Rebuild BM25 index from all stored documents so keyword search works
    const allDocs = await ctx.store.getAll();
    ctx.pipeline.indexDocuments(
      allDocs.map((doc) => ({ id: doc.id, content: doc.content, metadata: doc.metadata })),
    );
    ctx.pipeline.invalidateCache();

    log.info({ documentsLoaded: result.documentsLoaded, chunksStored: result.chunksStored }, 'Ingest complete');
    return Response.json({ status: 'ok', ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed';
    log.error({ err: message }, 'Ingest failed');
    return Response.json(
      { error: message, hint: 'Ensure the ingestion module is available' },
      { status: 500 },
    );
  }
}

/** GET /api/stats — return basic pipeline statistics */
async function handleStats(ctx: RouteContext): Promise<Response> {
  try {
    const count = await ctx.store.count();
    return Response.json({ documentCount: count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch stats';
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Serve a static file using Bun.file() */
async function serveStaticFile(path: string): Promise<Response> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return new Response(file);
  } catch {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }
}
