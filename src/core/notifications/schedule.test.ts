import { describe, expect, it } from 'vitest';
import { defaultPrefs, describeWhen, inQuietHours, minusMinutes, nextReminders, zonedInstant } from './schedule';

const tz = 'America/Toronto';

describe('reminder schedule', () => {
  it('defaults: the three kinds on, gym time learned, retired daily motivation off', () => {
    const p = defaultPrefs(tz, [5, 1, 3]);
    expect(p).toMatchObject({ routine_enabled: true, insight_enabled: true, gym_enabled: true, gym_mode: 'learned', motivation_enabled: false, gym_time: '18:00', lead_minutes: 15, gym_days: [1, 3, 5] });
  });

  it('converts local wall time to the right instant, including across a DST change', () => {
    expect(zonedInstant(tz, 2026, 10, 12, 8, 0).toISOString()).toBe('2026-10-12T12:00:00.000Z'); // EDT
    expect(zonedInstant(tz, 2026, 11, 2, 8, 0).toISOString()).toBe('2026-11-02T13:00:00.000Z'); // EST
    expect(zonedInstant('Asia/Kolkata', 2026, 10, 12, 7, 30).toISOString()).toBe('2026-10-12T02:00:00.000Z');
  });

  it('next gym reminder is lead minutes before gym time on a chosen day', () => {
    const p = { ...defaultPrefs(tz, [1, 3]), gym_mode: 'fixed' as const };
    // Monday 2026-10-12 10:00 local → today 17:45 local
    const [next] = nextReminders(p, new Date('2026-10-12T14:00:00Z'));
    expect(next).toEqual({ kind: 'gym', at: new Date('2026-10-12T21:45:00Z') });
    // Monday 17:50 local → Wednesday 17:45
    expect(nextReminders(p, new Date('2026-10-12T21:50:00Z'))[0]!.at.toISOString()).toBe('2026-10-14T21:45:00.000Z');
  });

  it('only a fixed gym time can be shown ahead; learned, off and quiet-hour times are not', () => {
    const fixed = { ...defaultPrefs(tz, [1]), gym_mode: 'fixed' as const };
    const now = new Date('2026-10-12T13:00:00Z');
    expect(nextReminders(defaultPrefs(tz, [1]), now)).toEqual([]); // learned
    expect(nextReminders({ ...fixed, gym_enabled: false }, now)).toEqual([]);
    expect(nextReminders({ ...fixed, gym_days: [] }, now)).toEqual([]);
    expect(nextReminders({ ...fixed, gym_time: '06:30' }, now)).toEqual([]); // 06:15 is quiet hours
    expect(inQuietHours('22:00')).toBe(true);
    expect(inQuietHours('06:59')).toBe(true);
    expect(inQuietHours('07:00')).toBe(false);
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
