import { describe, expect, it } from 'vitest';
import { defaultPrefs, describeWhen, minusMinutes, nextReminders, zonedInstant } from './schedule';

const tz = 'America/Toronto';

describe('reminder schedule', () => {
  it('defaults: motivation 8:00, gym reminder 15 minutes before 18:00 on the person’s training days', () => {
    const p = defaultPrefs(tz, [5, 1, 3]);
    expect(p).toMatchObject({ motivation_time: '08:00', gym_time: '18:00', lead_minutes: 15, gym_days: [1, 3, 5] });
  });

  it('converts local wall time to the right instant, including across a DST change', () => {
    expect(zonedInstant(tz, 2026, 10, 12, 8, 0).toISOString()).toBe('2026-10-12T12:00:00.000Z'); // EDT
    expect(zonedInstant(tz, 2026, 11, 2, 8, 0).toISOString()).toBe('2026-11-02T13:00:00.000Z'); // EST
    expect(zonedInstant('Asia/Kolkata', 2026, 10, 12, 7, 30).toISOString()).toBe('2026-10-12T02:00:00.000Z');
  });

  it('next gym reminder is lead minutes before gym time on a chosen day', () => {
    const p = { ...defaultPrefs(tz, [1, 3]), motivation_enabled: false };
    // Monday 2026-10-12 10:00 local → today 17:45 local
    const [next] = nextReminders(p, new Date('2026-10-12T14:00:00Z'));
    expect(next).toEqual({ kind: 'gym', at: new Date('2026-10-12T21:45:00Z') });
    // Monday 17:50 local → Wednesday 17:45
    expect(nextReminders(p, new Date('2026-10-12T21:50:00Z'))[0]!.at.toISOString()).toBe('2026-10-14T21:45:00.000Z');
  });

  it('motivation rolls to tomorrow once today’s time passed; disabled kinds are skipped', () => {
    const p = { ...defaultPrefs(tz), gym_enabled: false };
    expect(nextReminders(p, new Date('2026-10-12T13:00:00Z'))).toEqual([{ kind: 'motivation', at: new Date('2026-10-13T12:00:00Z') }]);
    expect(nextReminders({ ...p, motivation_enabled: false }, new Date())).toEqual([]);
    expect(nextReminders({ ...defaultPrefs(tz), motivation_enabled: false, gym_days: [] }, new Date())).toEqual([]);
  });

  it('describes when in plain words', () => {
    const now = new Date('2026-10-12T14:00:00Z');
    expect(describeWhen(new Date('2026-10-12T21:45:00Z'), now, tz)).toBe('Today 5:45 PM');
    expect(describeWhen(new Date('2026-10-13T12:00:00Z'), now, tz)).toBe('Tomorrow 8:00 AM');
    expect(describeWhen(new Date('2026-10-14T21:45:00Z'), now, tz)).toBe('Wed 5:45 PM');
    expect(minusMinutes('18:00', 15)).toBe('17:45');
    expect(minusMinutes('00:05', 15)).toBe('23:50');
  });
});
