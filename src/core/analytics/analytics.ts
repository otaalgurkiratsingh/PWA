/**
 * First-party usage analytics for the friends beta (T9). No third-party SDK, no ad IDs.
 * Events are queued on this phone and, for signed-in members who leave "Share usage stats" on,
 * sent to the owner's own Supabase project through `log_events` (insert-only). The demo never sends.
 *
 * What an event can carry: its name, small props (input method, dish id, counts) and, only for a
 * search with no result or a food request, the text that was searched. Never journal contents.
 */
import { supabase } from '@/core/auth/supabase';
import { localDateIn } from '@/core/time/localDate';

export type EventName =
  | 'app_open' | 'food_logged' | 'dish_searched' | 'dish_searched_no_result' | 'recipe_created' | 'combo_logged' | 'food_requested'
  | 'template_created' | 'quick_add' | 'voice_used' | 'barcode_scanned' | 'workout_finished'
  | 'insight_opened' | 'story_shared' | 'milestone_shown' | 'year_recap_opened'
  | 'circle_created' | 'circle_joined' | 'circle_post' | 'invite_sent' | 'invite_code_redeemed' | 'referral_activated' | 'invite_prompt_shown'
  | 'notification_opened' | 'notification_dismissed';

/** How a food log was made. Everything except typed search and quick-add counts as zero typing. */
export type InputMethod =
  | 'usual' | 'suggestion' | 'nudge' | 'template' | 'restaurant' | 'combo' | 'voice' | 'barcode' | 'repeat' | 'closest_match'
  | 'browse' | 'search' | 'quick_add' | 'recipe' | 'notification';
const TYPED: ReadonlySet<InputMethod> = new Set(['search', 'quick_add']);
export const isZeroTyping = (m: InputMethod) => !TYPED.has(m);

interface Queued { event: EventName; props: Record<string, unknown>; client_ts: string; local_date: string }

let cfg: { ownerId: string; mode: 'account' | 'demo'; timezone: string } | null = null;
let timer: number | null = null;
const MAX_QUEUE = 500;

const qKey = () => `trainluma.events.${cfg?.ownerId ?? 'anon'}`;
const optKey = (owner: string) => `trainluma.shareUsage.${owner}`;

function read(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(qKey()) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}
function write(q: Queued[]) {
  try {
    localStorage.setItem(qKey(), JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    // storage full or blocked: analytics are best-effort and never block the app
  }
}

export function shareUsageEnabled(owner: string): boolean {
  try {
    return localStorage.getItem(optKey(owner)) !== 'off';
  } catch {
    return true;
  }
}
export function setShareUsage(owner: string, on: boolean) {
  try {
    localStorage.setItem(optKey(owner), on ? 'on' : 'off');
    if (!on) localStorage.removeItem(`trainluma.events.${owner}`);
  } catch {
    // ignore
  }
}

export function configureAnalytics(c: { ownerId: string; mode: 'account' | 'demo'; timezone: string }) {
  cfg = c;
  // One app_open per local day (D1/D7/D30 retention).
  const day = localDateIn(c.timezone);
  try {
    const k = `trainluma.lastOpen.${c.ownerId}`;
    if (localStorage.getItem(k) !== day) {
      localStorage.setItem(k, day);
      track('app_open', {});
    }
  } catch {
    // ignore
  }
}

/** Record an event (fire-and-forget). */
export function track(event: EventName, props: Record<string, unknown> = {}) {
  if (!cfg || !shareUsageEnabled(cfg.ownerId)) return;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  }
  write([...read(), { event, props: clean, client_ts: new Date().toISOString(), local_date: localDateIn(cfg.timezone) }]);
  if (cfg.mode === 'account' && timer === null && typeof window !== 'undefined') {
    timer = window.setTimeout(() => { timer = null; void flush(); }, 4000);
  }
}

/** Log a food entry with how it was made (feeds "% of logs with zero typing"). */
export function trackFoodLogged(method: InputMethod, props: Record<string, unknown> = {}) {
  track('food_logged', { method, zero_typing: isZeroTyping(method), ...props });
}

export async function flush(): Promise<void> {
  if (!cfg || cfg.mode !== 'account' || !shareUsageEnabled(cfg.ownerId)) return;
  const q = read();
  if (!q.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const batch = q.slice(0, 100);
  try {
    const db = await supabase();
    const { error } = await db.rpc('log_events', { p_events: batch });
    if (error) return; // keep them; try again next time
    write(read().slice(batch.length));
  } catch {
    // offline or not configured: keep queued
  }
}

/** Events still on this phone (for the Settings disclosure and tests). */
export function queuedEvents(): readonly Queued[] {
  return read();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
}
