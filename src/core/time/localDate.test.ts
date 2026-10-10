import { describe, expect, it } from 'vitest';
import { dateParts } from './localDate';

describe('dateParts', () => {
  it('uses fixed three-letter month labels for every month', () => {
    const months = Array.from({ length: 12 }, (_, i) => dateParts(`2026-${String(i + 1).padStart(2, '0')}-01`).month);
    expect(months).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('reads the stored local date without UTC shifting (Sep 29 stays Sep 29)', () => {
    expect(dateParts('2026-09-29')).toEqual({ month: 'Sep', day: 29 });
    expect(dateParts('2026-01-01')).toEqual({ month: 'Jan', day: 1 });
    expect(dateParts('2026-12-31')).toEqual({ month: 'Dec', day: 31 });
  });

  it('rejects malformed dates instead of guessing', () => {
    expect(() => dateParts('2026-13-01')).toThrow();
    expect(() => dateParts('Sep 29')).toThrow();
  });
});
