import { v4 as uuidv4 } from 'uuid';
import type { TaskExecutor } from './executor.ts';
import { createAgentCard } from './agent-card.ts';

/** JSON-RPC 2.0 error codes */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INTERNAL_ERROR: -32603,
} as const;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** Create a JSON-RPC 2.0 success response */
function jsonRpcSuccess(id: string | number | null | undefined, result: unknown): Response {
  return Response.json({
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  });
}

/** Create a JSON-RPC 2.0 error response */
function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data !== undefined && { data }) },
    },
    { status: code === JSON_RPC_ERRORS.PARSE_ERROR ? 400 : 200 },
  );
}

/** Handle A2A protocol requests (agent card + JSON-RPC dispatch) */
export async function handleA2ARequest(
  request: Request,
  executor: TaskExecutor,
  baseUrl: string,
): Promise<Response> {
  const url = new URL(request.url);

  // Agent card discovery endpoint
  if (url.pathname === '/.well-known/agent-card.json' && request.method === 'GET') {
    return Response.json(createAgentCard(baseUrl));
  }

  // A2A JSON-RPC endpoint
  if (url.pathname === '/a2a' && request.method === 'POST') {
    return handleJsonRpc(request, executor);
  }

  return new Response('Not Found', { status: 404 });
}

/** Parse and dispatch a JSON-RPC 2.0 request */
async function handleJsonRpc(request: Request, executor: TaskExecutor): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error: invalid JSON');
  }

  const rpc = body as Partial<JsonRpcRequest>;

  // Validate JSON-RPC structure
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return jsonRpcError(
      rpc?.id ?? null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Invalid request: missing jsonrpc version or method',
    );
  }

  const { id, method, params } = rpc as JsonRpcRequest;

  switch (method) {
    case 'message/send':
      return handleMessageSend(id, params, executor);

    case 'tasks/get':
      return handleTasksGet(id, params, executor);

    case 'tasks/list':
      return handleTasksList(id, executor);

    case 'tasks/cancel':
      return handleTasksCancel(id, params, executor);

    default:
      return jsonRpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/** Handle message/send — create and execute a task */
async function handleMessageSend(
  id: string | number | null | undefined,
  params: Record<string, unknown> | undefined,
  executor: TaskExecutor,
): Promise<Response> {
  const message = params?.message as { parts?: { type: string; text: string }[] } | undefined;
  const text =
    message?.parts?.find((p) => p.type === 'text')?.text ??
    (typeof params?.query === 'string' ? params.query : null);

  if (!text) {
    return jsonRpcError(
      id,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Invalid params: message must contain a text part or a query string',
    );
  }

  const taskId = uuidv4();
  const task = await executor.execute(taskId, text);

  return jsonRpcSuccess(id, { task });
}

/** Handle tasks/get — return a specific task */
function handleTasksGet(
  id: string | number | null | undefined,
  params: Record<string, unknown> | undefined,
  executor: TaskExecutor,
): Response {
  const taskId = params?.taskId as string | undefined;
  if (!taskId) {
    return jsonRpcError(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid params: taskId is required');
  }

  const task = executor.getTask(taskId);
  if (!task) {
    return jsonRpcError(id, JSON_RPC_ERRORS.INVALID_REQUEST, `Task not found: ${taskId}`);
  }

  return jsonRpcSuccess(id, { task });
}

/** Handle tasks/list — return all tasks */
function handleTasksList(
  id: string | number | null | undefined,
  executor: TaskExecutor,
): Response {
  return jsonRpcSuccess(id, { tasks: executor.listTasks() });
}

/** Handle tasks/cancel — cancel a pending/working task */
function handleTasksCancel(
  id: string | number | null | undefined,
  params: Record<string, unknown> | undefined,
  executor: TaskExecutor,
): Response {
  const taskId = params?.taskId as string | undefined;
  if (!taskId) {
    return jsonRpcError(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid params: taskId is required');
  }

  const task = executor.cancelTask(taskId);
  if (!task) {
    return jsonRpcError(id, JSON_RPC_ERRORS.INVALID_REQUEST, `Task not found: ${taskId}`);
  }

  return jsonRpcSuccess(id, { task });
}
