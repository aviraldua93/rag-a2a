import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Search tab UI.
 *
 * Uses Playwright route interception to mock /api/search responses,
 * ensuring tests are deterministic regardless of MemoryStore contents.
 */

/** Helper: mock the search API to return the given results array. */
function mockSearchResults(
  results: { id: string; score: number; content: string; metadata: { source: string } }[],
) {
  return async (route: import('@playwright/test').Route) => {
    const body = route.request().postData();
    const { query } = body ? JSON.parse(body) : { query: '' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query, results, count: results.length }),
    });
  };
}

const SAMPLE_RESULTS = [
  {
    id: 'doc-1',
    score: 0.952,
    content:
      'Machine learning is a branch of artificial intelligence that focuses on building systems that learn from data.',
    metadata: { source: 'ml-guide.md' },
  },
  {
    id: 'doc-2',
    score: 0.871,
    content:
      'Deep learning uses neural networks with many layers to model complex patterns.',
    metadata: { source: 'dl-guide.md' },
  },
  {
    id: 'doc-3',
    score: 0.783,
    content: 'Supervised learning uses labeled examples to train models.',
    metadata: { source: 'supervised.md' },
  },
];

test.describe('Search Tab', () => {
  test('page loads with search tab active', async ({ page }) => {
    await page.goto('/');

    // Search tab button should have the active class
    const searchTabBtn = page.locator('.tab-btn[data-tab="search"]');
    await expect(searchTabBtn).toHaveClass(/active/);

    // Search panel should be visible
    const searchPanel = page.locator('#panel-search');
    await expect(searchPanel).toHaveClass(/active/);
    await expect(searchPanel).toBeVisible();

    // Chat panel should NOT be active/visible
    const chatPanel = page.locator('#panel-chat');
    await expect(chatPanel).not.toHaveClass(/active/);

    // Search input and button should be present
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#search-btn')).toBeVisible();
    await expect(page.locator('#mode-select')).toBeVisible();
  });

  test('submit search shows results', async ({ page }) => {
    await page.route('**/api/search', mockSearchResults(SAMPLE_RESULTS));
    await page.goto('/');

    // Type a query and click Search
    await page.locator('#search-input').fill('machine learning');
    await page.locator('#search-btn').click();

    // Wait for result cards to appear
    const resultCards = page.locator('.result-card');
    await expect(resultCards).toHaveCount(3);

    // First result should contain expected text
    await expect(resultCards.first()).toContainText('Machine learning is a branch');
  });

  test('search mode dropdown changes mode', async ({ page }) => {
    await page.goto('/');

    const modeSelect = page.locator('#mode-select');

    // Default is hybrid
    await expect(modeSelect).toHaveValue('hybrid');

    // Switch to vector
    await modeSelect.selectOption('vector');
    await expect(modeSelect).toHaveValue('vector');

    // Switch to keyword
    await modeSelect.selectOption('keyword');
    await expect(modeSelect).toHaveValue('keyword');

    // Back to hybrid
    await modeSelect.selectOption('hybrid');
    await expect(modeSelect).toHaveValue('hybrid');
  });

  test('empty query does not submit', async ({ page }) => {
    let apiCalled = false;
    await page.route('**/api/search', async (route) => {
      apiCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"results":[],"count":0}',
      });
    });

    await page.goto('/');

    // Ensure input is empty
    await expect(page.locator('#search-input')).toHaveValue('');

    // Click the search button
    await page.locator('#search-btn').click();

    // Wait a beat to ensure nothing fires
    await page.waitForTimeout(500);

    // API should NOT have been called
    expect(apiCalled).toBe(false);

    // Empty state should still be shown
    await expect(page.locator('#results-container .empty-state')).toBeVisible();
  });

  test('results display score and content', async ({ page }) => {
    await page.route('**/api/search', mockSearchResults(SAMPLE_RESULTS));
    await page.goto('/');

    await page.locator('#search-input').fill('neural networks');
    await page.locator('#search-btn').click();

    // Wait for results
    await expect(page.locator('.result-card')).toHaveCount(3);

    // First result: verify score, content, and source
    const first = page.locator('.result-card').first();
    await expect(first.locator('.result-score')).toHaveText('0.952');
    await expect(first.locator('.result-content')).toContainText(
      'Machine learning is a branch of artificial intelligence',
    );
    await expect(first.locator('.result-source')).toHaveText('ml-guide.md');

    // Second result: verify score
    const second = page.locator('.result-card').nth(1);
    await expect(second.locator('.result-score')).toHaveText('0.871');
    await expect(second.locator('.result-source')).toHaveText('dl-guide.md');

    // Third result
    const third = page.locator('.result-card').nth(2);
    await expect(third.locator('.result-score')).toHaveText('0.783');
  });

  test('selected search mode is sent in API request', async ({ page }) => {
    let capturedBody: Record<string, unknown> = {};
    await page.route('**/api/search', async (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ query: capturedBody.query, results: [], count: 0 }),
      });
    });

    await page.goto('/');

    // Select keyword mode before searching
    await page.locator('#mode-select').selectOption('keyword');
    await page.locator('#search-input').fill('test query');
    await page.locator('#search-btn').click();

    // Give the request time to complete
    await page.waitForTimeout(500);

    expect(capturedBody.query).toBe('test query');
    expect(capturedBody.mode).toBe('keyword');
  });

  test('no results shows empty state message', async ({ page }) => {
    await page.route('**/api/search', mockSearchResults([]));
    await page.goto('/');

    await page.locator('#search-input').fill('nonexistent gibberish query');
    await page.locator('#search-btn').click();

    // Empty-results state should appear
    const empty = page.locator('#results-container .results-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No results found');
  });

  test('search button disables while searching', async ({ page }) => {
    // Delay the API response to observe button state
    await page.route('**/api/search', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], count: 0 }),
      });
    });

    await page.goto('/');
    await page.locator('#search-input').fill('test');

    const btn = page.locator('#search-btn');
    await expect(btn).toBeEnabled();

    // Click and immediately check disabled state
    await btn.click();
    await expect(btn).toBeDisabled();

    // After response, button should re-enable
    await expect(btn).toBeEnabled({ timeout: 5000 });
  });
});
