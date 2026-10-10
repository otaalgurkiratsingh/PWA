/**
 * The single-person input envelope sent with the system prompt (see AI_FITNESS_COACH_SYSTEM_PROMPT_V2).
 * Built only from the caller's own documents, read with the caller's token (RLS). Deterministic
 * metrics come from summary.ts. Free text (meal names, notes, chat) is passed as data, never rules.
 */
import { buildContext, type CoachContext, type DocRow } from './summary.ts';
import type { AllowedExercise, PlanningAnswers } from './planRules.ts';

export const CONTEXT_VERSION = 'ctx-2026-10-10.1';

type Doc = Record<string, unknown>;
const str = (v: unknown, max = 80): string => (typeof v === 'string' ? v.slice(0, max) : '');

export interface ProfileView {
  version: number;
  adult: boolean;
  units: 'kg' | 'lb';
  timezone: string;
  goal: string | null;
  training: PlanningAnswers | null;
  food_prefs: { pattern: string; meatless_weekdays: number[]; allergies: string[] };
  ai_images: boolean;
}

export function readProfile(rows: readonly DocRow[]): ProfileView {
  const p = (rows.find((r) => r.collection === 'settings' && !r.deleted)?.body.profile ?? {}) as Doc;
  const t = (p.training ?? null) as Doc | null;
  const fp = (p.food_prefs ?? {}) as Doc;
  const consent = (p.consent ?? {}) as Doc;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    version: typeof p.profile_version === 'number' ? p.profile_version : 0,
    adult: p.adult_confirmed === true,
    units: p.units === 'lb' ? 'lb' : 'kg',
    timezone: str(p.timezone, 64) || 'UTC',
    goal: typeof p.goal === 'string' ? p.goal : null,
    training: t ? {
      goal_priorities: arr(t.goal_priorities).map((x) => str(x, 20)).slice(0, 5),
      days_available: arr(t.days_available).filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6),
      sessions_per_week: Number(t.sessions_per_week) || 0,
      minutes_per_session: Number(t.minutes_per_session) || 0,
      rotating_schedule: t.rotating_schedule === true,
      experience: (['new', 'returning', 'regular'].includes(t.experience as string) ? t.experience : 'new') as PlanningAnswers['experience'],
      location: (['gym', 'home', 'both'].includes(t.location as string) ? t.location : 'gym') as PlanningAnswers['location'],
      equipment: arr(t.equipment).map((x) => str(x, 20)).slice(0, 8),
      avoid_exercises: str(t.avoid_exercises, 300),
      restrictions: str(t.restrictions, 400),
      screening: (['no_concerns', 'has_concerns'].includes(t.screening as string) ? t.screening : 'not_answered') as PlanningAnswers['screening'],
      recent_performance: str(t.recent_performance, 400),
    } : null,
    food_prefs: {
      pattern: str(fp.pattern, 20) || 'unspecified',
      meatless_weekdays: arr(fp.meatless_weekdays).filter((d): d is number => Number.isInteger(d)).slice(0, 7),
      allergies: arr(fp.allergies).map((x) => str(x, 60)).slice(0, 20),
    },
    ai_images: consent.ai_images === true,
  };
}

/** Usual foods: names and catalogue ids, plus whether the person has confirmed numbers for them. */
function usualFoods(rows: readonly DocRow[]) {
  const foods = new Map(rows.filter((r) => r.collection === 'foods').map((r) => [r.doc_id, r.body]));
  return rows
    .filter((r) => r.collection === 'presets' && !r.deleted && !r.body.deleted_at)
    .slice(0, 40)
    .map((r) => {
      const item = ((r.body.items as Doc[] | undefined) ?? [])[0] ?? {};
      const fv = item.kind === 'food' ? foods.get(item.food_version_id as string) : undefined;
      const per = (fv?.per_100g ?? {}) as Doc;
      return {
        name: str(r.body.name, 60),
        catalogue_id: typeof r.body.catalogue_id === 'string' ? r.body.catalogue_id : null,
        usual_amount: `${item.default_quantity ?? 1} ${str(item.unit_label, 20)}`,
        serving_weighed: typeof item.grams_per_unit === 'number',
        nutrition_confirmed: item.kind === 'recipe' || typeof per.energy_kcal === 'number',
        favorite: r.body.favorite === true,
      };
    });
}

