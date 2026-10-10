/**
 * Typed AI request/response contracts shared by the Edge Function and the app (schema 2.0).
 * Model output is validated against these schemas before anything is stored or shown.
 * Saved version-1 weekly reviews stay readable through `reviewOutputFromStored` (read-only).
 */
import { z } from 'zod';
export const SCHEMA_VERSION = '2.0';

export const AiOperation = z.enum(['weekly_review', 'coach_question', 'onboarding_plan', 'photo_suggest']);
export type AiOperation = z.infer<typeof AiOperation>;

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Tz = z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/);

/** Characters per ordinary chat message (about 1,500 tokens). */
export const MAX_CHAT_CHARS = 6000;

export const PresetHint = z.object({ id: z.string().max(80), name: z.string().max(60) });

export const AiRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('weekly_review'), operation_id: Uuid, today: IsoDate, timezone: Tz.default('UTC') }),
  z.object({
    operation: z.literal('coach_question'),
    operation_id: Uuid,
    today: IsoDate,
    timezone: Tz.default('UTC'),
    /** null starts a new chat. Ownership is checked by the backend, never trusted. */
    thread_id: Uuid.nullable().default(null),
    message: z.string().trim().min(1).max(MAX_CHAT_CHARS),
  }),
  z.object({
    operation: z.literal('onboarding_plan'),
    operation_id: Uuid,
    today: IsoDate,
    timezone: Tz.default('UTC'),
    /** The profile version the person reviewed; a stale version is refused before any model call. */
    profile_version: z.number().int().nonnegative(),
    source: z.enum(['onboarding', 'chat']).default('onboarding'),
    /** Optional request from chat, e.g. "fit this into 30 minutes" (untrusted text). */
    instruction: z.string().trim().max(500).default(''),
    /** Ids of the person's own stored photos; resolved server-side only if AI-image permission is on. */
    photo_ids: z.array(Uuid).max(5).default([]),
    /**
     * Photos the person chose NOT to store: cropped/re-encoded on the phone, used for this one
     * request only if AI-image permission is on, never stored by TrainLuma.
     */
    inline_photos: z.array(z.object({
      slot: z.enum(['front', 'back', 'left', 'right', 'inspiration']),
      image_base64: z.string().min(100).max(400_000),
    })).max(5).default([]),
  }),
  z.object({
    operation: z.literal('photo_suggest'),
    operation_id: Uuid,
    timezone: Tz.default('UTC'),
    kind: z.enum(['food', 'notebook']),
    /** Base64 JPEG, already cropped/downscaled/re-encoded on the device (no metadata). */
    image_base64: z.string().min(100).max(2_000_000),
    /** The person's own saved meal names, so the model can suggest a match. */
    presets: z.array(PresetHint).max(60).default([]),
  }),
]);
export type AiRequest = z.infer<typeof AiRequest>;

// ---- schema 2.0: plan draft ------------------------------------------------------------
export const PlanExercise = z.object({
  exercise_id: z.string().min(1).max(80),
  variant_id: z.string().max(80).nullable(),
  working_sets: z.number().int().min(1).max(6),
  rep_min: z.number().int().min(1).max(30),
  rep_max: z.number().int().min(1).max(30),
  target_load: z.number().min(0).max(500).nullable(),
  load_unit: z.enum(['kg', 'lb', 'bodyweight']),
  rest_seconds: z.number().int().min(15).max(300),
  effort_instruction: z.string().max(160),
  substitution_exercise_ids: z.array(z.string().max(80)).max(3),
  notes: z.string().max(200),
});
export type PlanExercise = z.infer<typeof PlanExercise>;

