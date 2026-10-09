import { describe, expect, it } from 'vitest';
import type { DailyHealthSummary, WeightEntry } from '@shared/contracts';
import { addDays, dateRange, healthSeries, weightSeries, weightTrend } from './metrics';

const base = { owner_id: 't', local_version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', deleted_at: null, synthetic: true };

describe('dates', () => {
  it('builds inclusive ranges across month boundaries', () => {
    expect(dateRange('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('missing data', () => {
  it('missing steps are null, not zero', () => {
    const rows: DailyHealthSummary[] = [
      { id: 'steps:2026-10-01', owner_id: 't', metric: 'steps', local_date: '2026-10-01', timezone: 'UTC', value: 0, source: 'manual', recorded_at: '2026-10-01T20:00:00Z', synthetic: true },
    ];
    const s = healthSeries(rows, 'steps', ['2026-10-01', '2026-10-02']);
    expect(s).toEqual([{ date: '2026-10-01', value: 0 }, { date: '2026-10-02', value: null }]);
  });

  it('weight trend refuses to guess from sparse data', () => {
    const dates = dateRange('2026-10-28', 28);
    const w = (d: string, v: number): WeightEntry => ({ ...base, id: crypto.randomUUID(), local_date: d, timezone: 'UTC', measured_at: `${d}T07:00:00Z`, value: v, unit: 'kg' });
    const sparse = weightTrend(weightSeries([w(dates[0]!, 80), w(dates[27]!, 79)], dates, 'kg'), 'kg');
    expect(sparse.change).toBeNull();
    expect(sparse.sparse).toBe(true);

    const dense = [0, 2, 4, 21, 23, 25].map((i, k) => w(dates[i]!, k < 3 ? 80 : 79));
    const t = weightTrend(weightSeries(dense, dates, 'kg'), 'kg');
    expect(t.change).toBe(-1);
    expect(t.message).toContain('down 1 kg');
  });

  it('converts weights to display unit', () => {
    const s = weightSeries([{ ...base, id: crypto.randomUUID(), local_date: '2026-10-01', timezone: 'UTC', measured_at: '2026-10-01T07:00:00Z', value: 176, unit: 'lb' }], ['2026-10-01'], 'kg');
    expect(s[0]!.value).toBeCloseTo(79.8, 1);
  });
});
