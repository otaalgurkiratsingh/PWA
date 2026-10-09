import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/** Emit /sw.js with a precache list of this build's shell files and a content-derived build id. */
function serviceWorker(): Plugin {
  const publicDir = fileURLToPath(new URL('./public', import.meta.url));
  const listPublic = (dir: string, prefix = ''): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return listPublic(p, `${prefix}/${f}`);
      return f.startsWith('_') ? [] : [`${prefix}/${f}`];
    });
  return {
    name: 'rozana-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const assets = Object.keys(bundle).map((f) => `/${f}`);
      const precache = ['/', '/index.html', ...listPublic(publicDir), ...assets].filter((f, i, a) => a.indexOf(f) === i);
      const id = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(fileURLToPath(new URL('./src/sw/sw.js', import.meta.url)), 'utf8');
      const src = template
        .replace("const BUILD_ID = '__BUILD_ID__';", `const BUILD_ID = ${JSON.stringify(id)};`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(precache)};`);
      if (src.includes('__BUILD_ID__') || src.includes('__PRECACHE__')) this.error('service worker placeholders were not replaced');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // No source maps in production output: avoids shipping source and reduces leak surface.
    sourcemap: false,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
