import { defineConfig, devices } from '@playwright/test';

/**
 * Two builds:
 *  - demo (port 4173): no backend configured → demo + "sign-in is being set up" paths.
 *  - auth harness (port 4174): built with a FAKE Supabase project URL; every request to it is
 *    answered by a scripted mock inside the test (tests/e2e/mockSupabase.ts). No real credentials.
 */
const FAKE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
// Ports can be moved (E2E_DEMO_PORT / E2E_AUTH_PORT) so two checkouts can run the suite at once.
const DEMO = Number(process.env.E2E_DEMO_PORT ?? 4173);
const AUTH = Number(process.env.E2E_AUTH_PORT ?? 4174);
const AUTH_DIST = AUTH === 4174 ? 'dist-e2e-auth' : `dist-e2e-auth-${AUTH}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'demo', testMatch: /app\.spec\.ts/, use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: `http://localhost:${DEMO}` } },
    { name: 'auth-harness', testMatch: /auth\.spec\.ts/, use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: `http://localhost:${AUTH}`, serviceWorkers: 'block' } },
  ],
  webServer: [
    { command: `npm run build && npx vite preview --port ${DEMO} --strictPort`, url: `http://localhost:${DEMO}`, reuseExistingServer: false, timeout: 180_000 },
    {
      command: `VITE_SUPABASE_URL=${FAKE_URL} VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e_fake npx vite build --outDir ${AUTH_DIST} && npx vite preview --outDir ${AUTH_DIST} --port ${AUTH} --strictPort`,
      url: `http://localhost:${AUTH}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
