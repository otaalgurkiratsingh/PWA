/**
 * Service worker registration. The worker caches the app shell/static assets only.
 * New versions found while the app opens apply straight away; later ones wait until the user taps
 * Update. Never mid-workout.
 */
let waiting: ServiceWorker | null = null;
let readyAt = Infinity;
const startedAt = Date.now();
let userAskedForUpdate = false;
const listeners = new Set<() => void>();

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const check = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          waiting = reg.waiting;
          readyAt = Math.min(readyAt, Date.now());
          listeners.forEach((l) => l());
        }
      };
      check();
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', check);
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The first install also changes the controller (clients.claim). Only reload when the
        // person tapped Update — never in the middle of typing or a workout.
        if (userAskedForUpdate && !reloaded) {
          reloaded = true;
          location.reload();
        }
      });
    } catch {
      // Offline shell is an enhancement; the app still works online without it.
    }
  });
}

export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  if (waiting) fn();
  return () => listeners.delete(fn);
}

/**
 * True when the new version was found while the app was just opening (within 20 s of launch).
 * Then nothing is on screen yet that an update could interrupt, so it can apply on its own.
 */
export function updateFoundAtLaunch(): boolean {
  return readyAt - startedAt < 20_000;
}

export function applyUpdate() {
  userAskedForUpdate = true;
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}
