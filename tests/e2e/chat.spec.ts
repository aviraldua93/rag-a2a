import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Chat tab UI.
 *
 * The real server uses MockGenerator (no API key), but the client's SSE
 * parser expects a specific protocol (`data: {type,content}`). We use
 * route interception to supply correctly-formatted SSE streams so the
 * UI renders messages, streaming cursors, and source citations.
 */

/** Build an SSE body string the client can parse. */
function buildSSE(
  chunks: string[],
  sources?: { source: string }[],
): string {
  const lines: string[] = [];
  for (const text of chunks) {
    lines.push(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n`);
  }
  if (sources?.length) {
    lines.push(
      `data: ${JSON.stringify({ type: 'sources', sources })}\n`,
    );
  }
  lines.push('data: [DONE]\n');
  return lines.join('\n');
}

/** Intercept /api/ask and return a mocked SSE stream. */
function mockAskSSE(chunks: string[], sources?: { source: string }[]) {
  return async (route: import('@playwright/test').Route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
      body: buildSSE(chunks, sources),
    });
  };
}

/** Navigate to the Chat tab. */
async function goToChat(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="chat"]').click();
  await expect(page.locator('#panel-chat')).toHaveClass(/active/);
}

test.describe('Chat Tab', () => {
  test('switching to chat tab shows chat panel', async ({ page }) => {
    await page.goto('/');

    // Initially search is active
    await expect(page.locator('#panel-search')).toHaveClass(/active/);
    await expect(page.locator('#panel-chat')).not.toHaveClass(/active/);

    // Click the chat tab
    await page.locator('.tab-btn[data-tab="chat"]').click();

    // Chat panel should now be active and visible
    await expect(page.locator('#panel-chat')).toHaveClass(/active/);
    await expect(page.locator('#panel-chat')).toBeVisible();

    // Chat input and send button should be visible
    await expect(page.locator('#chat-input')).toBeVisible();
    await expect(page.locator('#chat-send-btn')).toBeVisible();

    // Chat messages area should be visible (with empty state)
    await expect(page.locator('#chat-messages')).toBeVisible();
  });

  test('sending message shows user bubble', async ({ page }) => {
    // Mock the ask endpoint to prevent hanging
    await page.route(
      '**/api/ask',
      mockAskSSE(['Hello!'], []),
    );

    await goToChat(page);

    // Type a message
    await page.locator('#chat-input').fill('What is machine learning?');

    // Click Send
    await page.locator('#chat-send-btn').click();

    // A user message bubble should appear
    const userMsg = page.locator('.chat-msg.user');
    await expect(userMsg).toBeVisible();

    // The bubble should contain the sent text
    await expect(userMsg.locator('.chat-bubble')).toContainText(
      'What is machine learning?',
    );

    // The avatar should show "You"
    await expect(userMsg.locator('.chat-avatar')).toHaveText('You');
  });

  test('assistant response appears with streamed content', async ({ page }) => {
    const responseChunks = [
      'Machine learning ',
      'is a branch of ',
      'artificial intelligence ',
      'that focuses on ',
      'building systems that learn from data.',
    ];

    await page.route('**/api/ask', mockAskSSE(responseChunks));
    await goToChat(page);

    await page.locator('#chat-input').fill('What is ML?');
    await page.locator('#chat-send-btn').click();

    // Wait for the assistant message to appear
    const assistantMsg = page.locator('.chat-msg.assistant');
    await expect(assistantMsg).toBeVisible();

    // The bubble should contain the full streamed text
    const bubble = assistantMsg.locator('.chat-bubble');
    await expect(bubble).toContainText(
      'Machine learning is a branch of artificial intelligence',
    );

    // Avatar should show "AI"
    await expect(assistantMsg.locator('.chat-avatar')).toHaveText('AI');
  });

  test('Enter key submits the message', async ({ page }) => {
    await page.route(
      '**/api/ask',
      mockAskSSE(['Response to enter test.']),
    );

    await goToChat(page);

    // Type a message and press Enter (without Shift)
    await page.locator('#chat-input').fill('Enter key test');
    await page.locator('#chat-input').press('Enter');

    // User bubble should appear with the typed text
    const userMsg = page.locator('.chat-msg.user');
    await expect(userMsg).toBeVisible();
    await expect(userMsg.locator('.chat-bubble')).toContainText('Enter key test');

    // Assistant response should also arrive
    const assistantMsg = page.locator('.chat-msg.assistant');
    await expect(assistantMsg).toBeVisible();
    await expect(assistantMsg.locator('.chat-bubble')).toContainText(
      'Response to enter test',
    );
  });

  test('chat shows sources when available', async ({ page }) => {
    const chunks = ['RAG combines retrieval with generation.'];
    const sources = [
      { source: 'rag-guide.md' },
      { source: 'ml-overview.md' },
      { source: 'hybrid-search.md' },
    ];

    await page.route('**/api/ask', mockAskSSE(chunks, sources));
    await goToChat(page);

    await page.locator('#chat-input').fill('What is RAG?');
    await page.locator('#chat-send-btn').click();

    // Wait for the assistant message
    const assistantMsg = page.locator('.chat-msg.assistant');
    await expect(assistantMsg).toBeVisible();

    // Sources section should be present
    const sourcesSection = assistantMsg.locator('.chat-sources');
    await expect(sourcesSection).toBeVisible();

    // The "Sources" title should be present
    await expect(sourcesSection.locator('.chat-sources-title')).toHaveText(
      'Sources',
    );

    // Three source tags should be displayed
    const tags = sourcesSection.locator('.chat-source-tag');
    await expect(tags).toHaveCount(3);
    await expect(tags.nth(0)).toHaveText('rag-guide.md');
    await expect(tags.nth(1)).toHaveText('ml-overview.md');
    await expect(tags.nth(2)).toHaveText('hybrid-search.md');
  });

  test('empty message does not submit', async ({ page }) => {
    let apiCalled = false;
    await page.route('**/api/ask', async (route) => {
      apiCalled = true;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'data: [DONE]\n\n',
      });
    });

    await goToChat(page);

    // Ensure input is empty
    await expect(page.locator('#chat-input')).toHaveValue('');

    // Click Send
    await page.locator('#chat-send-btn').click();
    await page.waitForTimeout(500);

    // No API call should have been made
    expect(apiCalled).toBe(false);

    // No chat messages should have appeared (empty state or no chat-msg)
    await expect(page.locator('.chat-msg')).toHaveCount(0);
  });

  test('send button shows streaming state during response', async ({ page }) => {
    // Delay the SSE response to observe streaming state
    await page.route('**/api/ask', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: buildSSE(['Delayed response.']),
      });
    });

    await goToChat(page);

    const sendBtn = page.locator('#chat-send-btn');
    await expect(sendBtn).toHaveText('Send');

    await page.locator('#chat-input').fill('Streaming test');
    await sendBtn.click();

    // During streaming, button should show "Streaming…" and be disabled
    await expect(sendBtn).toBeDisabled();
    await expect(sendBtn).toHaveText('Streaming…');

    // After response completes, button should re-enable
    await expect(sendBtn).toHaveText('Send', { timeout: 5000 });
    await expect(sendBtn).toBeEnabled();
  });

  test('chat input clears after sending', async ({ page }) => {
    await page.route('**/api/ask', mockAskSSE(['Quick response.']));
    await goToChat(page);

    const input = page.locator('#chat-input');
    await input.fill('Should be cleared');
    await page.locator('#chat-send-btn').click();

    // Input should be cleared after submission
    await expect(input).toHaveValue('');
  });
});
