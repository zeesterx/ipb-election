import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT || '3000';
const webPort = process.env.E2E_WEB_PORT || '4173';
const apiURL = `http://127.0.0.1:${apiPort}/api`;
const reuseExistingServer = process.env.E2E_REUSE_EXISTING_SERVER === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'npm run build -w backend && npm run start:e2e -w backend',
      url: `${apiURL}/health`,
      reuseExistingServer,
      timeout: 120_000
    },
    {
      command: `npm run build -w frontend && npm run preview -w frontend -- --host 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer,
      timeout: 120_000,
      env: {
        VITE_API_URL: apiURL,
        VITE_DEV_ADMIN: 'true',
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'playwright-public-placeholder-key'
      }
    }
  ],
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } }
  ]
});
