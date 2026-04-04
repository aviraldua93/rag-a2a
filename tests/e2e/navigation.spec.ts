import { test, expect } from '@playwright/test';

/**
 * E2E tests for navigation, health badge, and sidebar content.
 *
 * These tests exercise the real server responses for health, stats,
 * and agent card endpoints (no route interception needed for most).
 */

test.describe('Navigation & Layout', () => {
  test('tab switching works between search and chat', async ({ page }) => {
    await page.goto('/');

    const searchTab = page.locator('.tab-btn[data-tab="search"]');
    const chatTab = page.locator('.tab-btn[data-tab="chat"]');
    const searchPanel = page.locator('#panel-search');
    const chatPanel = page.locator('#panel-chat');

    // Initially search is active
    await expect(searchTab).toHaveClass(/active/);
    await expect(chatTab).not.toHaveClass(/active/);
    await expect(searchPanel).toBeVisible();

    // Switch to chat
    await chatTab.click();
    await expect(chatTab).toHaveClass(/active/);
    await expect(searchTab).not.toHaveClass(/active/);
    await expect(chatPanel).toBeVisible();

    // Switch back to search
    await searchTab.click();
    await expect(searchTab).toHaveClass(/active/);
    await expect(chatTab).not.toHaveClass(/active/);
    await expect(searchPanel).toBeVisible();

    // Switch to chat again to verify repeated switching
    await chatTab.click();
    await expect(chatTab).toHaveClass(/active/);
    await expect(chatPanel).toBeVisible();
  });

  test('health badge displays healthy status', async ({ page }) => {
    await page.goto('/');

    const badge = page.locator('#health-badge');
    const label = page.locator('#health-label');

    // Wait for the health check to complete and update the badge
    await expect(badge).toHaveAttribute('data-status', 'healthy', {
      timeout: 10_000,
    });
    await expect(label).toHaveText('Healthy');

    // The health dot should be visible inside the badge
    await expect(badge.locator('.health-dot')).toBeVisible();
  });

  test('sidebar loads stats', async ({ page }) => {
    await page.goto('/');

    const statsContainer = page.locator('#stats-container');

    // Wait for stats to load (the initial "Loading…" should be replaced)
    await expect(statsContainer.locator('.stat-label').first()).not.toHaveText(
      'Loading…',
      { timeout: 10_000 },
    );

    // Should display "Documents" row with a numeric value
    const docRow = statsContainer.locator('.stat-row').first();
    await expect(docRow.locator('.stat-label')).toHaveText('Documents');
    await expect(docRow.locator('.stat-value')).toBeVisible();
  });

  test('sidebar loads agent card', async ({ page }) => {
    await page.goto('/');

    const agentContainer = page.locator('#agent-container');

    // Wait for agent card to load
    await expect(agentContainer.locator('.agent-name')).toBeVisible({
      timeout: 10_000,
    });

    // Verify the agent name is displayed
    await expect(agentContainer.locator('.agent-name')).toHaveText(
      'RAG-A2A Agent',
    );

    // Verify a description is displayed
    const desc = agentContainer.locator('.agent-desc');
    await expect(desc).toBeVisible();
    await expect(desc).toContainText('Retrieval-Augmented Generation');

    // Agent URL should be shown
    await expect(agentContainer.locator('.agent-url')).toBeVisible();
  });

  test('agent card displays skills', async ({ page }) => {
    await page.goto('/');

    const agentContainer = page.locator('#agent-container');

    // Wait for agent card to load
    await expect(agentContainer.locator('.agent-name')).toBeVisible({
      timeout: 10_000,
    });

    // Skills list should be present
    const skills = agentContainer.locator('.skill-tag');
    await expect(skills).toHaveCount(3);

    // Verify skill names
    const skillNames = agentContainer.locator('.skill-name');
    await expect(skillNames.nth(0)).toHaveText('Retrieve Documents');
    await expect(skillNames.nth(1)).toHaveText('Answer Questions');
    await expect(skillNames.nth(2)).toHaveText('Search Knowledge Base');
  });

  test('only one tab panel is active at a time', async ({ page }) => {
    await page.goto('/');

    // Both panels exist
    const panels = page.locator('.tab-panel');
    await expect(panels).toHaveCount(2);

    // Only one should have the "active" class at any time
    const activePanels = page.locator('.tab-panel.active');
    await expect(activePanels).toHaveCount(1);

    // Switch to chat
    await page.locator('.tab-btn[data-tab="chat"]').click();
    await expect(page.locator('.tab-panel.active')).toHaveCount(1);
    await expect(page.locator('#panel-chat')).toHaveClass(/active/);

    // Switch back
    await page.locator('.tab-btn[data-tab="search"]').click();
    await expect(page.locator('.tab-panel.active')).toHaveCount(1);
    await expect(page.locator('#panel-search')).toHaveClass(/active/);
  });

  test('header brand is displayed', async ({ page }) => {
    await page.goto('/');

    // Logo text
    await expect(page.locator('.header-logo')).toHaveText('rag-a2a');

    // Subtitle
    await expect(page.locator('.header-subtitle')).toContainText(
      'Knowledge Agent',
    );
  });
});
