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
  location: 'gym' | 'home' | 'both' | 'truck';
  equipment: string[];
  avoid_exercises: string;
  restrictions: string;
  screening: 'not_answered' | 'no_concerns' | 'has_concerns';
  recent_performance: string;
  /** Phase 3 (optional so older callers and stored profiles still work). */
  lifestyle?: 'standard' | 'trucker';
  pain_areas?: string[];
  pain_note?: string;
}

/** Equipment that works without a gym (truck cab, rest stop, home). */
export const NO_GYM_EQUIPMENT: readonly string[] = ['bodyweight', 'dumbbell', 'kettlebell', 'band'];

/** True when the person has no gym access: the plan may only use no-gym equipment. */
export const noGymAccess = (a: Pick<PlanningAnswers, 'location'> & Partial<Pick<PlanningAnswers, 'lifestyle'>>) =>
  a.location === 'truck' || a.location === 'home';

export type PainAreaKey = 'lower_back' | 'knees' | 'shoulders' | 'neck' | 'hips' | 'wrists_ankles';

/**
 * Body areas the person says bother them. `exclude`: movements left out of the allowed list (heavy
 * spinal loading, deep loaded knee bends, overhead pressing…). `supportive`: gentle moves from the
 * allowed list that build the muscles around the area; a plan for a flagged area must contain one.
 * General fitness guidance only — never a diagnosis or treatment.
 */
export const PAIN_RULES: Record<PainAreaKey, { label: string; exclude: readonly string[]; supportive: readonly string[] }> = {
  lower_back: {
    label: 'lower back',
    exclude: ['deadlift:barbell', 'squat:barbell', 'barbell_row:barbell', 'romanian_deadlift:barbell', 'kettlebell_swing:kettlebell', 'hanging_leg_raise:bodyweight', 'overhead_press:barbell'],
    supportive: ['bird_dog:bodyweight', 'dead_bug:bodyweight', 'glute_bridge:bodyweight', 'side_plank:bodyweight'],
  },
  knees: {
    label: 'knees',
    exclude: ['squat:barbell', 'lunge:dumbbell', 'split_squat:dumbbell', 'reverse_lunge:bodyweight', 'leg_extension:machine'],
    supportive: ['glute_bridge:bodyweight', 'step_up:dumbbell', 'leg_curl:machine', 'hip_thrust:barbell'],
  },
  shoulders: {
    label: 'shoulders',
    exclude: ['overhead_press:barbell', 'overhead_press:dumbbell', 'dips:bodyweight', 'bench_press:barbell', 'pull_up:bodyweight', 'skull_crusher:barbell'],
    supportive: ['band_pull_apart:band', 'face_pull:cable', 'band_row:band', 'one_arm_row:dumbbell'],
  },
  neck: {
    label: 'neck',
    exclude: ['overhead_press:barbell', 'squat:barbell', 'deadlift:barbell'],
    supportive: ['band_pull_apart:band', 'face_pull:cable', 'bird_dog:bodyweight'],
  },
  hips: {
    label: 'hips',
    exclude: ['lunge:dumbbell', 'split_squat:dumbbell', 'squat:barbell', 'kettlebell_swing:kettlebell', 'deadlift:barbell'],
    supportive: ['glute_bridge:bodyweight', 'side_plank:bodyweight', 'bird_dog:bodyweight'],
  },
  wrists_ankles: {
    label: 'wrists or ankles',
    exclude: ['dips:bodyweight', 'skull_crusher:barbell', 'barbell_curl:barbell', 'lunge:dumbbell', 'calf_raise:machine', 'kettlebell_swing:kettlebell'],
    supportive: ['dead_bug:bodyweight', 'glute_bridge:bodyweight', 'band_row:band'],
  },
};

export const painAreasOf = (a: Partial<Pick<PlanningAnswers, 'pain_areas'>>): PainAreaKey[] =>
  (a.pain_areas ?? []).filter((x): x is PainAreaKey => x in PAIN_RULES);

/** Ids left out for the flagged areas. */
export function excludedForPain(areas: readonly PainAreaKey[]): Set<string> {
  return new Set(areas.flatMap((x) => PAIN_RULES[x].exclude));
}

/** Plain copy shown wherever pain areas are used. */
export const PAIN_DISCLAIMER = 'I’m not a physio or doctor — if pain is sharp, getting worse, or comes with numbness or tingling, please get it checked first.';

export interface AllowedExercise {
  id: string;
  name: string;
  equipment: string;
  muscle_group: string;
  measurement: string;
  unilateral: boolean;
}

/**
 * Exercises the person's stated equipment allows (bodyweight always). Avoided names are removed.
 * Without gym access (truck cab / rest stop, home) only bodyweight, dumbbell, kettlebell and band
 * moves are allowed, whatever else is listed. Movements excluded for flagged pain areas are removed.
 */
