import { describe, expect, it } from 'vitest';
import type { MealEntry, MealSlot, WorkoutSession } from '@shared/contracts';
import { shiftDate } from '../../../supabase/functions/_shared/retention';
import { COPY, loggedDates, weekLabel, weekRecap, yearRecap, type WeekRecap, type YearRecap } from './recap';
import { storyFilename, storyFromMilestone, storyFromWeek, storyFromYear, type StoryCard } from './story';

// Monday 2026-10-05 … Sunday 2026-10-11; "today" is the Saturday.
const MON = '2026-10-05';
const today = '2026-10-10';
let seq = 0;

function meal(date: string, protein: number | null, opts: { name?: string; slot?: MealSlot; complete?: boolean; deleted?: boolean } = {}): MealEntry {
  seq++;
  return {
    id: `m${String(seq).padStart(4, '0')}`,
    name: opts.name ?? 'Dal and roti',
    slot: opts.slot ?? 'lunch',
    local_date: date,
    logged_at: `${date}T12:00:00.000Z`,
    deleted_at: opts.deleted ? `${date}T13:00:00.000Z` : null,
    items: [{
      label: 'Dal', quantity: 1, unit_label: 'katori', grams: protein === null ? null : 180,
      nutrients: { energy_kcal: 300, protein_g: protein, carbs_g: 40, fat_g: 8, fiber_g: 6 },
      complete: { energy_kcal: true, protein_g: opts.complete ?? protein !== null, carbs_g: true, fat_g: true, fiber_g: true },
      source_kinds: ['usda_fdc'], source_ref: { kind: 'food', id: 'f1', revision: 1 }, estimated: false,
    }],
  } as unknown as MealEntry;
}

function session(date: string, lifts: { key?: string; name?: string; loads: number[]; unit?: string }[], status: 'finished' | 'active' = 'finished'): WorkoutSession {
  seq++;
  return {
    id: `s${String(seq).padStart(4, '0')}`,
    local_date: date, status, deleted_at: null,
    started_at: `${date}T18:00:00.000Z`,
    exercises: lifts.map((l) => ({
      exercise_key: l.key ?? 'back_squat', name: l.name ?? 'Back squat',
      sets: l.loads.map((load) => ({ status: 'completed', actual: { reps: 5, load, unit: l.unit ?? 'kg', rir: null, discomfort: false } })),
    })),
  } as unknown as WorkoutSession;
}

const week = (meals: MealEntry[], sessions: WorkoutSession[] = [], proteinTarget: number | null = null, start = MON, t = today) =>
  weekRecap({ weekStart: start, today: t, meals, sessions, proteinTarget });

describe('weekRecap basics', () => {
  it('counts logged days from meals and finished workouts, and consistency over elapsed days', () => {
    const r = week([meal('2026-10-05', 20), meal('2026-10-05', 30), meal('2026-10-07', 25)], [session('2026-10-09', [{ loads: [60] }]), session('2026-10-10', [{ loads: [60] }], 'active')]);
    expect(r.weekStart).toBe(MON);
    expect(r.weekEnd).toBe('2026-10-11');
    expect(r.daysLogged).toBe(3); // Mon, Wed, Fri (active session doesn't count)
    expect(r.daysElapsed).toBe(6);
    expect(r.consistencyPct).toBe(50);
    expect(r.workouts).toBe(1);
    expect(r.sets).toBe(1);
  });

  it('normalises any date to its Monday and ignores deleted meals and future entries', () => {
    const r = week([meal('2026-10-06', 10, { deleted: true }), meal('2026-10-11', 10)], [], null, '2026-10-08');
    expect(r.weekStart).toBe(MON);
    expect(r.daysLogged).toBe(0);
  });

  it('is earned with 3 logged days, not before', () => {
    expect(week([meal('2026-10-05', 1), meal('2026-10-06', 1)]).earned).toBe(false);
    expect(week([meal('2026-10-05', 1), meal('2026-10-06', 1)], [session('2026-10-08', [{ loads: [20] }])]).earned).toBe(true);
  });

  it('uses all 7 days for a past week', () => {
    const r = week(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((d) => meal(d, 10)), [], null, '2026-09-28');
    expect(r.daysElapsed).toBe(7);
    expect(r.consistencyPct).toBe(57);
  });
});

