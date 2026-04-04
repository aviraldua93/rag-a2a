import type { RetrievalPipeline } from '../retrieval/pipeline.ts';
import type { RAGGenerator } from '../generation/generator.ts';
import type { MockGenerator } from '../generation/generator.ts';
import type { TaskExecutor } from '../a2a/executor.ts';
import { handleA2ARequest } from '../a2a/server.ts';
import { SSEStream } from './sse.ts';

/** Dependencies injected into the request handler */
export interface RouteContext {
  pipeline: RetrievalPipeline;
  generator: RAGGenerator | MockGenerator | null;
  executor: TaskExecutor;
  baseUrl: string;
}

/** Add CORS headers to a response */
function withCors(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

/** Main request router */
export async function handleRequest(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

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
    return withCors(Response.json({ status: 'ok', version: '0.1.0' }));
  }

  if (pathname === '/api/search' && req.method === 'POST') {
    return withCors(await handleSearch(req, ctx));
  }

  if (pathname === '/api/ask' && req.method === 'POST') {
    return withCors(await handleAsk(req, ctx));
  }

  if (pathname === '/api/ingest' && req.method === 'POST') {
    return withCors(await handleIngest(req));
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    return withCors(await handleStats(ctx));
  }

  return withCors(Response.json({ error: 'Not Found' }, { status: 404 }));
}

/** POST /api/search — run retrieval pipeline */
async function handleSearch(req: Request, ctx: RouteContext): Promise<Response> {
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
    const retrieval = await ctx.pipeline.retrieve(query, { topK, mode });
    return Response.json({
      query,
      results: retrieval.results,
      count: retrieval.results.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

/** POST /api/ask — streaming RAG answer via SSE */
async function handleAsk(req: Request, ctx: RouteContext): Promise<Response> {
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

  const sse = new SSEStream();
  const response = sse.createResponse();

  // Run retrieval + generation in background so we can return the SSE response immediately
  (async () => {
    try {
      const retrieval = await ctx.pipeline.retrieve(query);
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
            sse.send('done', { status: 'complete' });
            break;
          case 'error':
            sse.send('error', { message: chunk.content });
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      sse.send('error', { message });
    } finally {
      sse.close();
    }
  })();

  return response;
}

/** POST /api/ingest — trigger document ingestion */
async function handleIngest(req: Request): Promise<Response> {
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

  try {
    // Dynamic import so the server module doesn't hard-depend on the ingestion module
    const { IngestionPipeline } = await import('../ingestion/pipeline.ts');
    const pipeline = new IngestionPipeline();
    const result = await pipeline.ingest(directory);
    return Response.json({ status: 'ok', ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed';
    return Response.json(
      { error: message, hint: 'Ensure the ingestion module is available' },
      { status: 500 },
    );
  }
}

/** GET /api/stats — return basic pipeline statistics */
async function handleStats(ctx: RouteContext): Promise<Response> {
  try {
    // Try to call getStats on the pipeline if it exposes one
    const pipeline = ctx.pipeline as Record<string, unknown>;
    if (typeof pipeline.getStats === 'function') {
      const stats = await (pipeline.getStats as () => Promise<unknown>)();
      return Response.json(stats);
    }

    // Fallback: return basic info
    return Response.json({
      documentCount: 0,
      indexSize: 0,
      status: 'Stats not available — pipeline does not expose getStats()',
    });
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
