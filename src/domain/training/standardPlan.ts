/**
 * "Start from a simple 2-day plan" / "Just set me up with a standard plan": a fixed starter plan,
 * built through the SAME rules AI drafts go through: no-gym equipment only without gym access
 * (truck cab, home), movements excluded for flagged pain areas removed, and a supportive move
 * added for each area. No AI involved.
 */
import type { LoadUnit, TrainingProfile } from '@shared/contracts';
import type { PlanDraft as AiPlanDraft } from '../../../supabase/functions/_shared/aiContracts';
import { allowedExercises, enforceBodyRules, noGymAccess } from '../../../supabase/functions/_shared/planRules';
import { editorDraftFromAi } from './aiPlan';
import type { PlanDraft } from './plan';

const GYM = [['squat:barbell', 'bench_press:barbell', 'row:cable', 'plank:bodyweight'], ['romanian_deadlift:barbell', 'overhead_press:dumbbell', 'lat_pulldown:cable', 'split_squat:dumbbell']] as const;
const NO_GYM = [['goblet_squat:dumbbell', 'push_up:bodyweight', 'one_arm_row:dumbbell', 'plank:bodyweight'], ['romanian_deadlift:dumbbell', 'overhead_press:dumbbell', 'reverse_lunge:bodyweight', 'dead_bug:bodyweight']] as const;

export function standardPlan(t: Pick<TrainingProfile, 'location' | 'lifestyle' | 'pain_areas' | 'avoid_exercises' | 'minutes_per_session'>, units: LoadUnit, newId: () => string): PlanDraft {
  const noGym = noGymAccess({ location: t.location });
  const cab = t.lifestyle === 'trucker' || t.location === 'truck';
  const base = { equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'band'], avoid_exercises: t.avoid_exercises, location: t.location };
  const allowed = allowedExercises({ ...base, pain_areas: t.pain_areas });
  const ok = new Set(allowed.map((x) => x.id));
  // Without pain filtering, so enforceBodyRules can remove (and report) pain-excluded moves itself.
  const fits = new Set(allowedExercises(base).map((x) => x.id));
  const ex = (id: string) => ({ exercise_id: id, variant_id: null, working_sets: 3, rep_min: id.startsWith('plank') ? 20 : 8, rep_max: id.startsWith('plank') ? 30 : 12, target_load: null, load_unit: units, rest_seconds: 90, effort_instruction: '', substitution_exercise_ids: [], notes: '' });
  const template = noGym ? NO_GYM : GYM;
  const label = cab ? 'Cab workout' : 'Full body';
  const draft: AiPlanDraft = {
    title: cab ? 'Built for the cab' : 'My plan', status: 'draft', goal: '', profile_version: '0', schedule_mode: 'rotation', duration_weeks_before_review: 4,
    warmup: [{ instruction: 'Easy walk and arm circles', minutes: 4 }],
    days: template.map((ids, i) => ({
      label: `${label} ${i === 0 ? 'A' : 'B'}`, weekday: null, estimated_minutes: 30,
      exercises: ids.filter((id) => fits.has(id)).map(ex),
    })),
    recovery_notes: [], progression_rule: '', review_trigger: '',
  };
  const fixed = enforceBodyRules(draft, { minutes_per_session: Math.max(30, t.minutes_per_session), pain_areas: t.pain_areas }, allowed).plan;
  const clean = { ...fixed, days: fixed.days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => ok.has(e.exercise_id)) })) };
  return { ...editorDraftFromAi(clean, units, newId), name: clean.title };
}