export const PlanDraft = z.object({
  title: z.string().min(1).max(60),
  status: z.literal('draft'),
  goal: z.string().max(80),
  profile_version: z.string().max(20),
  schedule_mode: z.enum(['weekdays', 'rotation']),
  duration_weeks_before_review: z.number().int().min(1).max(12),
  warmup: z.array(z.object({ instruction: z.string().min(1).max(160), minutes: z.number().int().min(1).max(15) })).max(4),
  days: z.array(z.object({
    label: z.string().min(1).max(40),
    weekday: z.number().int().min(0).max(6).nullable(),
    estimated_minutes: z.number().int().min(10).max(180),
    exercises: z.array(PlanExercise).min(1).max(10),
  })).min(1).max(7),
  recovery_notes: z.array(z.string().max(200)).max(4),
  progression_rule: z.string().max(300),
  review_trigger: z.string().max(200),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

// ---- schema 2.0: common coach response ---------------------------------------------------
export const CoachStatus = z.enum(['questions_needed', 'draft_ready', 'review_ready', 'suggestion_ready', 'guidance_needed']);

export const CoachOutput = z.object({
  schema_version: z.literal('2.0'),
  status: CoachStatus,
  summary: z.string().max(300),
  assistant_message: z.string().max(2400),
  questions: z.array(z.object({ id: z.string().max(40), text: z.string().min(1).max(240), options: z.array(z.string().max(60)).max(6) })).max(4),
  observations: z.array(z.object({ text: z.string().min(1).max(400), evidence_refs: z.array(z.string().max(80)).max(6) })).max(6),
  assumptions: z.array(z.string().max(240)).max(6),
  limitations: z.array(z.string().max(240)).max(6),
  suggestions: z.array(z.object({
    kind: z.enum(['training', 'routine', 'food', 'recovery']),
    text: z.string().min(1).max(400),
    rationale: z.string().max(400),
    requires_approval: z.boolean(),
  })).max(4),
  candidate_memories: z.array(z.object({ key: z.string().max(60), value: z.string().min(1).max(200), requires_confirmation: z.boolean() })).max(3),
  safety: z.object({ state: z.enum(['none', 'guidance_needed']), message: z.string().max(500).nullable() }),
  plan: PlanDraft.nullable(),
  food_candidates: z.array(z.object({
    catalogue_id: z.string().max(60).nullable(),
    preset_id: z.string().max(80).nullable(),
    name: z.string().min(1).max(60),
    match_uncertainty: z.enum(['low', 'medium', 'high']),
    questions: z.array(z.string().max(200)).max(2),
  })).max(5),
  /** Reserved for the gated measurement_extract stage; always empty in this release. */
  measurement_candidates: z.array(z.object({})).max(0),
});
export type CoachOutput = z.infer<typeof CoachOutput>;

export function emptyOutput(status: z.infer<typeof CoachStatus>, message: string): CoachOutput {
  return {
    schema_version: '2.0', status, summary: message.slice(0, 300), assistant_message: message, questions: [], observations: [],
    assumptions: [], limitations: [], suggestions: [], candidate_memories: [], safety: { state: status === 'guidance_needed' ? 'guidance_needed' : 'none', message: status === 'guidance_needed' ? message : null },
    plan: null, food_candidates: [], measurement_candidates: [],
  };
}

// ---- notebook import (structured extraction, unchanged) ----------------------------------
export const NotebookPhotoOutput = z.object({
  is_workout_notes: z.boolean(),
  exercises: z.array(z.object({
    name: z.string().min(1).max(60),
    sets: z.number().int().min(1).max(10),
    reps_min: z.number().int().min(1).max(100),
    reps_max: z.number().int().min(1).max(100),
    load: z.number().min(0).max(1000).nullable(),
    unit: z.enum(['kg', 'lb']).nullable(),
  })).max(20),
  questions: z.array(z.string().max(200)).max(3),
});
export type NotebookPhotoOutput = z.infer<typeof NotebookPhotoOutput>;

// ---- version-1 compatibility (read-only) -------------------------------------------------
const ReviewOutputV1 = z.object({
  observations: z.array(z.object({ text: z.string(), evidence_refs: z.array(z.string()) })),
  suggestions: z.array(z.object({ kind: z.enum(['habit', 'nutrition', 'training', 'question']), text: z.string(), rationale: z.string(), uncertainty: z.string() })),
  missing_information: z.array(z.string()),
  questions: z.array(z.string()),
  safety_flags: z.array(z.string()),
}).passthrough();

const V1_KIND = { habit: 'routine', nutrition: 'food', training: 'training', question: 'routine' } as const;

/** Read a stored review body of either version as schema 2.0. Never rewrites the stored row. */
export function reviewOutputFromStored(output: unknown): { output: CoachOutput; legacy_v1: boolean } | null {
  const v2 = CoachOutput.safeParse(output);
  if (v2.success) return { output: v2.data, legacy_v1: false };
  const v1 = ReviewOutputV1.safeParse(output);
  if (!v1.success) return null;
  const o = v1.data;
  return {
    legacy_v1: true,
    output: {
      ...emptyOutput('review_ready', ''),
      observations: o.observations.map((x) => ({ text: x.text, evidence_refs: x.evidence_refs })),
      suggestions: o.suggestions.map((x) => ({ kind: V1_KIND[x.kind], text: x.text, rationale: x.rationale, requires_approval: false })),
      limitations: o.missing_information,
      questions: o.questions.map((text, i) => ({ id: `q${i + 1}`, text, options: [] })),
    },
  };
}

// ---- what the function returns to the app ------------------------------------------------
export interface StoredReview {
  id: string;
  created_at: string;
  data_period: { from: string; to: string };
  data_completeness: { days_with_meals: number; days_marked_complete: number; weight_points: number; sessions: number };
  output: CoachOutput;
  legacy_v1?: boolean;
  proposal_id: string | null;
  model_id: string;
  prompt_version: string;
}

export interface StoredDraft {
  id: string;
  created_at: string;
  profile_version: number;
  plan: PlanDraft;
  model_id: string;
  prompt_version: string;
}

export interface ChatReply {
  thread_id: string;
  message_id: string | null;
  output: CoachOutput;
  /** Which recorded period informed the answer, shown under the reply. */
  data_window: { from: string; to: string };
  model_id: string;
  prompt_version: string;
}

export type AiResponse =
  | { status: 'ok'; operation: 'weekly_review'; review: StoredReview }
  | { status: 'ok'; operation: 'coach_question'; reply: ChatReply }
  | { status: 'ok'; operation: 'onboarding_plan'; output: CoachOutput; draft: StoredDraft | null; model_id: string | null }
  | { status: 'ok'; operation: 'photo_suggest'; kind: 'food'; result: CoachOutput; model_id: string }
  | { status: 'ok'; operation: 'photo_suggest'; kind: 'notebook'; result: NotebookPhotoOutput; model_id: string }
  | { status: 'insufficient_data'; message: string }
  | { status: 'safety'; message: string }
  | { status: 'error'; error: AiErrorCode; message: string };

export type AiErrorCode =
  | 'unauthenticated' | 'not_member' | 'consent_required' | 'bad_request' | 'too_large' | 'not_configured'
  | 'limit_user' | 'ai_paused' | 'in_progress' | 'busy' | 'provider_error' | 'invalid_output' | 'stale_profile'
  | 'thread_not_found' | 'method' | 'origin';
