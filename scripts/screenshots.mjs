// Capture the screens used for visual review: node scripts/screenshots.mjs [outDir] [baseUrl]
// Requires a running preview (npm run build && npm run preview). Uses demo data only.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs/screenshots';
const base = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function session(width, scheme) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${width}/${scheme}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${width}/${scheme}: ${m.text()}`));
  return { ctx, page };
}
const shot = async (page, name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const dismissToast = async (page) => {
  const b = page.getByRole('button', { name: 'Dismiss' });
  if (await b.count()) await b.first().click().catch(() => {});
};

for (const width of [360, 390]) {
  const { ctx, page } = await session(width, 'dark'); // phone in dark mode: app must still open light
  await page.goto(`${base}/`);
  await shot(page, `${width}-01-welcome`);
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, `${width}-02-welcome-not-set-up`);
  await page.getByRole('button', { name: /Explore the demo/ }).click();
  await page.getByRole('heading', { level: 1, name: 'Today' }).waitFor();
  await shot(page, `${width}-03-today`);

  await page.goto(`${base}/#/food`);
  await page.getByRole('button', { name: 'Add usual Roti' }).click();
  await dismissToast(page);
  await page.getByRole('button', { name: 'Add usual Dal' }).click();
  await dismissToast(page);
  await shot(page, `${width}-04-food`);
  await page.getByRole('button', { name: /^Chai, 1 cup/ }).click();
  await shot(page, `${width}-05-portion-sheet`);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Add food' }).click();
  await shot(page, `${width}-06-add-food`);
  await page.getByRole('button', { name: /Create meal/ }).click();
  await shot(page, `${width}-07-meal-editor`);

  await page.goto(`${base}/#/workout`);
  await shot(page, `${width}-08-my-plan`);
  await page.goto(`${base}/#/plan`);
  await page.getByRole('button', { name: /^Bench press/ }).click();
  await shot(page, `${width}-09-plan-editor`);
  await page.goto(`${base}/#/workout`);
  await page.getByRole('button', { name: 'Start Push' }).click();
  const bench = page.getByRole('region', { name: 'Bench press' });
  await bench.getByRole('button', { name: 'Complete Warmup set' }).click();
  await bench.getByRole('button', { name: 'Complete Set 1' }).click();
  await shot(page, `${width}-10-active-workout`);

  await page.goto(`${base}/#/progress`);
  await shot(page, `${width}-11-progress`);
  await page.mouse.wheel(0, 700);
  await shot(page, `${width}-12-progress-lower`);
  await page.goto(`${base}/#/coach`);
  await shot(page, `${width}-13-coach-demo`);
  await page.goto(`${base}/#/settings`);
  await shot(page, `${width}-14-settings`);

  // Dark mode chosen explicitly.
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await page.goto(`${base}/#/today`);
  await shot(page, `${width}-15-today-dark`);
  await page.goto(`${base}/#/workout`);
  await shot(page, `${width}-16-workout-dark`);
  await page.goto(`${base}/#/food`);
  await shot(page, `${width}-17-food-dark`);
  await ctx.close();
}

// Empty states: Demo B on a fresh browser has no meals logged today and a plan; also an empty progress period.
{
  const { ctx, page } = await session(390, 'light');
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: /Explore the demo/ }).click();
  await page.goto(`${base}/#/progress`);
  await page.getByRole('button', { name: '7 days' }).click();
  await shot(page, '390-18-progress-7days');
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`Screenshots written to ${out}`);
