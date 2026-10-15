// @vitest-environment node
/**
 * Runs the real service worker source against a small in-memory Cache API to check the exercise
 * photo cache: cache-on-view, the 200-photo cap (oldest first), offline reads, surviving an app
 * update, and never touching API or third-party requests.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FORM_PHOTO_CACHE, FORM_PHOTO_CACHE_MAX } from '@shared/catalogue/exerciseImages';

const ORIGIN = 'https://app.example';
type Res = { ok: boolean; status: number; type: string; body: string; clone: () => Res };
const res = (body: string, status = 200): Res => ({ ok: status < 400, status, type: 'basic', body, clone() { return res(body, status); } });

class FakeCache {
  entries = new Map<string, Res>(); // Map keeps insertion order, like the Cache API
  key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  async match(r: string | { url: string }) { return this.entries.get(this.key(r)); }
  async put(r: string | { url: string }, v: Res) { const k = this.key(r); this.entries.delete(k); this.entries.set(k, v); }
  async delete(r: string | { url: string }) { return this.entries.delete(this.key(r)); }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async addAll() { /* precache not under test */ }
}

function boot(buildId = 'b1', stores = new Map<string, FakeCache>()) {
  const listeners: Record<string, (e: unknown) => void> = {};
  let online = true;
  const fetched: string[] = [];
  const caches = {
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n)!; },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: string) => { for (const c of stores.values()) { const hit = await c.match(r); if (hit) return hit; } return undefined; },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    clients: { claim: async () => undefined },
  };
  const src = readFileSync(new URL('../../src/sw/sw.js', import.meta.url), 'utf8')
    .replace("const BUILD_ID = '__BUILD_ID__';", `const BUILD_ID = '${buildId}';`)
    .replace('const PRECACHE = __PRECACHE__;', 'const PRECACHE = ["/", "/index.html"];');
  runInNewContext(src, {
    self, caches, URL, Response: { error: () => res('', 599) }, indexedDB: {},
    fetch: async (r: { url: string }) => { if (!online) throw new TypeError('offline'); fetched.push(r.url); return res(`net:${r.url}`); },
  });
  const request = async (path: string, init: { method?: string; mode?: string } = {}) => {
    let responded: Promise<Res> | null = null;
    const url = path.startsWith('http') ? path : `${ORIGIN}${path}`;
    listeners.fetch!({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' }, respondWith: (p: Promise<Res>) => { responded = p; } });
    return responded as Promise<Res> | null;
  };
  const activate = async () => { let p: Promise<unknown> = Promise.resolve(); listeners.activate!({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  return { stores, request, activate, fetched, setOnline: (v: boolean) => { online = v; } };
}

describe('service worker: exercise form photos', () => {
  it('caches a viewed photo and serves it offline', async () => {
    const sw = boot();
    expect((await (await sw.request('/exercise-img/Band_Pull_Apart/0.jpg'))!).body).toContain('/exercise-img/Band_Pull_Apart/0.jpg');
    sw.setOnline(false);
    expect((await (await sw.request('/exercise-img/Band_Pull_Apart/0.jpg'))!).body).toContain('net:');
    expect([...sw.stores.get(FORM_PHOTO_CACHE)!.entries.keys()]).toEqual([`${ORIGIN}/exercise-img/Band_Pull_Apart/0.jpg`]);
  });

  it('keeps at most 200 photos, dropping the oldest first; the manifest is never dropped', async () => {
    const sw = boot();
    await sw.request('/exercise-img/manifest.json');
    for (let i = 0; i < FORM_PHOTO_CACHE_MAX + 5; i++) await sw.request(`/exercise-img/Ex_${i}/0.jpg`);
    const keys = [...sw.stores.get(FORM_PHOTO_CACHE)!.entries.keys()];
    const photos = keys.filter((k) => k.endsWith('.jpg'));
    expect(photos.length).toBe(FORM_PHOTO_CACHE_MAX);
    expect(photos[0]).toBe(`${ORIGIN}/exercise-img/Ex_5/0.jpg`);
    expect(keys).toContain(`${ORIGIN}/exercise-img/manifest.json`);
  });

  it('manifest: network first, cached copy when offline', async () => {
    const sw = boot();
    await sw.request('/exercise-img/manifest.json');
    await sw.request('/exercise-img/manifest.json');
    expect(sw.fetched.filter((u) => u.endsWith('manifest.json')).length).toBe(2);
    sw.setOnline(false);
    expect((await (await sw.request('/exercise-img/manifest.json'))!).body).toContain('manifest.json');
  });

  it('the photo cache survives an app update (old shell caches are removed, photos kept)', async () => {
    const first = boot('old');
    await first.request('/exercise-img/A/0.jpg');
    first.stores.set('rozana-shell-old', new FakeCache());
    const next = boot('new', first.stores);
    await next.activate();
    expect([...next.stores.keys()]).not.toContain('rozana-shell-old');
    expect(next.stores.get(FORM_PHOTO_CACHE)!.entries.size).toBe(1);
  });

  it('never handles API, third-party or non-GET requests', async () => {
    const sw = boot();
    expect(await sw.request('/rest/v1/meals')).toBeNull();
    expect(await sw.request('https://raw.githubusercontent.com/yuhonas/free-exercise-db/x/exercises/A/0.jpg')).toBeNull();
    expect(await sw.request('/exercise-img/A/0.jpg', { method: 'POST' })).toBeNull();
    expect(sw.stores.get(FORM_PHOTO_CACHE)).toBeUndefined();
  });
});
