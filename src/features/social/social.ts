/**
 * Private friend circles (T21) and "Give a month, get a month" referrals (T22) — the account side.
 * Everything goes through the growth RPCs (security definer, members only). Circles only ever show
 * counts of active days and the short celebration posts people chose to share; never what anyone
 * ate or lifted. The demo shows a made-up sample and never calls the server.
 */
import type { CoachAvatarId } from '@shared/contracts';
import { supabase } from '@/core/auth/supabase';

export const CIRCLE_MIN_BOARD = 3;
export const CIRCLE_MAX = 6;

export interface CircleMember { user_id: string; display_name: string; avatar: CoachAvatarId; share_prs: boolean }
export interface Circle { id: string; name: string; join_code: string; members: CircleMember[] }
export interface BoardRow { user_id: string; display_name: string; avatar: CoachAvatarId; active_days_7: number; is_me: boolean }
export interface CirclePost { id: string; circle_id: string; user_id: string; kind: 'pr' | 'milestone' | 'streak'; text: string; created_at: string }

/** Friendly words for server errors; never the raw message. */
export function circleError(e: unknown): string {
  const m = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? '');
  if (/not_found/.test(m)) return 'We couldn’t find a circle with that code. Check it with your friend and try again.';
  if (/circle_full|6 members/.test(m)) return 'That circle is already full (6 friends). Maybe start your own?';
  if (/circle_limit|5 circles/.test(m)) return 'You’re in 5 circles already, which is the most. Leave one to join another.';
  if (/post_limit/.test(m)) return 'That’s plenty of celebrating for today 🎉 Share more tomorrow.';
  return 'Something went wrong. Check your connection and try again.';
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const db = await supabase();
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message || fn);
  return data as T;
}

export async function myCircles(): Promise<Circle[]> {
  const db = await supabase();
  const [c, m] = await Promise.all([
    db.from('circles').select('id,name,join_code').order('created_at'),
    db.from('circle_members').select('circle_id,user_id,display_name,avatar,share_prs'),
  ]);
  if (c.error || m.error) throw new Error('Couldn’t load your circles.');
  const members = (m.data ?? []) as (CircleMember & { circle_id: string })[];
  return ((c.data ?? []) as Omit<Circle, 'members'>[]).map((x) => ({ ...x, members: members.filter((p) => p.circle_id === x.id) }));
}

export const createCircle = (name: string, displayName: string, avatar: CoachAvatarId) =>
  rpc<{ id: string; join_code: string }>('create_circle', { p_name: name, p_display_name: displayName, p_avatar: avatar });
export const joinCircle = (code: string, displayName: string, avatar: CoachAvatarId) =>
  rpc<string>('join_circle', { p_code: code, p_display_name: displayName, p_avatar: avatar });
export const leaveCircle = (id: string) => rpc<null>('leave_circle', { p_circle: id });
export const circleBoard = (id: string, today: string) => rpc<BoardRow[]>('circle_board', { p_circle: id, p_today: today });
export const postToCircle = (id: string, kind: CirclePost['kind'], text: string) => rpc<string>('post_to_circle', { p_circle: id, p_kind: kind, p_text: text.slice(0, 140) });
export const setCircleSharing = (id: string, on: boolean) => rpc<null>('set_circle_sharing', { p_circle: id, p_share_prs: on });

export async function circlePosts(id: string): Promise<CirclePost[]> {
  const db = await supabase();
  const { data, error } = await db.from('circle_posts').select('id,circle_id,user_id,kind,text,created_at').eq('circle_id', id).order('created_at', { ascending: false }).limit(30);
  if (error) throw new Error('Couldn’t load posts.');
  return (data ?? []) as CirclePost[];
}

export async function deletePost(id: string): Promise<void> {
  const db = await supabase();
  const { error } = await db.from('circle_posts').delete().eq('id', id);
  if (error) throw new Error('Couldn’t remove that post.');
}

/**
 * The kind leaderboard: never a ranking, never a last place. Whoever was active on the most days
 * (at least 1) is celebrated as "most consistent"; everyone else is listed alphabetically with
 * their own week, so no one is shown at the bottom. Needs 3+ members, so it's never 1-vs-1.
 */
export function kindBoard(rows: readonly BoardRow[]): { ready: boolean; top: BoardRow[]; others: BoardRow[] } {
  if (rows.length < CIRCLE_MIN_BOARD) return { ready: false, top: [], others: [...rows].sort(byName) };
  const best = Math.max(...rows.map((r) => r.active_days_7));
  const top = best > 0 ? rows.filter((r) => r.active_days_7 === best).sort(byName) : [];
  return { ready: true, top, others: rows.filter((r) => !top.includes(r)).sort(byName) };
}
const byName = (a: { display_name: string }, b: { display_name: string }) => a.display_name.localeCompare(b.display_name);

