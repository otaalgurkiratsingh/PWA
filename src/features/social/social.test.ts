import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '@shared/contracts';
import { sessionPRs } from '@/features/insights/recap';
import { prText } from './CircleWinShare';
import { shouldPrompt } from './InvitePrompt';
import { rememberInviteFromHash, pendingInvite, clearPendingInvite } from './referral';
import { cleanCode, codePrefix, deviceHash, inviteMessage, kindBoard, type BoardRow } from './social';

const row = (name: string, days: number, me = false): BoardRow => ({ user_id: name, display_name: name, avatar: 'orb', active_days_7: days, is_me: me });

describe('kind circle board', () => {
  it('needs 3 members; never shows a ranking or a last place', () => {
    expect(kindBoard([row('A', 5), row('B', 1)]).ready).toBe(false);
    const b = kindBoard([row('Zed', 2), row('Amy', 6), row('Bo', 0, true), row('Cy', 6)]);
    expect(b.ready).toBe(true);
    expect(b.top.map((r) => r.display_name)).toEqual(['Amy', 'Cy']);
    // Everyone else is alphabetical, so the person with 0 days isn't shown last for it.
    expect(b.others.map((r) => r.display_name)).toEqual(['Bo', 'Zed']);
  });
  it('a quiet week has no star rather than a fake winner', () => {
    expect(kindBoard([row('A', 0), row('B', 0), row('C', 0)]).top).toEqual([]);
  });
});

describe('referral codes', () => {
  it('prefix from the nickname, normalised codes, and an editable message with the link', () => {
    expect(codePrefix('Gurkirat Singh')).toBe('GS');
    expect(codePrefix('Priya')).toBe('PR');
    expect(codePrefix('7')).toBe('TL');
    expect(cleanCode(' gs 1234 ')).toBe('GS-1234');
    expect(cleanCode('GS-12345')).toBeNull();
    expect(inviteMessage('GS-1234', 'https://trainluma.app')).toContain('https://trainluma.app/#/invite/GS-1234');
  });
  it('device hash is a stable 64-char hex (never the raw id)', async () => {
    const a = await deviceHash();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(await deviceHash()).toBe(a);
    expect(a).not.toContain(localStorage.getItem('trainluma.deviceId') ?? 'x');
  });
  it('remembers a code from an invite link opened before sign-in', () => {
    clearPendingInvite();
    rememberInviteFromHash('#/invite/gs-1234');
    expect(pendingInvite()).toBe('GS-1234');
    rememberInviteFromHash('#/invite/not-a-code');
    expect(pendingInvite()).toBe('GS-1234');
    clearPendingInvite();
  });
});

describe('invite prompt', () => {
  const now = Date.UTC(2026, 9, 12);
  it('only at an earned moment, at most weekly, never after two “Not now”s', () => {
    expect(shouldPrompt({ lastShown: 0, dismissed: 0 }, 6, now)).toBe(false);
    expect(shouldPrompt({ lastShown: 0, dismissed: 0 }, 7, now)).toBe(true);
    expect(shouldPrompt({ lastShown: now - 3 * 86_400_000, dismissed: 0 }, 9, now)).toBe(false);
    expect(shouldPrompt({ lastShown: now - 8 * 86_400_000, dismissed: 1 }, 9, now)).toBe(true);
    expect(shouldPrompt({ lastShown: 0, dismissed: 2 }, 30, now)).toBe(false);
  });
});

describe('PR posts', () => {
  const session = (id: string, date: string, load: number): WorkoutSession => ({
    id, status: 'finished', local_date: date, started_at: `${date}T10:00:00Z`, deleted_at: null,
    exercises: [{ exercise_key: 'squat', name: 'Back squat', sets: [{ status: 'completed', actual: { load, unit: 'kg', reps: 5 } }] }],
  }) as unknown as WorkoutSession;
  it('finds bests beaten in this session only, and writes a short post', () => {
    const history = [session('a', '2026-10-01', 80), session('b', '2026-10-05', 82.5)];
    expect(sessionPRs(session('c', '2026-10-12', 85), history)).toEqual([{ name: 'Back squat', load: 85, unit: 'kg' }]);
    expect(sessionPRs(session('c', '2026-10-12', 82.5), history)).toEqual([]);
    expect(sessionPRs(session('first', '2026-10-12', 60), [])).toEqual([]); // first-ever isn't a best
    expect(prText([{ name: 'Back squat', load: 85, unit: 'kg' }])).toBe('New best: Back squat 85 kg 🎉');
  });
});

describe('milestone celebration', () => {
  it('shows once per milestone per person, and never without storage', async () => {
    const { claimMilestone } = await import('@/features/today/TodayScreen');
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(claimMilestone('trainluma.milestoneSeen.a.7', '2026-10-12', store)).toBe(true);
    expect(claimMilestone('trainluma.milestoneSeen.a.7', '2026-10-13', store)).toBe(false);
    expect(claimMilestone('trainluma.milestoneSeen.a.30', '2026-11-05', store)).toBe(true);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(claimMilestone('k', '2026-10-12', broken)).toBe(false);
  });
});
