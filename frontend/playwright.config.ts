import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:4173'
const shouldStartWebServer = !process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './playwright',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
  },
  ...(shouldStartWebServer
    ? {
        webServer: {
          command: 'npm run dev -- --host 127.0.0.1 --port 4173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: baseURL,
        },
      }
    : {}),
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
