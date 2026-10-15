import { describe, expect, it } from 'vitest';
import { DEMO_PROFILES } from '@shared/fixtures/demo';
import type { LocalProfile } from '@shared/contracts';
import { markAsked, nextProfilingQuestion, withAnswers } from './progressive';

const base: LocalProfile = { ...DEMO_PROFILES[0]!, synthetic: false, profiling: { started_on: '2026-10-10', asked: {}, skipped: [] } };

describe('progressive profiling (week 1)', () => {
  it('asks nothing before onboarding finishes or after day 7', () => {
    expect(nextProfilingQuestion({ ...base, profiling: { started_on: null, asked: {}, skipped: [] } }, '2026-10-10')).toBeNull();
    expect(nextProfilingQuestion(base, '2026-10-16')).toBe('diet');
    expect(nextProfilingQuestion(base, '2026-10-17')).toBeNull();
  });

  it('one question per local day; answered or skipped questions never return', () => {
    expect(nextProfilingQuestion(base, '2026-10-10')).toBe('diet');
    const day1 = { ...base, profiling: markAsked(base, 'diet', '2026-10-10', true) };
    expect(nextProfilingQuestion(day1, '2026-10-10')).toBeNull();
    expect(nextProfilingQuestion(day1, '2026-10-11')).toBe('cuisine');
    const answered = { ...day1, food_prefs: { ...day1.food_prefs, cuisine: 'mixed' as const } };
    expect(nextProfilingQuestion(answered, '2026-10-11')).toBe('body');
  });

  it('skips training questions without a training profile, and answers already given', () => {
    const p = { ...base, food_prefs: { ...base.food_prefs, pattern: 'vegetarian' as const, cuisine: 'punjabi_home' as const }, height_cm: 170, body: { ...base.body, weight_kg: 70, age_years: 30, sex: 'female' as const, no_timeline: true } };
    expect(nextProfilingQuestion(p, '2026-10-12')).toBeNull();
  });

  it('food or training changes bump the profile version; body details do not', () => {
    expect(withAnswers(base, { body: { ...base.body, weight_kg: 80 } }).profile_version).toBe(base.profile_version);
    expect(withAnswers(base, { food_prefs: { ...base.food_prefs, pattern: 'vegetarian' } }).profile_version).toBe(base.profile_version + 1);
  });
});
