/**
 * Exercise form photos: the start and end photos from free-exercise-db (public domain, Unlicense),
 * vendored at build time into /exercise-img/{source_id}/{0,1}.jpg. The app never loads them from
 * GitHub at runtime. Shared by the vendoring script, the Vite plugin, the service worker test and
 * the How-to sheet so the commit, paths and limits are written down once.
 */

/** free-exercise-db commit the photos (and the exercise text) come from. */
export const FORM_PHOTO_COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
export const FORM_PHOTO_COMMIT_SHORT = FORM_PHOTO_COMMIT.slice(0, 7);
/** Same-origin folder the photos are served from. */
export const FORM_PHOTO_BASE = '/exercise-img';
export const FORM_PHOTO_MANIFEST = `${FORM_PHOTO_BASE}/manifest.json`;
/** Service worker cache for viewed photos; not tied to the build id so it survives app updates. */
export const FORM_PHOTO_CACHE = 'trainluma-exercise-img-v1';
export const FORM_PHOTO_CACHE_MAX = 200;
/** free-exercise-db ids are folder names like "Barbell_Bench_Press_-_Medium_Grip". */
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export const isSafePhotoId = (id: unknown): id is string => typeof id === 'string' && SAFE_ID.test(id);

/** Where the build downloads a frame from (pinned commit, never used at runtime). */
export function sourcePhotoUrl(id: string, frame: 0 | 1): string {
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FORM_PHOTO_COMMIT}/exercises/${encodeURIComponent(id)}/${frame}.jpg`;
}

/** Same-origin start and end photo paths. */
export function photoPaths(id: string): [start: string, end: string] {
  return [`${FORM_PHOTO_BASE}/${id}/0.jpg`, `${FORM_PHOTO_BASE}/${id}/1.jpg`];
}

/** Every free-exercise-db id the exercise library points at (built-in extras and the big list), deduplicated. */
export function libraryPhotoIds(raw: unknown): string[] {
  const f = raw as { builtin_extras?: Record<string, { source_id?: unknown }>; exercises?: { source_id?: unknown }[] };
  const ids = [...Object.values(f.builtin_extras ?? {}), ...(f.exercises ?? [])].map((x) => x.source_id).filter(isSafePhotoId);
  return [...new Set(ids)].sort();
}

export interface PhotoManifest { commit: string; ids: string[] }

/** The ids the build actually vendored, or null when the manifest is missing or malformed. */
export function parsePhotoManifest(raw: unknown): Set<string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<PhotoManifest>;
  if (typeof m.commit !== 'string' || !Array.isArray(m.ids)) return null;
  return new Set(m.ids.filter(isSafePhotoId));
}

/**
 * 'available': the build vendored both photos. 'none': no photo demo (TrainLuma-written or custom
 * exercise, or the build had no photo for it). 'unknown': no manifest could be read (e.g. offline
 * before it was ever cached) — try the photos; a failed load hides the demo and keeps the steps.
 */
export type PhotoAvailability = 'available' | 'none' | 'unknown';

export function photoAvailability(sourceId: string | null | undefined, manifest: ReadonlySet<string> | null): PhotoAvailability {
  if (!isSafePhotoId(sourceId)) return 'none';
  if (!manifest) return 'unknown';
  return manifest.has(sourceId) ? 'available' : 'none';
}
