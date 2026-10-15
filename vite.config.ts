import { defineConfig, type Plugin } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { FORM_PHOTO_BASE, FORM_PHOTO_COMMIT, FORM_PHOTO_COMMIT_SHORT, isSafePhotoId, libraryPhotoIds } from './shared/catalogue/exerciseImages.ts';

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
      const assets = Object.keys(bundle).filter((f) => !f.startsWith('_')).map((f) => `/${f}`);
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

/**
 * Copy the vendored exercise form photos (downloaded once into .cache/ by
 * scripts/vendor-exercise-images.mts) into <outDir>/exercise-img/ with a manifest of the ids that
 * have both photos. Runs after the bundle is written, so the photos are never in the JS bundle or
 * the service worker precache list. SKIP_EXERCISE_IMAGES=1 writes an empty manifest (steps only).
 */
function exerciseImages(): Plugin {
  const cacheDir = fileURLToPath(new URL(`./.cache/exercise-img/${FORM_PHOTO_COMMIT.slice(0, 12)}`, import.meta.url));
  const has = (p: string) => { try { return statSync(p).size > 0; } catch { return false; } };
  const available = () => {
    if (process.env.SKIP_EXERCISE_IMAGES === '1') return [];
    const raw: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('./shared/data/exercise-library-v1.json', import.meta.url)), 'utf8'));
    return libraryPhotoIds(raw).filter((id) => has(join(cacheDir, id, '0.jpg')) && has(join(cacheDir, id, '1.jpg')));
  };
  const manifest = (ids: string[]) => JSON.stringify({ commit: FORM_PHOTO_COMMIT, ids });
  return {
    name: 'trainluma-exercise-img',
    configureServer(server) {
      // Dev server: serve the same paths straight from the cache.
      server.middlewares.use(FORM_PHOTO_BASE, (req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (path === '/manifest.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(manifest(available()));
          return;
        }
        const m = /^\/([^/]+)\/([01])\.jpg$/.exec(path);
        const file = m && isSafePhotoId(m[1]) ? join(cacheDir, m[1], `${m[2]}.jpg`) : null;
        if (!file || !has(file)) return next();
        res.setHeader('Content-Type', 'image/jpeg');
        res.end(readFileSync(file));
      });
    },
    writeBundle(opts) {
      const outDir = opts.dir ?? fileURLToPath(new URL('./dist', import.meta.url));
      const ids = available();
      let bytes = 0;
      for (const id of ids) {
        mkdirSync(join(outDir, 'exercise-img', id), { recursive: true });
        for (const f of ['0.jpg', '1.jpg']) {
          copyFileSync(join(cacheDir, id, f), join(outDir, 'exercise-img', id, f), constants.COPYFILE_FICLONE);
          bytes += statSync(join(cacheDir, id, f)).size;
        }
      }
      mkdirSync(join(outDir, 'exercise-img'), { recursive: true });
      writeFileSync(join(outDir, 'exercise-img', 'manifest.json'), manifest(ids));
      console.log(`\n[exercise-img] form photos: ${ids.length} exercises, ${ids.length * 2} photos, ${(bytes / 1e6).toFixed(1)} MB (free-exercise-db @ ${FORM_PHOTO_COMMIT_SHORT})`);
      if (!ids.length && process.env.SKIP_EXERCISE_IMAGES !== '1') console.warn('[exercise-img] WARNING: no exercise form photos in .cache/exercise-img — run `npm run vendor:exercise-images`; the app shows steps only');
    },
  };
}

/** Emit Netlify-style _headers with a CSP whose connect-src names only this app, its Supabase project and Open Food Facts. */
function securityHeaders(mode: string): Plugin {
  return {
    name: 'rozana-headers',
    apply: 'build',
    generateBundle() {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
      const supa = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ? ` ${url}` : '';
      const template = readFileSync(fileURLToPath(new URL('./deploy/_headers.template', import.meta.url)), 'utf8');
      // Open Food Facts: barcode lookups only (the barcode number is all that is sent).
      const out = template.replaceAll('connect-src __CONNECT_SRC__;', `connect-src 'self'${supa} https://world.openfoodfacts.org;`);
      if (out.includes('__CONNECT_SRC__') || !out.includes('connect-src')) this.error('CSP template placeholder was not replaced');
      this.emitFile({ type: 'asset', fileName: '_headers', source: out });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), serviceWorker(), securityHeaders(mode), exerciseImages()],
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
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'scripts/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
}));
