/**
 * Unit tests for the SSE streaming helper.
 */
import { describe, test, expect } from 'bun:test';
import { SSEStream } from '../../src/server/sse.ts';

describe('SSEStream', () => {
  test('createResponse returns response with correct SSE headers', () => {
    const sse = new SSEStream();
    const response = sse.createResponse();
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    sse.close();
  });

  test('send() encodes named events correctly', async () => {
    const sse = new SSEStream();
    const response = sse.createResponse();

    sse.send('status', { phase: 'retrieval_complete' });
    sse.close();

    const text = await response.text();
    expect(text).toContain('event: status\n');
    expect(text).toContain('data: {"phase":"retrieval_complete"}\n');
  });

  test('sendText() encodes data as default message event', async () => {
    const sse = new SSEStream();
    const response = sse.createResponse();

    sse.sendText('Hello world');
    sse.close();

    const text = await response.text();
    expect(text).toContain('data: "Hello world"\n');
    // Should NOT contain an "event:" prefix for sendText
    expect(text).not.toContain('event:');
  });

  test('close() prevents further writes and does not throw on double close', async () => {
    const sse = new SSEStream();
    const response = sse.createResponse();

    sse.sendText('before close');
    sse.close();

    // Writing after close should be a no-op (no throw)
    sse.send('noop', { ignored: true });
    sse.sendText('also ignored');

    // Double close should not throw
    expect(() => sse.close()).not.toThrow();

    const text = await response.text();
    expect(text).toContain('before close');
    expect(text).not.toContain('noop');
    expect(text).not.toContain('also ignored');
  });

  test('multiple sends are concatenated in order', async () => {
    const sse = new SSEStream();
    const response = sse.createResponse();

    sse.send('source', { id: 1 });
    sse.sendText('chunk-1');
    sse.sendText('chunk-2');
    sse.send('done', { status: 'complete' });
    sse.close();

    const text = await response.text();
    const sourceIdx = text.indexOf('event: source');
    const chunk1Idx = text.indexOf('"chunk-1"');
    const chunk2Idx = text.indexOf('"chunk-2"');
    const doneIdx = text.indexOf('event: done');

    expect(sourceIdx).toBeLessThan(chunk1Idx);
    expect(chunk1Idx).toBeLessThan(chunk2Idx);
    expect(chunk2Idx).toBeLessThan(doneIdx);
  });
});
