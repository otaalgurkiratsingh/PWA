// Render PNG install icons from the owner's TrainLuma logo artwork (public/icons/logo-source.png)
// using the local Chromium (Playwright). The artwork is full-bleed with the TL mark inside the
// maskable safe zone, so the same picture serves "any" and "maskable" icons.
// Usage: node scripts/render-icons.mjs
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const src = `data:image/png;base64,${readFileSync(new URL('../public/icons/logo-source.png', import.meta.url)).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, file, rounded = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" style="display:block;width:${size}px;height:${size}px;${rounded ? `border-radius:${size * 0.22}px` : ''}"></body></html>`);
  await page.waitForFunction(() => globalThis.document.images[0].complete);
  await page.screenshot({ path: new URL(`../public/icons/${file}`, import.meta.url).pathname, omitBackground: true });
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png');
await render(180, 'apple-touch-icon.png');
await browser.close();
console.log('icons rendered');