describe('personal bests', () => {
  it('reports a new heaviest load vs all earlier sessions, per exercise and unit', () => {
    const r = week([], [
      session('2026-09-20', [{ loads: [60, 62.5] }, { key: 'bench', name: 'Bench press', loads: [50] }]),
      session('2026-10-06', [{ loads: [65] }, { key: 'bench', name: 'Bench press', loads: [50] }]),
      session('2026-10-08', [{ loads: [67.5] }, { key: 'row', name: 'Row', loads: [40] }, { key: 'bench', name: 'Bench press', loads: [110], unit: 'lb' }]),
    ]);
    // Squat beats 62.5 twice; the best of the week is reported once. Bench in lb has no lb history; Row is a first load.
    expect(r.prs).toEqual([{ name: 'Back squat', load: 67.5, unit: 'kg' }]);
  });

  it('a first-ever load inside the week is a start, and a later heavier set that week is a best', () => {
    const r = week([], [session('2026-10-05', [{ loads: [40] }]), session('2026-10-09', [{ loads: [45] }])]);
    expect(r.prs).toEqual([{ name: 'Back squat', load: 45, unit: 'kg' }]);
  });

  it('ignores skipped sets, zero loads and active sessions', () => {
    const s = session('2026-10-08', [{ loads: [0, 100] }]);
    s.exercises[0]!.sets[1]!.status = 'skipped';
    const r = week([], [session('2026-09-01', [{ loads: [50] }]), s, session('2026-10-09', [{ loads: [200] }], 'active')]);
    expect(r.prs).toEqual([]);
  });
});

describe('protein', () => {
  it('averages only days whose protein is complete and never treats unknown as 0', () => {
    const r = week([
      meal('2026-10-05', 100), meal('2026-10-05', 20), // 120
      meal('2026-10-06', 80), // 80
      meal('2026-10-07', 50), meal('2026-10-07', null), // partial day -> left out
      meal('2026-10-08', null), // unknown day -> left out
    ]);
    expect(r.protein.avgPerLoggedDay).toBe(100);
    expect(r.protein.daysWithKnownProtein).toBe(2);
    expect(r.protein.daysWithUnknownProtein).toBe(2);
  });

  it('treats an item marked incomplete as partial even when it has a value', () => {
    const r = week([meal('2026-10-05', 40, { complete: false })]);
    expect(r.protein.avgPerLoggedDay).toBeNull();
    expect(r.protein.daysWithUnknownProtein).toBe(1);
  });

  it('is null with no complete days, and trend needs both weeks', () => {
    expect(week([meal('2026-10-05', null)]).protein).toMatchObject({ avgPerLoggedDay: null, trend: null });
    expect(week([meal('2026-10-05', 100)]).protein.trend).toBeNull();
  });

  it('compares with the week before', () => {
    const prev = [meal('2026-09-29', 100), meal('2026-09-30', 100)];
    expect(week([...prev, meal('2026-10-05', 130)]).protein.trend).toBe('up');
    expect(week([...prev, meal('2026-10-05', 80)]).protein.trend).toBe('down');
    expect(week([...prev, meal('2026-10-05', 103)]).protein.trend).toBe('flat');
  });

  it('counts days at target when a target is set', () => {
    const meals = ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => meal(d, 130));
    expect(week(meals, [], 120).protein.daysAtTarget).toBe(3);
    expect(week(meals, [], null).protein.daysAtTarget).toBeNull();
  });
});