/** The newest program version as plain data (what the person currently follows). */
function approvedPlan(rows: readonly DocRow[]) {
  const progs = rows.filter((r) => r.collection === 'programs' && !r.deleted && !r.body.deleted_at)
    .sort((a, b) => Number(b.body.version ?? 0) - Number(a.body.version ?? 0));
  const p = progs[0]?.body;
  if (!p) return null;
  return {
    name: str(p.name, 60),
    schedule: str(p.schedule, 20),
    days: ((p.days as Doc[] | undefined) ?? []).slice(0, 7).map((d) => ({
      label: str(d.name, 40),
      weekday: typeof d.weekday === 'number' ? d.weekday : null,
      exercises: ((d.exercises as Doc[] | undefined) ?? []).slice(0, 12).map((e) => {
        const sets = (e.sets as Doc[] | undefined) ?? [];
        const working = sets.filter((s) => s.type === 'working');
        return {
          name: str(e.name, 60),
          exercise_id: `${str(e.exercise_key, 60)}:${str(e.variant, 20)}`,
          working_sets: working.length,
          reps: working[0] ? `${working[0].rep_min}-${working[0].rep_max}` : null,
        };
      }),
    })),
  };
}

export interface EnvelopeInput {
  operation: 'weekly_review' | 'coach_question' | 'onboarding_plan' | 'photo_suggest';
  rows: readonly DocRow[];
  today: string;
  memory: readonly string[];
  profile: ProfileView;
  message?: string;
  conversation?: { role: 'user' | 'assistant'; text: string }[];
  allowed?: readonly AllowedExercise[];
  instruction?: string;
  images?: { role: string }[];
}

export interface Envelope {
  json: Record<string, unknown>;
  ctx: CoachContext;
}

export function buildEnvelope(i: EnvelopeInput): Envelope {
  const days = i.operation === 'weekly_review' ? 7 : 14;
  const ctx = buildContext(i.rows, i.today, days, i.memory);
  const t = i.profile.training;
  const json: Record<string, unknown> = {
    operation: i.operation,
    enabled_capabilities: ['text_chat'],
    requested_output_schema_version: '2.0',
    context_version: CONTEXT_VERSION,
    authorized_profile_version: String(i.profile.version),
    eligibility: { adult_confirmed: i.profile.adult, ai_permission: true, ai_image_permission: i.profile.ai_images },
    profile: { goal: i.profile.goal, goal_priorities: t?.goal_priorities ?? [], units: i.profile.units, timezone: i.profile.timezone, language: 'en' },
    availability: t ? { days_available: t.days_available, sessions_per_week: t.sessions_per_week, minutes_per_session: t.minutes_per_session, rotating_schedule: t.rotating_schedule } : null,
    experience: t ? { level: t.experience, recent_performance: t.recent_performance || null } : null,
    equipment: t ? { location: t.location, available: t.equipment, avoid: t.avoid_exercises || null } : null,
    screening_state: t?.screening ?? 'not_answered',
    confirmed_restrictions: t?.restrictions || null,
    nutrition_preferences: { ...i.profile.food_prefs, targets: ctx.targets, usual_foods: usualFoods(i.rows) },
    approved_plan: approvedPlan(i.rows),
    // Only days with records are listed; every other day in the period is unknown (not zero).
    history: {
      period: ctx.period,
      days_with_records: ctx.days.filter((d) => d.meals_logged > 0 || d.marked_complete).map((d) => ({ ref: d.ref, meals_logged: d.meals_logged, energy_kcal: d.energy_kcal, protein_g: d.protein_g, totals_complete: d.totals_complete, marked_complete: d.marked_complete })),
      days_without_records: ctx.days.filter((d) => d.meals_logged === 0 && !d.marked_complete).length,
      weights: ctx.weights, workouts: ctx.workouts, steps: ctx.steps, completeness: ctx.completeness,
    },
    valid_evidence_refs: ctx.valid_refs,
    confirmed_memories: ctx.confirmed_memory,
    constraints: {
      no_invented_nutrition: true,
      missing_is_unknown_not_zero: true,
      plan_changes_need_approval: true,
      measurement_candidates_must_be_empty: true,
    },
  };
  if (i.allowed) json.allowed_exercises = i.allowed;
  if (i.conversation) json.conversation = i.conversation;
  if (i.message !== undefined) json.current_user_message = i.message;
  if (i.instruction) json.plan_request = i.instruction;
  if (i.images?.length) json.optional_images = i.images;
  return { json, ctx };
}

/** Conservative token estimate for budgeting (about 3.5 characters per token for this mix). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Keep the newest messages that fit the budget (at most `maxMessages`), oldest dropped first.
 * Returns the window in chronological order.
 */
export function fitConversation(history: { role: 'user' | 'assistant'; text: string }[], maxMessages: number, tokenBudget: number) {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = history[i]!;
    const cost = estimateTokens(m.text) + 8;
    if (used + cost > tokenBudget) break;
    out.unshift(m);
    used += cost;
  }
  return out;
}
