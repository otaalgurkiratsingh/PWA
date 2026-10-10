import { describe, expect, it } from 'vitest';
import { ProgramVersion } from '@shared/contracts';
import { editorDraftFromAi } from './aiPlan';
import { commitPlan } from './plan';
import type { AiPlanDraft } from '@/core/ai/client';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const ex = (id: string, load: number | null = null) => ({ exercise_id: id, variant_id: null, working_sets: 3, rep_min: 8, rep_max: 12, target_load: load, load_unit: 'kg' as const, rest_seconds: 90, effort_instruction: '', substitution_exercise_ids: [], notes: '' });
const plan: AiPlanDraft = {
  title: 'Two-day start', status: 'draft', goal: 'consistency', profile_version: '2', schedule_mode: 'weekdays', duration_weeks_before_review: 4,
  warmup: [], days: [{ label: 'Day A', weekday: 1, estimated_minutes: 40, exercises: [ex('squat:barbell', 40), ex('push_up:bodyweight', 10), ex('unknown:thing')] }],
  recovery_notes: [], progression_rule: '', review_trigger: '',
};

describe('editorDraftFromAi', () => {
  it('maps catalogue ids to planned exercises with sets, keeps units, drops unknown ids and loads for bodyweight', () => {
    const d = editorDraftFromAi(plan, 'lb', newId);
    expect(d.days).toHaveLength(1);
    const exs = d.days[0]!.exercises;
    expect(exs.map((e) => e.name)).toEqual(['Back squat', 'Push-up']);
    expect(exs[0]!.sets).toHaveLength(3);
    expect(exs[0]!.sets[0]).toMatchObject({ rep_min: 8, rep_max: 12, target_load: 40, target_unit: 'lb', rest_seconds: 90 });
    expect(exs[1]!.sets[0]!.target_load).toBeNull();
    expect(d.days[0]!.weekday).toBe(1);
  });

  it('accepting creates a new program version on top of the current one', () => {
    const first = commitPlan({ draft: editorDraftFromAi(plan, 'kg', newId), previous: null, ownerId: 'u', newId, now: '2026-10-10T00:00:00.000Z', synthetic: false });
    const second = commitPlan({ draft: editorDraftFromAi(plan, 'kg', newId), previous: first, ownerId: 'u', newId, now: '2026-10-11T00:00:00.000Z', synthetic: false });
    expect(ProgramVersion.safeParse(second).success).toBe(true);
    expect(second.program_id).toBe(first.program_id);
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
  });
});
