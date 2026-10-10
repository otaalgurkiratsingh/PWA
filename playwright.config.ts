import { defineConfig, devices } from '@playwright/test';

/**
 * Two builds:
 *  - demo (port 4173): no backend configured → demo + "sign-in is being set up" paths.
 *  - auth harness (port 4174): built with a FAKE Supabase project URL; every request to it is
 *    answered by a scripted mock inside the test (tests/e2e/mockSupabase.ts). No real credentials.
 */
const FAKE_URL = 'https://abcdefghijklmnopqrst.supabase.co';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'demo', testMatch: /app\.spec\.ts/, use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: 'http://localhost:4173' } },
    { name: 'auth-harness', testMatch: /auth\.spec\.ts/, use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: 'http://localhost:4174', serviceWorkers: 'block' } },
  ],
  webServer: [
    { command: 'npm run build && npx vite preview --port 4173', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 180_000 },
    {
      command: `VITE_SUPABASE_URL=${FAKE_URL} VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e_fake npx vite build --outDir dist-e2e-auth && npx vite preview --outDir dist-e2e-auth --port 4174`,
      url: 'http://localhost:4174',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
