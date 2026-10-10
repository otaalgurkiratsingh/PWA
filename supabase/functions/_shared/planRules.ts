/**
 * Deterministic checks for AI plan drafts. The model proposes; this code decides whether a draft
 * may be stored. Nothing here trusts the model's own duration estimate or exercise names.
 */
import type { PlanDraft } from './aiContracts.ts';
import { EXERCISE_LIBRARY, exerciseId, type LibraryExercise } from './exerciseCatalog.ts';

export interface PlanningAnswers {
  goal_priorities: string[];
  days_available: number[];
  sessions_per_week: number;
  minutes_per_session: number;
  rotating_schedule: boolean;
  experience: 'new' | 'returning' | 'regular';
  location: 'gym' | 'home' | 'both';
  equipment: string[];
  avoid_exercises: string;
  restrictions: string;
  screening: 'not_answered' | 'no_concerns' | 'has_concerns';
  recent_performance: string;
}

export interface AllowedExercise {
  id: string;
  name: string;
  equipment: string;
  muscle_group: string;
  measurement: string;
  unilateral: boolean;
}

/** Exercises the person's stated equipment allows (bodyweight always). Avoided names are removed. */
export function allowedExercises(answers: Pick<PlanningAnswers, 'equipment' | 'avoid_exercises'>, library: readonly LibraryExercise[] = EXERCISE_LIBRARY): AllowedExercise[] {
  const eq = new Set([...answers.equipment, 'bodyweight']);
  const avoid = answers.avoid_exercises.toLowerCase().split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 3);
  return library
    .filter((x) => eq.has(x.equipment))
    .filter((x) => !avoid.some((a) => x.name.toLowerCase().includes(a)))
    .map((x) => ({ id: exerciseId(x), name: x.name, equipment: x.equipment, muscle_group: x.muscle_group, measurement: x.measurement, unilateral: x.unilateral }));
}

/** Questions the backend asks itself before spending a model call. */
export function missingAnswers(a: Partial<PlanningAnswers> | null, adult: boolean): string[] {
  const out: string[] = [];
  if (!adult) out.push('Please confirm you are 18 or older.');
  if (!a) return [...out, 'Tell us your goal, your week, your experience and your equipment.'];
  if (!a.goal_priorities?.length) out.push('Which goal matters most right now?');
  if (!a.sessions_per_week) out.push('How many workouts a week can you do?');
  if (!a.minutes_per_session) out.push('How long can each workout be?');
  if (!a.rotating_schedule && !(a.days_available?.length)) out.push('Which days can you usually train?');
  if (!a.experience) out.push('How much training have you done before?');
  if (!a.location) out.push('Where will you train?');
  if (a.screening === 'not_answered' || !a.screening) out.push('Please read the pre-exercise questionnaire and tell us the result.');
  return out;
}

const SEC_PER_SET_WORK = 40;
const TRANSITION_MIN = 2;
const COOLDOWN_MIN = 5;

/** Our own approximate duration (warm-up + sets + rests + transitions + cool-down), in minutes. */
export function estimateDayMinutes(day: PlanDraft['days'][number], warmupMinutes: number, allowed: ReadonlyMap<string, AllowedExercise>): number {
  let sec = 0;
  for (const e of day.exercises) {
    const sides = allowed.get(e.exercise_id)?.unilateral ? 2 : 1;
    sec += e.working_sets * (SEC_PER_SET_WORK * sides + e.rest_seconds) + TRANSITION_MIN * 60;
  }
  return Math.round(warmupMinutes + sec / 60 + COOLDOWN_MIN);
}

export interface PlanCheck {
  ok: boolean;
  errors: string[];
  plan: PlanDraft;
}

/**
 * Validate and normalise a draft: allowed ids only, agreed number of days, available weekdays,
 * sane rep ranges, unknown loads stay null, units match the exercise and the person's units,
 * and our duration estimate fits the time they have (10% tolerance).
 */
export function checkPlan(plan: PlanDraft, a: PlanningAnswers, allowedList: readonly AllowedExercise[], units: 'kg' | 'lb', profileVersion: number): PlanCheck {
  const errors: string[] = [];
  const allowed = new Map(allowedList.map((x) => [x.id, x]));
  const warmup = plan.warmup.reduce((s, w) => s + w.minutes, 0);
  if (plan.days.length > a.sessions_per_week) errors.push(`The draft has ${plan.days.length} days but you agreed to ${a.sessions_per_week}.`);
  const mode = a.rotating_schedule ? 'rotation' : plan.schedule_mode;
  const usedWeekdays = new Set<number>();
  const days = plan.days.map((d, i) => {
    let weekday = mode === 'weekdays' ? d.weekday : null;
    if (weekday !== null) {
      if (!a.days_available.includes(weekday)) errors.push(`Day ${i + 1} is on a weekday you said you are not available.`);
      if (usedWeekdays.has(weekday)) errors.push(`Two days use the same weekday.`);
      usedWeekdays.add(weekday);
    } else if (mode === 'weekdays') weekday = null;
    const exercises = d.exercises.map((e, k) => {
      const ex = allowed.get(e.exercise_id);
      if (!ex) errors.push(`Day ${i + 1}, exercise ${k + 1}: "${e.exercise_id.slice(0, 40)}" is not an allowed exercise.`);
      if (e.rep_min > e.rep_max) errors.push(`Day ${i + 1}, exercise ${k + 1}: rep range is reversed.`);
      const substitutions = e.substitution_exercise_ids.filter((s) => allowed.has(s) && s !== e.exercise_id);
      const weighted = ex ? ex.measurement === 'weight_reps' : true;
      const load_unit: PlanDraft['days'][number]['exercises'][number]['load_unit'] = weighted ? units : 'bodyweight';
      // Unknown starting loads stay unset unless the person told us recent actual performance.
      const target_load = weighted && a.recent_performance.trim() && e.target_load !== null && e.target_load > 0 ? e.target_load : null;
      return { ...e, variant_id: null, substitution_exercise_ids: substitutions, load_unit, target_load };
    });
    const estimate = estimateDayMinutes({ ...d, exercises }, warmup, allowed);
    if (estimate > a.minutes_per_session * 1.1) errors.push(`Day ${i + 1} would take about ${estimate} minutes; you have ${a.minutes_per_session}.`);
    return { ...d, weekday, exercises, estimated_minutes: Math.max(10, Math.min(180, estimate)) };
  });
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)].slice(0, 8),
    plan: { ...plan, schedule_mode: mode, profile_version: String(profileVersion), days },
  };
}
