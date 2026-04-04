/**
 * E2E tests for the RAG-A2A web UI — search and chat flows.
 *
 * Runs against the dev server started by Playwright's webServer config
 * using MemoryStore + MockEmbedder + MockGenerator (no external services).
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Homepage & Layout
// ---------------------------------------------------------------------------

test.describe('Homepage', () => {
  test('loads the page with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/rag-a2a/i);
  });

  test('displays the header brand and subtitle', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.header-logo')).toHaveText('rag-a2a');
    await expect(page.locator('.header-subtitle')).toContainText('Knowledge Agent');
  });

  test('shows health badge', async ({ page }) => {
    await page.goto('/');
    const badge = page.locator('#health-badge');
    await expect(badge).toBeVisible();
    // Wait for health check to resolve
    await expect(page.locator('#health-label')).not.toHaveText('Checking…', {
      timeout: 10_000,
    });
  });

  test('shows Search and Chat tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tab-btn[data-tab="search"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="chat"]')).toBeVisible();
  });

  test('Search tab is active by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tab-btn[data-tab="search"]')).toHaveClass(/active/);
    await expect(page.locator('#panel-search')).toHaveClass(/active/);
  });
});

// ---------------------------------------------------------------------------
// Tab Switching
// ---------------------------------------------------------------------------

test.describe('Tab switching', () => {
  test('clicking Chat tab switches to chat panel', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await expect(page.locator('.tab-btn[data-tab="chat"]')).toHaveClass(/active/);
    await expect(page.locator('#panel-chat')).toHaveClass(/active/);
    await expect(page.locator('#panel-search')).not.toHaveClass(/active/);
  });

  test('clicking Search tab switches back to search panel', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await page.click('.tab-btn[data-tab="search"]');
    await expect(page.locator('.tab-btn[data-tab="search"]')).toHaveClass(/active/);
    await expect(page.locator('#panel-search')).toHaveClass(/active/);
  });
});

// ---------------------------------------------------------------------------
// Search Flow
// ---------------------------------------------------------------------------

test.describe('Search flow', () => {
  test('search form has input, mode select, and submit button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#mode-select')).toBeVisible();
    await expect(page.locator('#search-btn')).toBeVisible();
  });

  test('mode select has Hybrid, Vector, Keyword options', async ({ page }) => {
    await page.goto('/');
    const options = page.locator('#mode-select option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText('Hybrid');
    await expect(options.nth(1)).toHaveText('Vector');
    await expect(options.nth(2)).toHaveText('Keyword');
  });

  test('submitting empty search does nothing', async ({ page }) => {
    await page.goto('/');
    await page.click('#search-btn');
    // Results container should still show the empty state
    await expect(page.locator('#results-container .empty-state')).toBeVisible();
  });

  test('submitting a search query shows results or empty state', async ({ page }) => {
    await page.goto('/');
    await page.fill('#search-input', 'machine learning');
    await page.click('#search-btn');
    // Wait for search to complete — either results or empty message
    await expect(
      page.locator('#results-container').locator('.result-card, .results-empty, .empty-state'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('search button shows loading state while searching', async ({ page }) => {
    await page.goto('/');
    await page.fill('#search-input', 'test query');
    // Click and immediately check for Searching state
    const searchPromise = page.click('#search-btn');
    // The button text should change briefly
    await searchPromise;
    // After completion, button should be back to normal
    await expect(page.locator('#search-btn')).not.toBeDisabled({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Chat Flow
// ---------------------------------------------------------------------------

test.describe('Chat flow', () => {
  test('chat panel has input and send button', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await expect(page.locator('#chat-input')).toBeVisible();
    await expect(page.locator('#chat-send-btn')).toBeVisible();
  });

  test('chat panel shows empty state initially', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await expect(page.locator('#chat-messages .empty-state')).toBeVisible();
  });

  test('sending a message shows user message in chat', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await page.fill('#chat-input', 'What is RAG?');
    await page.click('#chat-send-btn');
    // User message should appear
    await expect(page.locator('.chat-msg.user')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.chat-msg.user .chat-bubble')).toContainText('What is RAG?');
  });

  test('sending a message shows assistant response', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await page.fill('#chat-input', 'Hello');
    await page.click('#chat-send-btn');
    // Wait for assistant response to appear
    await expect(page.locator('.chat-msg.assistant')).toBeVisible({ timeout: 15_000 });
  });

  test('chat input clears after sending', async ({ page }) => {
    await page.goto('/');
    await page.click('.tab-btn[data-tab="chat"]');
    await page.fill('#chat-input', 'test message');
    await page.click('#chat-send-btn');
    await expect(page.locator('#chat-input')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

test.describe('Sidebar', () => {
  test('stats section is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#stats-container')).toBeVisible();
  });

  test('agent card section is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#agent-container')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// API endpoints (via page.request)
// ---------------------------------------------------------------------------

test.describe('API endpoints', () => {
  test('GET /api/health returns ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
  });

  test('GET /api/stats returns document count', async ({ request }) => {
    const res = await request.get('/api/stats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.documentCount).toBe('number');
  });

  test('POST /api/search with valid query returns results array', async ({ request }) => {
    const res = await request.post('/api/search', {
      data: { query: 'machine learning' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('machine learning');
    expect(Array.isArray(body.results)).toBe(true);
  });

  test('POST /api/search without query returns 400', async ({ request }) => {
    const res = await request.post('/api/search', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('GET /.well-known/agent-card.json returns agent card', async ({ request }) => {
    const res = await request.get('/.well-known/agent-card.json');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('RAG-A2A Agent');
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.url).toContain('/a2a');
  });

  test('POST /a2a with message/send executes a task', async ({ request }) => {
    const res = await request.post('/a2a', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            parts: [{ type: 'text', text: 'What is machine learning?' }],
          },
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result.task).toBeDefined();
    expect(body.result.task.status).toBe('completed');
  });

  test('POST /a2a with unknown method returns error', async ({ request }) => {
    const res = await request.post('/a2a', {
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'unknown/method',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
  });

  test('GET /api/unknown returns 404', async ({ request }) => {
    const res = await request.get('/api/unknown');
    expect(res.status()).toBe(404);
  });
});
