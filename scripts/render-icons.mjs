// Render PNG install icons and favicons from the vector TL mark (public/icons/trainluma-mark.svg,
// redrawn from the owner's 2026-10-12 logo; artwork reference: docs/trainluma-logo-v2.jpg)
// using the local Chromium (Playwright). The artwork is full-bleed with the TL mark inside the
// maskable safe zone, so the same picture serves "any" and "maskable" icons.
// Usage: node scripts/render-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = (f) => `data:image/svg+xml;base64,${readFileSync(new URL(`../public/icons/${f}`, import.meta.url)).toString('base64')}`;
const src = svg('trainluma-mark.svg');
const maskable = svg('trainluma-maskable.svg');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, file, rounded = false, from = src) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${from}" style="display:block;width:${size}px;height:${size}px;${rounded ? `border-radius:${size * 0.22}px` : ''}"></body></html>`);
  await page.waitForFunction(() => globalThis.document.images[0].complete);
  await page.screenshot({ path: new URL(`../public/icons/${file}`, import.meta.url).pathname, omitBackground: true });
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', false, maskable);
await render(180, 'apple-touch-icon.png', false, maskable); // iOS rounds it itself: full-bleed tile
// Browser-tab favicons (rounded like the app icon), plus a multi-size favicon.ico at the site root
// for browsers that ask for /favicon.ico directly.
const sizes = [16, 32, 48];
for (const s of sizes) await render(s, `favicon-${s}.png`);
const pngs = sizes.map((s) => readFileSync(new URL(`../public/icons/favicon-${s}.png`, import.meta.url)));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(sizes[i] % 256, e); header.writeUInt8(sizes[i] % 256, e + 1); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync(new URL('../public/favicon.ico', import.meta.url), Buffer.concat([header, ...pngs]));
await browser.close();
console.log('icons rendered');
