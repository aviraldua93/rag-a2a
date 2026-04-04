import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for RAG-A2A E2E tests.
 *
 * Uses MemoryStore + MockEmbedder + MockGenerator via env vars
 * so tests run without Docker, API keys, or network access.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:49321',
    trace: 'on-first-retry',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun run src/server/index.ts',
    port: 49321,
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '49321',
      HOST: 'localhost',
      OPENAI_API_KEY: '',
      QDRANT_URL: '',
    },
  },
});
