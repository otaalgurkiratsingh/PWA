// Downloads the free-exercise-db form photos (start + end JPG per exercise) into an on-disk cache
// outside dist, so the Vite build can copy them into dist/exercise-img/. Usage:
//   node scripts/vendor-exercise-images.mts        (run by `npm run build`)
//   SKIP_EXERCISE_IMAGES=1 npm run build           (skip: the app shows steps without photos)
// - Pinned to one commit (FORM_PHOTO_COMMIT); files already in the cache are never fetched again.
// - Never fails the build: when offline or blocked it logs a warning and the app falls back to steps.
// - Files are written to a temp name and renamed, so a parallel build never copies half a photo.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORM_PHOTO_COMMIT, FORM_PHOTO_COMMIT_SHORT, libraryPhotoIds, sourcePhotoUrl } from '../shared/catalogue/exerciseImages.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = join(root, '.cache', 'exercise-img', FORM_PHOTO_COMMIT.slice(0, 12));
const CONCURRENCY = 16;
const TIMEOUT_MS = 20_000;

if (process.env.SKIP_EXERCISE_IMAGES === '1') {
  console.log('[exercise-img] SKIP_EXERCISE_IMAGES=1 — not downloading form photos (the app shows steps only).');
  process.exit(0);
}

const ids = libraryPhotoIds(JSON.parse(readFileSync(join(root, 'shared/data/exercise-library-v1.json'), 'utf8')));
const missingFile = join(CACHE_DIR, 'missing.json');
mkdirSync(CACHE_DIR, { recursive: true });
let missing = new Set<string>();
try { missing = new Set(JSON.parse(readFileSync(missingFile, 'utf8')) as string[]); } catch { /* first run */ }

const has = (p: string) => { try { return statSync(p).size > 0; } catch { return false; } };
const todo = ids.flatMap((id) => ([0, 1] as const).map((frame) => ({ id, frame, file: join(CACHE_DIR, id, `${frame}.jpg`) })))
  .filter((t) => !has(t.file) && !missing.has(`${t.id}/${t.frame}`));

let ok = 0;
let failed = 0;
let gone = 0;
let streak = 0; // consecutive network failures: a long streak means offline/blocked, so stop early
let aborted = false;
const started = Date.now();

async function fetchOne(t: (typeof todo)[number]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(sourcePhotoUrl(t.id, t.frame), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404) { missing.add(`${t.id}/${t.frame}`); gone++; streak = 0; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
      mkdirSync(dirname(t.file), { recursive: true });
      const tmp = `${t.file}.tmp-${process.pid}`;
      writeFileSync(tmp, buf);
      renameSync(tmp, t.file);
      ok++;
      streak = 0;
      return;
    } catch (e) {
      if (attempt === 2) {
        failed++;
        streak++;
        if (failed <= 3) console.warn(`[exercise-img] ${t.id}/${t.frame}.jpg: ${(e as Error).message}`);
      }
    }
  }
}

if (todo.length) {
  console.log(`[exercise-img] downloading ${todo.length} form photos from free-exercise-db @ ${FORM_PHOTO_COMMIT_SHORT} (cache: .cache/exercise-img)…`);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length && !aborted) {
      const t = todo[next++]!;
      await fetchOne(t);
      if (streak >= 2 * CONCURRENCY) aborted = true;
    }
  }));
  writeFileSync(missingFile, JSON.stringify([...missing].sort(), null, 0));
}

const complete = ids.filter((id) => has(join(CACHE_DIR, id, '0.jpg')) && has(join(CACHE_DIR, id, '1.jpg')));
const bytes = complete.reduce((a, id) => a + statSync(join(CACHE_DIR, id, '0.jpg')).size + statSync(join(CACHE_DIR, id, '1.jpg')).size, 0);
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (aborted || failed) {
  console.warn(`[exercise-img] WARNING: ${failed} photo(s) could not be downloaded${aborted ? ' (looks offline or blocked — stopped early)' : ''}. The build continues; exercises without photos show their steps.`);
}
console.log(`[exercise-img] ${complete.length}/${ids.length} exercises have both photos (${(bytes / 1e6).toFixed(1)} MB cached; ${ok} downloaded, ${gone} not in the dataset, ${secs}s).`);
