// TrainLuma notify Edge Function: daily motivation + pre-gym reminders over Web Push.
// Called every 5 minutes by pg_cron (see supabase/admin/notifications.sql). Wiring only —
// decisions live in ../_shared/notify.ts (unit-tested), encryption in ../_shared/webpush.ts.
//
// Secrets (set by the owner in the Supabase dashboard, never in the app or git):
//   NOTIFY_CRON_SECRET   long random string; the cron job sends it as a Bearer token
//   VAPID_PUBLIC_KEY     from `npx web-push generate-vapid-keys` (also VITE_VAPID_PUBLIC_KEY in Netlify)
//   VAPID_PRIVATE_KEY    the matching private key (only here)
//   VAPID_SUBJECT        mailto:you@example.com — how push services can contact the sender
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS.
import { createClient } from '@supabase/supabase-js';
import { handleNotifyRequest, type DueRow, type NotifyContext, type NotifyDeps, type PushTarget } from '../_shared/notify.ts';
import { sendPush } from '../_shared/webpush.ts';

function env(name: string): string | null {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : null;
}

function secretKey(): string | null {
  const raw = env('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // fall through to the legacy variable
    }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

const SUPABASE_URL = env('SUPABASE_URL');
const SECRET = secretKey();
const vapid = { publicKey: env('VAPID_PUBLIC_KEY') ?? '', privateKey: env('VAPID_PRIVATE_KEY') ?? '', subject: env('VAPID_SUBJECT') ?? '' };
const configured = !!(SUPABASE_URL && SECRET && vapid.publicKey && vapid.privateKey && /^(mailto:|https:)/.test(vapid.subject));
// Test harness only: a loopback push endpoint (never set in production).
const testHosts = (env('NOTIFY_TEST_PUSH_HOSTS') ?? '').split(',').map((s) => s.trim()).filter((h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h));

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

function deps(): NotifyDeps | null {
  if (!configured) return null;
  const db = createClient(SUPABASE_URL!, SECRET!, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    now: () => new Date(),
    due: async (now) => check<DueRow[]>(await db.rpc('notify_due', { p_now: now.toISOString() })) ?? [],
    claim: async (u, k, d) => check<boolean>(await db.rpc('notify_claim', { p_user: u, p_kind: k, p_date: d })) === true,
    context: async (u, d) => check<NotifyContext>(await db.rpc('notify_context', { p_user: u, p_today: d })),
    targets: async (u) => check<PushTarget[]>(await db.rpc('notify_subscriptions', { p_user: u })) ?? [],
    send: (t, payload) => sendPush({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth_secret } }, payload, vapid, {
      ttl: 60 * 60, urgency: 'normal', topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32), allowHosts: testHosts,
    }),
    result: async (endpoint, gone) => void check(await db.rpc('notify_result', { p_endpoint: endpoint, p_gone: gone })),
    // Logs carry the kind and error name only — never names, message text or endpoints.
    log: (event, data) => console.log(JSON.stringify({ event, ...data })),
  };
}

Deno.serve((req) => handleNotifyRequest(req, env('NOTIFY_CRON_SECRET'), deps()));
