import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StreakBadge } from './StreakBadge';
import { Ring, WeekCards } from './InsightsScreen';
import type { WeekRecap } from './recap';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const BANNED = /\b(miss|lost|lose|fail|lazy|skipped|worst|should have)\w*|last place/i;

describe('StreakBadge', () => {
  it('shows the run and a used freeze', () => {
    const t = text(renderToStaticMarkup(<StreakBadge current={12} frozen={1} broken={false} />));
    expect(t).toContain('12-day streak');
    expect(t).toContain('freeze used');
  });

  it('frames a broken streak kindly', () => {
    const t = text(renderToStaticMarkup(<StreakBadge current={0} frozen={0} broken />));
    expect(t).toContain('Life happens. Start a new one today 💪');
    expect(t).not.toMatch(BANNED);
  });
});

describe('WeekCards', () => {
  const base: WeekRecap = {
    weekStart: '2026-10-05', weekEnd: '2026-10-11', daysLogged: 4, daysElapsed: 6, consistencyPct: 67,
    workouts: 2, sets: 18, prs: [{ name: 'Back squat', load: 62.5, unit: 'kg' }],
    protein: { avgPerLoggedDay: 110, daysWithKnownProtein: 3, daysWithUnknownProtein: 1, trend: 'up', target: 120, daysAtTarget: 1 },
    surprise: null, earned: true,
  };

  it('labels a partial protein average and never shows unknown as 0', () => {
    const t = text(renderToStaticMarkup(<WeekCards recap={base} />));
    expect(t).toContain('Partial');
    expect(t).toContain('110 g / day average');
    expect(t).toContain('From 3 days with complete protein info');
    expect(t).toContain('62.5 kg');
    expect(t).not.toMatch(BANNED);
    const unknown = text(renderToStaticMarkup(<WeekCards recap={{ ...base, protein: { ...base.protein, avgPerLoggedDay: null, daysWithKnownProtein: 0, trend: null } }} />));
    expect(unknown).toContain('Protein isn’t known yet');
    expect(unknown).not.toMatch(/\b0 g\b/);
  });

  it('ring announces its value', () => {
    expect(renderToStaticMarkup(<Ring pct={67} />)).toContain('aria-label="67% consistency"');
  });
});
