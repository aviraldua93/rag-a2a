/** Server-Sent Events streaming helper for Bun */
export class SSEStream {
  private controller: ReadableStreamDefaultController | null = null;
  private encoder = new TextEncoder();

  /** Create a new SSE Response with appropriate headers */
  createResponse(): Response {
    const stream = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.controller = null;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /** Send a named event with JSON-serialised data */
  send(event: string, data: unknown): void {
    if (!this.controller) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.controller.enqueue(this.encoder.encode(payload));
  }

  /** Send a plain text chunk (default "message" event) */
  sendText(text: string): void {
    if (!this.controller) return;
    const payload = `data: ${JSON.stringify(text)}\n\n`;
    this.controller.enqueue(this.encoder.encode(payload));
  }

  /** Close the stream */
  close(): void {
    if (!this.controller) return;
    try {
      this.controller.close();
    } catch {
      // stream may already be closed
    }
    this.controller = null;
  }
}