describe('surprise', () => {
  it('prefers a real progression across at least 4 weeks', () => {
    const sessions = [session('2026-08-25', [{ loads: [80] }]), session('2026-10-06', [{ loads: [90] }])];
    expect(week([], sessions).surprise).toBe('Your Back squat is up 10 kg in 6 weeks.');
  });

  it('needs sessions at least 4 weeks apart', () => {
    const sessions = [session('2026-09-22', [{ loads: [80] }]), session('2026-10-06', [{ loads: [90] }])];
    expect(week([], sessions).surprise).toBeNull();
  });

  it('falls back to protein target, then a meal slot, then a favourite meal', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    expect(week(days.map((d) => meal(d, 130)), [], 120).surprise).toBe('You reached your protein target on 4 days this week.');
    expect(week(days.map((d) => meal(d, 10, { slot: 'breakfast' }))).surprise).toBe('You logged breakfast 4 days this week.');
    expect(week(days.slice(0, 3).map((d) => meal(d, 10, { name: 'Paneer wrap' }))).surprise).toBe('Paneer wrap was your go-to meal this week: 3 times.');
  });

  it('can name the most consistent weekday from recent weeks', () => {
    const tuesdays = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'];
    const meals = tuesdays.map((d, i) => meal(d, 10, { name: `Meal ${i}` }));
    expect(week(meals).surprise).toBe('Most consistent day: Tuesday.');
  });

  it('is null when there is nothing true to say', () => {
    expect(week([meal('2026-10-05', 10)]).surprise).toBeNull();
  });

  it('is deterministic regardless of input order', () => {
    const meals = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].flatMap((d) => [
      meal(d, 10, { slot: 'breakfast', name: 'Oats' }), meal(d, 10, { slot: 'dinner', name: 'Curry' }),
    ]);
    const sessions = [session('2026-08-25', [{ loads: [80] }, { key: 'dl', name: 'Deadlift', loads: [100] }]), session('2026-10-06', [{ loads: [90] }, { key: 'dl', name: 'Deadlift', loads: [110] }])];
    const a = week(meals, sessions);
    const b = week([...meals].reverse(), [...sessions].reverse());
    expect(a).toEqual(b);
    expect(a.surprise).toBe('Your Back squat is up 10 kg in 6 weeks.'); // tie on gain: alphabetical
    const c = week([...meals].reverse(), []);
    expect(c.surprise).toBe('You logged breakfast 4 days this week.'); // tie on days: slot order
  });
});

describe('yearRecap', () => {
  const sessions = [
    session('2025-12-20', [{ loads: [60] }]),
    session('2026-01-10', [{ loads: [65, 65] }, { key: 'bench', name: 'Bench press', loads: [40, 40, 40] }]),
    session('2026-02-10', [{ loads: [70] }, { key: 'row', name: 'Row', loads: [30, 30] }]),
    session('2026-03-10', [{ loads: [70] }, { key: 'curl', name: 'Curl', loads: [10] }]),
  ];
  const meals = [
    meal('2026-01-02', 10, { name: 'Oats' }), meal('2026-01-03', 10, { name: 'Oats' }), meal('2026-01-04', 10, { name: 'Oats' }),
    meal('2026-01-04', 10, { name: 'Dal' }), meal('2025-12-31', 10, { name: 'Dal' }), meal('2025-12-30', 10, { name: 'Dal' }),
  ];
  const r = yearRecap({ year: 2026, today, meals, sessions });

  it('summarises the year from real records', () => {
    expect(r.daysLogged).toBe(6); // Jan 2, 3, 4, 10, Feb 10, Mar 10
    expect(r.workouts).toBe(3);
    expect(r.totalSets).toBe(10);
    expect(r.bestStreak).toBe(3);
    expect(r.topExercises).toEqual([{ name: 'Back squat', sets: 4 }, { name: 'Bench press', sets: 3 }, { name: 'Row', sets: 2 }]);
    expect(r.prs).toBe(2); // 65 over last year's 60, then 70
    expect(r.favouriteMeal).toBe('Oats');
    expect(r.favouriteMealCount).toBe(3);
    expect(r.firstLogDate).toBe('2026-01-02');
    expect(r.identityLine).toBe(COPY.identityStarter);
  });

  it('says "You are someone who trains." from 12 workouts', () => {
    const many = Array.from({ length: 12 }, (_, i) => session(shiftDate('2026-04-01', i * 7), [{ loads: [50] }]));
    expect(yearRecap({ year: 2026, today, meals: [], sessions: many }).identityLine).toBe('You are someone who trains.');
  });

  it('handles an empty year', () => {
    expect(yearRecap({ year: 2026, today, meals: [], sessions: [] })).toMatchObject({ daysLogged: 0, bestStreak: 0, favouriteMeal: null, firstLogDate: null, prs: 0 });
  });
});

