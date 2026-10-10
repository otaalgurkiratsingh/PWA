/**
 * Turn a validated AI plan draft (schema 2.0) into the editor's plan draft. Saving it goes through
 * commitPlan, so accepting creates a NEW immutable program version; past sessions keep their own
 * prescriptions. Only catalogue exercise ids are accepted (the backend already checked them).
 */
import type { LoadUnit, PrescribedSet } from '@shared/contracts';
import { EXERCISE_LIBRARY, exerciseId } from '@shared/fixtures/exerciseLibrary';
import type { AiPlanDraft } from '@/core/ai/client';
import { plannedFromDefinition, type PlanDraft } from './plan';

const BY_ID = new Map(EXERCISE_LIBRARY.map((x) => [exerciseId(x), x]));

export function exerciseName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

export function editorDraftFromAi(plan: AiPlanDraft, units: LoadUnit, newId: () => string): PlanDraft {
  const days = plan.days.map((d) => {
    const exercises = d.exercises.flatMap((e) => {
      const def = BY_ID.get(e.exercise_id);
      if (!def) return [];
      const set: PrescribedSet = {
        type: 'working',
        rep_min: e.rep_min,
        rep_max: Math.max(e.rep_min, e.rep_max),
        target_load: e.target_load && e.target_load > 0 && def.measurement === 'weight_reps' ? e.target_load : null,
        target_unit: units,
        rest_seconds: e.rest_seconds,
        rir_target: null,
      };
      return [plannedFromDefinition(def, units, newId, Array.from({ length: e.working_sets }, () => ({ ...set })))];
    });
    return { id: newId(), name: d.label, weekday: plan.schedule_mode === 'weekdays' ? d.weekday : null, muscle_groups: [...new Set(exercises.map((x) => x.muscle_group))], exercises };
  }).filter((d) => d.exercises.length > 0);
  return { name: plan.title.slice(0, 60) || 'My plan', schedule: plan.schedule_mode, days };
}

/** Hand-off from a draft preview to the plan editor ("Edit"). One-shot, this tab only. */
export const PLAN_SEED_KEY = 'rozana.planSeed';