/** A demo circle (made-up people) so the screen can be tried without an account. */
export const DEMO_CIRCLE: Circle & { board: BoardRow[]; posts: CirclePost[] } = {
  id: 'demo-circle', name: 'Morning crew', join_code: 'DEMO42',
  members: [],
  board: [
    { user_id: 'me', display_name: 'You', avatar: 'orb', active_days_7: 5, is_me: true },
    { user_id: 'a', display_name: 'Aman', avatar: 'sher', active_days_7: 6, is_me: false },
    { user_id: 'b', display_name: 'Simran', avatar: 'bloom', active_days_7: 4, is_me: false },
    { user_id: 'c', display_name: 'Jas', avatar: 'panda', active_days_7: 2, is_me: false },
  ],
  posts: [
    { id: 'p1', circle_id: 'demo-circle', user_id: 'a', kind: 'pr', text: 'New best: Back squat 85 kg 🎉', created_at: '2026-10-11T18:20:00Z' },
    { id: 'p2', circle_id: 'demo-circle', user_id: 'b', kind: 'milestone', text: '30 days in a row 🔥', created_at: '2026-10-10T07:05:00Z' },
  ],
};

// ---------- referral ----------

export interface ReferralSummary { code: string; redeemed: number; activated: number; months_banked: number; months_pending: number }
export type RedeemStatus = 'ok' | 'invalid_code' | 'self_referral' | 'already_redeemed' | 'device_used';
export interface PlusSummary { queued: number; pending: number; released: number }

/** Two letters for the code prefix from a nickname ("Gurkirat Singh" → "GS"; fallback "TL"). */
export function codePrefix(nickname: string): string {
  const letters = nickname.normalize('NFKD').replace(/[^A-Za-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const p = letters.length >= 2 ? letters[0]![0]! + letters[1]![0]! : (letters[0] ?? '').slice(0, 2);
  return /^[A-Za-z]{2}$/.test(p) ? p.toUpperCase() : 'TL';
}

export const myReferral = (prefix: string) => rpc<ReferralSummary>('my_referral', { p_prefix: prefix });
export const redeemReferral = async (code: string) => (await rpc<{ status: RedeemStatus }>('redeem_referral', { p_code: code, p_device_hash: await deviceHash() })).status;
export const myPlus = () => rpc<PlusSummary>('my_plus');
export const checkActivation = () => rpc<{ logged_days: number; activated: boolean }>('referral_check_activation');

export const REDEEM_COPY: Record<RedeemStatus, string> = {
  ok: 'You’re in! Your friend gave you Plus free for your first 2 months 💙 (the 30-day trial plus a bonus month, saved for you). They get a month too once you’ve logged 7 days.',
  invalid_code: 'That code doesn’t match anyone yet. Check it with your friend; it looks like AB-1234.',
  self_referral: 'That’s your own code 🙂 Share it with a friend instead.',
  already_redeemed: 'You’ve already used a friend’s code. One per person, and it’s saved.',
  device_used: 'A code was already used on this phone. One per device keeps it fair for everyone.',
};

/** Normalise "ab 1234" / "AB1234" → "AB-1234"; null when it can't be a code. */
export function cleanCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}\d{4}$/.test(s) ? `${s.slice(0, 2)}-${s.slice(2)}` : null;
}

/** The pre-written invite. Always shown editable; nothing is sent until the person taps Share. */
export function inviteMessage(code: string, origin = typeof location === 'undefined' ? 'https://trainluma.app' : location.origin): string {
  return `I’m using TrainLuma to track my food and training — here’s a free month of Plus if you want in. My code: ${code} ${origin}/#/invite/${code}`;
}

export function circleInviteMessage(name: string, code: string, origin = typeof location === 'undefined' ? 'https://trainluma.app' : location.origin): string {
  return `Join my TrainLuma circle “${name}” so we can cheer each other on 💪 Code: ${code} (${origin}/#/circles/${code})`;
}

/**
 * One credit per device: a random id kept on this phone, sent only as its SHA-256. It's a fairness
 * check, not tracking (it never leaves except in a redemption and isn't linked to ads).
 */
export async function deviceHash(): Promise<string> {
  const key = 'trainluma.deviceId';
  let id: string;
  try {
    id = localStorage.getItem(key) ?? '';
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
  } catch {
    id = crypto.randomUUID();
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`trainluma-device:${id}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Share text via the system share sheet on a tap; falls back to copying. Never sends by itself. */
export async function shareText(text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard?.writeText(text);
  return 'copied';
}