describe('story builders', () => {
  const r = week(
    ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => meal(d, 120)),
    [session('2026-09-01', [{ loads: [60] }]), session('2026-10-08', [{ loads: [62.5, 62.5] }])],
  );

  it('builds a week card with at most 4 stats and the trainer name', () => {
    const c = storyFromWeek(r, '  Sher  ');
    expect(c.kind).toBe('week');
    expect(c.trainerName).toBe('Sher');
    expect(c.headline).toBe('4 days of showing up');
    expect(c.eyebrow).toBe('My week · Oct 5 – 11');
    expect(c.stats).toEqual([
      { label: 'Days logged', value: '4 of 6' },
      { label: 'Workouts', value: '1 · 2 sets' },
      { label: 'New best', value: 'Back squat 62.5 kg' },
      { label: 'Avg protein', value: '120 g / day' },
    ]);
  });

  it('leaves unknown protein off the card', () => {
    const c = storyFromWeek(week([meal('2026-10-05', null), meal('2026-10-06', null), meal('2026-10-07', null)]), 'Luma');
    expect(c.stats.map((s) => s.label)).toEqual(['Days logged', 'Consistency']);
  });

  it('builds milestone and year cards', () => {
    expect(storyFromMilestone(30, 'Luma')).toEqual({
      kind: 'milestone', headline: '30 days in a row!', trainerName: 'Luma',
      stats: [{ label: 'Logging streak', value: '30 days' }, { label: 'Milestone', value: 'A month strong' }],
    });
    const y = storyFromYear(yearRecap({ year: 2026, today, meals: [meal('2026-02-01', 10, { name: 'Oats' })], sessions: [session('2026-02-02', [{ loads: [50] }])] }), '');
    expect(y.headline).toBe('My 2026 in training');
    expect(y.trainerName).toBe('Luma');
    expect(y.stats.length).toBeLessThanOrEqual(4);
    expect(y.stats[0]).toEqual({ label: 'Days logged', value: '2' });
  });

  it('makes a safe filename', () => {
    expect(storyFilename(storyFromMilestone(7, 'Luma'), '7-days')).toBe('trainluma-milestone-7-days.png');
  });
});

describe('copy stays kind', () => {
  const BANNED = /\b(miss|lost|lose|fail|lazy|skipped|worst|should have)\w*|last place/i;

  function strings(): string[] {
    const out: string[] = [];
    for (const v of Object.values(COPY)) {
      if (typeof v === 'string') out.push(v);
      else out.push((v as (...a: unknown[]) => string)('Back squat', 3, 'kg', 4));
    }
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) out.push(COPY.slot(slot, 5));
    // Recaps across sparse, empty, partial and busy fixtures.
    const fixtures: WeekRecap[] = [
      week([]),
      week([meal('2026-10-05', null)]),
      week(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => meal(d, 130)), [], 120),
      week([], [session('2026-08-25', [{ loads: [80] }]), session('2026-10-06', [{ loads: [90] }])]),
      week([], [], null, '2026-09-07'),
    ];
    const years: YearRecap[] = [
      yearRecap({ year: 2026, today, meals: [], sessions: [] }),
      yearRecap({ year: 2026, today, meals: Array.from({ length: 40 }, (_, i) => meal(shiftDate('2026-01-01', i), 10)), sessions: [] }),
      yearRecap({ year: 2026, today, meals: [], sessions: Array.from({ length: 13 }, (_, i) => session(shiftDate('2026-01-05', i * 7), [{ loads: [50 + i] }])) }),
    ];
    const cards: StoryCard[] = [...fixtures.map((f) => storyFromWeek(f, 'Luma')), ...years.map((y) => storyFromYear(y, 'Luma')), ...[7, 30, 100].map((d) => storyFromMilestone(d, 'Luma'))];
    for (const f of fixtures) out.push(f.surprise ?? '');
    for (const y of years) out.push(y.identityLine);
    for (const c of cards) out.push(c.headline, c.eyebrow ?? '', ...c.stats.flatMap((s) => [s.label, s.value]));
    return out.filter(Boolean);
  }

  it('never uses guilt or shame words', () => {
    const all = strings();
    expect(all.length).toBeGreaterThan(20);
    for (const s of all) expect(s, s).not.toMatch(BANNED);
  });

  it('the scanner itself catches the words', () => {
    for (const w of ['You missed a day', 'lost', 'You lose', 'failed', 'lazy', 'skipped', 'worst', 'last place', 'should have']) expect(w).toMatch(BANNED);
    expect('close the sheet').not.toMatch(BANNED);
  });
});

describe('helpers', () => {
  it('labels weeks across months and collects logged dates', () => {
    expect(weekLabel('2026-09-28', '2026-10-04')).toBe('Sep 28 – Oct 4');
    expect([...loggedDates([meal('2026-10-01', 1)], [session('2026-10-02', [{ loads: [1] }], 'active')])]).toEqual(['2026-10-01']);
  });
});