export function allowedExercises(
  answers: Pick<PlanningAnswers, 'equipment' | 'avoid_exercises'> & Partial<Pick<PlanningAnswers, 'location' | 'pain_areas' | 'lifestyle'>>,
  library: readonly LibraryExercise[] = EXERCISE_LIBRARY,
): AllowedExercise[] {
  let eq = new Set([...answers.equipment, 'bodyweight']);
  if (answers.location && noGymAccess({ location: answers.location })) eq = new Set([...eq].filter((x) => NO_GYM_EQUIPMENT.includes(x)));
  const avoid = answers.avoid_exercises.toLowerCase().split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 3);
  const painOut = excludedForPain(painAreasOf(answers));
  return library
    .filter((x) => eq.has(x.equipment))
    .filter((x) => !painOut.has(exerciseId(x)))
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
    if (!exercises.length) errors.push(`Day ${i + 1} has no exercises.`);
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

export interface BodyRulesResult {
  plan: PlanDraft;
  /** Plain-language notes on what code changed (shown with the draft). */
  changes: string[];
}

/**
 * Apply the pain-area rules to a draft BEFORE `checkPlan`: movements excluded for a flagged area
 * are removed (also from substitutions), and when the plan has no supportive move for an area, one
 * is added to the shortest day that still fits the time available (else it becomes a rest-day note).
 * Deterministic, so the same draft always gets the same result.
 */
export function enforceBodyRules(plan: PlanDraft, a: Pick<PlanningAnswers, 'minutes_per_session'> & Partial<Pick<PlanningAnswers, 'pain_areas'>>, allowedList: readonly AllowedExercise[]): BodyRulesResult {
  const areas = painAreasOf(a);
  if (!areas.length) return { plan, changes: [] };
  const out = excludedForPain(areas);
  const allowed = new Map(allowedList.map((x) => [x.id, x]));
  const warmup = plan.warmup.reduce((s, w) => s + w.minutes, 0);
  const changes: string[] = [];
  const supportiveFor = (area: PainAreaKey) => PAIN_RULES[area].supportive.filter((id) => allowed.has(id));
  const prescription = (id: string): PlanDraft['days'][number]['exercises'][number] => {
    const timed = allowed.get(id)?.measurement === 'duration';
    return {
      exercise_id: id, variant_id: null, working_sets: 2, rep_min: timed ? 20 : 8, rep_max: timed ? 30 : 12, target_load: null, load_unit: 'bodyweight',
      rest_seconds: 45, effort_instruction: 'Slow and controlled; stop if it hurts.', substitution_exercise_ids: [], notes: 'Added to support the area you mentioned.',
    };
  };

  let removed = 0;
  let days = plan.days.map((d) => {
    const kept = d.exercises
      .filter((e) => {
        const drop = out.has(e.exercise_id);
        if (drop) removed++;
        return !drop;
      })
      .map((e) => ({ ...e, substitution_exercise_ids: e.substitution_exercise_ids.filter((s) => !out.has(s)) }));
    return { ...d, exercises: kept };
  });
  if (removed) changes.push(`Left out ${removed} movement${removed === 1 ? '' : 's'} that load the ${areas.map((x) => PAIN_RULES[x].label).join(' and ')}.`);

  // A day emptied by the rules gets a supportive move instead of disappearing.
  days = days.map((d) => {
    if (d.exercises.length) return d;
    const id = areas.flatMap(supportiveFor)[0] ?? allowedList[0]?.id;
    return id ? { ...d, exercises: [prescription(id)] } : d;
  });

  const recovery = [...plan.recovery_notes];
  for (const area of areas) {
    const inPlan = new Set(days.flatMap((d) => d.exercises.map((e) => e.exercise_id)));
    if (PAIN_RULES[area].supportive.some((id) => inPlan.has(id))) continue;
    const id = supportiveFor(area)[0];
    if (!id) continue;
    const order = days.map((d, i) => ({ i, m: estimateDayMinutes(d, warmup, allowed) })).sort((x, y) => x.m - y.m || x.i - y.i);
    const fit = order.find(({ i }) => days[i]!.exercises.length < 10
      && estimateDayMinutes({ ...days[i]!, exercises: [...days[i]!.exercises, prescription(id)] }, warmup, allowed) <= a.minutes_per_session * 1.1);
    const name = allowed.get(id)!.name;
    if (fit) {
      days = days.map((d, i) => (i === fit.i ? { ...d, exercises: [...d.exercises, prescription(id)] } : d));
      changes.push(`Added ${name} to support your ${PAIN_RULES[area].label}.`);
    } else if (recovery.length < 4) {
      recovery.push(`On a rest day: 2 easy sets of ${name} for your ${PAIN_RULES[area].label}.`.slice(0, 200));
      changes.push(`Suggested ${name} on rest days for your ${PAIN_RULES[area].label}.`);
    }
  }
  return { plan: { ...plan, days, recovery_notes: recovery }, changes };
}
