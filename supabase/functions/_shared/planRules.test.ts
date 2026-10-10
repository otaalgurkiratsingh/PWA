// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXERCISE_LIBRARY, exerciseId } from './exerciseCatalog';
import { allowedExercises, checkPlan, estimateDayMinutes, missingAnswers, type PlanningAnswers } from './planRules';
import { COACH_PROMPT_SHA256, COACH_SYSTEM_PROMPT, PROMPT_VERSION } from './coachPrompt';
import type { PlanDraft } from './aiContracts';

const answers: PlanningAnswers = {
  goal_priorities: ['muscle_gain'], days_available: [1, 4], sessions_per_week: 2, minutes_per_session: 30, rotating_schedule: false,
  experience: 'new', location: 'home', equipment: ['dumbbell', 'band'], avoid_exercises: '', restrictions: '', screening: 'no_concerns', recent_performance: '',
};

describe('exercise ids', () => {
  it('are unique and stable (key:equipment)', () => {
    const ids = EXERCISE_LIBRARY.map(exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('bench_press:barbell');
    expect(ids).toContain('bench_press:dumbbell');
  });
});

describe('allowed exercises', () => {
  it('follow the stated equipment (bodyweight always) and drop avoided moves', () => {
    const a = allowedExercises({ equipment: ['dumbbell', 'band'], avoid_exercises: 'lunge, split squat' });
    const eq = new Set(a.map((x) => x.equipment));
    expect([...eq].sort()).toEqual(['band', 'bodyweight', 'dumbbell']);
    expect(a.some((x) => /lunge|split squat/i.test(x.name))).toBe(false);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe('missing answers', () => {
  it('asks only what is missing, including adult confirmation and screening', () => {
    expect(missingAnswers(answers, true)).toEqual([]);
    expect(missingAnswers({ ...answers, screening: 'not_answered' }, true)).toHaveLength(1);
    expect(missingAnswers(answers, false)[0]).toMatch(/18/);
    expect(missingAnswers({ ...answers, rotating_schedule: true, days_available: [] }, true)).toEqual([]);
    expect(missingAnswers(null, true)).toHaveLength(1);
  });
});

describe('checkPlan', () => {
  const allowed = allowedExercises(answers);
  const ex = (id: string, sets = 2, rest = 60) => ({ exercise_id: id, variant_id: 'x', working_sets: sets, rep_min: 8, rep_max: 12, target_load: 12, load_unit: 'lb' as const, rest_seconds: rest, effort_instruction: '', substitution_exercise_ids: [], notes: '' });
  const plan = (days: PlanDraft['days']): PlanDraft => ({
    title: 'Home plan', status: 'draft', goal: 'muscle', profile_version: '9', schedule_mode: 'weekdays', duration_weeks_before_review: 4,
    warmup: [{ instruction: 'March in place', minutes: 4 }], days, recovery_notes: [], progression_rule: 'Add reps first.', review_trigger: '4 weeks',
  });
  const dayA = { label: 'A', weekday: 1, estimated_minutes: 99, exercises: [ex('goblet_squat:dumbbell'), ex('push_up:bodyweight'), ex('band_row:band')] };

  it('accepts a fitting plan, replaces the model’s duration with ours, and normalises units/loads', () => {
    const r = checkPlan(plan([dayA]), answers, allowed, 'kg', 4);
    expect(r.errors).toEqual([]);
    const d = r.plan.days[0]!;
    expect(d.estimated_minutes).toBe(estimateDayMinutes(d, 4, new Map(allowed.map((x) => [x.id, x]))));
    expect(d.exercises.map((e) => [e.load_unit, e.target_load, e.variant_id])).toEqual([['kg', null, null], ['bodyweight', null, null], ['bodyweight', null, null]]);
    expect(r.plan.profile_version).toBe('4');
  });

  it('keeps a starting load only when the person gave recent actual performance', () => {
    const r = checkPlan(plan([dayA]), { ...answers, recent_performance: 'Goblet squat 12 kg × 10' }, allowed, 'kg', 4);
    expect(r.plan.days[0]!.exercises[0]!.target_load).toBe(12);
  });

  it('rejects unknown ids, too many days, unavailable or repeated weekdays, reversed reps and over-long sessions', () => {
    const errs = (p: PlanDraft) => checkPlan(p, answers, allowed, 'kg', 4).errors.join(' ');
    expect(errs(plan([{ ...dayA, exercises: [ex('deadlift:barbell')] }]))).toMatch(/not an allowed exercise/);
    expect(errs(plan([dayA, { ...dayA, weekday: 4 }, { ...dayA, weekday: null }]))).toMatch(/agreed to 2/);
    expect(errs(plan([{ ...dayA, weekday: 2 }]))).toMatch(/not available/);
    expect(errs(plan([dayA, dayA]))).toMatch(/same weekday/);
    expect(errs(plan([{ ...dayA, exercises: [{ ...ex('push_up:bodyweight'), rep_min: 12, rep_max: 8 }] }]))).toMatch(/reversed/);
    expect(errs(plan([{ ...dayA, exercises: Array(6).fill(ex('push_up:bodyweight', 4, 120)) }]))).toMatch(/you have 30/);
  });

  it('rotating schedules ignore weekdays', () => {
    const r = checkPlan(plan([{ ...dayA, weekday: 6 }]), { ...answers, rotating_schedule: true }, allowed, 'kg', 1);
    expect(r.ok).toBe(true);
    expect(r.plan.schedule_mode).toBe('rotation');
    expect(r.plan.days[0]!.weekday).toBeNull();
  });
});

describe('installed coach prompt', () => {
  it('is the V2 spec’s runtime sections, unmodified except the product name, with a matching hash', () => {
    const md = readFileSync('docs/spec/AI_FITNESS_COACH_SYSTEM_PROMPT_V2.md', 'utf8');
    const expected = md.slice(md.indexOf('## Identity and scope'), md.indexOf('## Backend implementation notes')).trim().replaceAll('AapnaFit Coach', 'TrainLuma Coach').replaceAll('AapnaFit', 'TrainLuma') + '\n';
    expect(COACH_SYSTEM_PROMPT).toBe(expected);
    expect(createHash('sha256').update(COACH_SYSTEM_PROMPT).digest('hex')).toBe(COACH_PROMPT_SHA256);
    expect(PROMPT_VERSION).toBe(`coach-2.0+${COACH_PROMPT_SHA256.slice(0, 12)}`);
    expect(COACH_SYSTEM_PROMPT).toMatch(/Trust boundaries/);
    expect(COACH_SYSTEM_PROMPT).not.toMatch(/Backend implementation notes/);
  });
});
