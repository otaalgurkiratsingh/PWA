/**
 * Phone notifications (Web Push). The device subscribes with the project's PUBLIC VAPID key; the
 * subscription (endpoint + device public keys) is saved to the person's own row in Supabase, and
 * the `notify` function sends end-to-end encrypted reminders. Preferences live in
 * `notification_prefs` (RLS: owner only). In the demo, preferences stay on this phone.
 */
import { supabase } from '@/core/auth/supabase';
import type { NotificationPrefs } from './schedule';

const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? '';

export type PushSupport = 'supported' | 'needs_install' | 'unsupported';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    // iPhone/iPad Safari only offers notifications to apps added to the Home Screen.
    return isIos() && !isStandalone() ? 'needs_install' : 'unsupported';
  }
  if (!('PushManager' in window)) return isIos() && !isStandalone() ? 'needs_install' : 'unsupported';
  return 'supported';
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** This browser can show a notification right now (enough for the test, even without push). */
export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

/** True when this build can send phone notifications (the owner added the public VAPID key). */
export const pushConfigured = () => /^[A-Za-z0-9_-]{80,100}$/.test(VAPID);

export function permission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Notifications need the installed app. Open TrainLuma from your Home Screen and try again.')), 5000)),
  ]);
  return reg;
}

/** Ask permission (must follow a tap). */
export async function askPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) throw new Error('This browser doesn’t support notifications.');
  return Notification.requestPermission();
}

/** Subscribe this device and save it to the person's account. */
export async function enableDevice(): Promise<void> {
  if (!pushConfigured()) throw new Error('Phone notifications are still being set up by the owner.');
  if ((await askPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them for TrainLuma in your phone’s settings.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }));
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('This browser returned an incomplete subscription.');
  const db = await supabase();
  const { error } = await db.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw new Error('Couldn’t save this phone for reminders. Check your connection and try again.');
}

/** Stop notifications on this device (and forget it on the server). */
export async function disableDevice(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    const db = await supabase();
    await db.rpc('delete_push_subscription', { p_endpoint: endpoint });
  } catch {
    // The server drops it on the next send anyway (the push service answers 410).
  }
}

export async function deviceSubscribed(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/** A notification right now on this phone, to check it works. Nothing leaves the phone. */
export async function testNotification(prefs: NotificationPrefs): Promise<void> {
  if ((await askPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them for TrainLuma in your phone’s settings.');
  const title = prefs.hide_details ? 'TrainLuma' : 'You’re all set';
  const opts: NotificationOptions = {
    body: prefs.hide_details ? 'Reminders are on.' : 'This is how your reminders will look.',
    icon: '/icons/icon-192.png?v=tl1',
    badge: '/icons/icon-192.png?v=tl1',
    tag: 'trainluma-test',
    data: { url: '/#/today' },
  };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.showNotification(title, opts);
  else new Notification(title, opts);
}

// ---------- preferences ----------

const localKey = (owner: string) => `trainluma.notifyPrefs.${owner}`;

export async function loadPrefs(mode: 'account' | 'demo', owner: string): Promise<Partial<NotificationPrefs> | null> {
  if (mode === 'demo') {
    try {
      const raw = localStorage.getItem(localKey(owner));
      return raw ? (JSON.parse(raw) as Partial<NotificationPrefs>) : null;
    } catch {
      return null;
    }
  }
  const db = await supabase();
  const { data, error } = await db.from('notification_prefs').select('*').maybeSingle();
  if (error) throw new Error('Couldn’t load your reminder settings.');
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const hhmm = (v: unknown) => String(v ?? '').slice(0, 5);
  return {
    motivation_enabled: d.motivation_enabled === true, motivation_time: hhmm(d.motivation_time),
    gym_enabled: d.gym_enabled === true, gym_days: Array.isArray(d.gym_days) ? (d.gym_days as number[]) : [], gym_time: hhmm(d.gym_time),
    lead_minutes: Number(d.lead_minutes) || 15, hide_details: d.hide_details === true, timezone: String(d.timezone ?? ''),
  };
}

export async function savePrefs(mode: 'account' | 'demo', owner: string, p: NotificationPrefs): Promise<void> {
  if (mode === 'demo') {
    try {
      localStorage.setItem(localKey(owner), JSON.stringify(p));
    } catch {
      // private mode: settings last for this visit only
    }
    return;
  }
  const db = await supabase();
  const { error } = await db.from('notification_prefs').upsert({ user_id: owner, ...p }, { onConflict: 'user_id' });
  if (error) throw new Error('Couldn’t save your reminder settings. Check your connection and try again.');
}
