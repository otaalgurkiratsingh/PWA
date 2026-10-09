/**
 * Typed AI request/response contracts shared by the Edge Function and the app.
 * Model output is validated against these schemas before anything is stored or shown.
 */
import { z } from 'zod';

export const PROMPT_VERSION = 'rozana-coach-2026-10-09.1';

export const AiOperation = z.enum(['weekly_review', 'coach_question', 'photo_suggest']);
export type AiOperation = z.infer<typeof AiOperation>;

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export const PresetHint = z.object({ id: z.string().max(80), name: z.string().max(60) });

export const AiRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('weekly_review'), operation_id: Uuid, today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({
    operation: z.literal('coach_question'),
    operation_id: Uuid,
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    question: z.string().trim().min(2).max(500),
  }),
  z.object({
    operation: z.literal('photo_suggest'),
    operation_id: Uuid,
    kind: z.enum(['food', 'notebook']),
    /** Base64 JPEG, already cropped/downscaled/re-encoded on the device (no metadata). */
    image_base64: z.string().min(100).max(2_000_000),
    /** The user's own saved meal names, so the model can suggest a match. */
    presets: z.array(PresetHint).max(60).default([]),
  }),
]);
export type AiRequest = z.infer<typeof AiRequest>;

// ---- model output schemas ------------------------------------------------------
export const ReviewOutput = z.object({
  observations: z.array(z.object({ text: z.string().min(1).max(400), evidence_refs: z.array(z.string().max(80)).min(1).max(6) })).max(6),
  suggestions: z.array(z.object({
    kind: z.enum(['habit', 'nutrition', 'training', 'question']),
    text: z.string().min(1).max(400),
    rationale: z.string().max(400),
    uncertainty: z.enum(['low', 'medium', 'high']),
  })).max(4),
  missing_information: z.array(z.string().max(200)).max(4),
  questions: z.array(z.string().max(200)).max(3),
  proposed_target_change: z.object({
    energy_kcal: z.number().nullable(),
    protein_g: z.number().nullable(),
    rationale: z.string().max(400),
  }).nullable(),
  safety_flags: z.array(z.string().max(100)).max(5),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

export const AnswerOutput = z.object({
  answer: z.string().min(1).max(900),
  evidence_refs: z.array(z.string().max(80)).max(6),
  follow_up_questions: z.array(z.string().max(200)).max(3),
  safety_flags: z.array(z.string().max(100)).max(5),
});
export type AnswerOutput = z.infer<typeof AnswerOutput>;

export const FoodPhotoOutput = z.object({
  is_food: z.boolean(),
  candidates: z.array(z.object({
    name: z.string().min(1).max(60),
    matched_preset_id: z.string().max(80).nullable(),
    confidence: z.enum(['low', 'medium', 'high']),
    portion_hint: z.string().max(80).nullable(),
  })).max(5),
  questions: z.array(z.string().max(200)).max(3),
});
export type FoodPhotoOutput = z.infer<typeof FoodPhotoOutput>;

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

// ---- what the function returns to the app ---------------------------------------
export interface StoredReview {
  id: string;
  created_at: string;
  data_period: { from: string; to: string };
  data_completeness: { days_with_meals: number; days_marked_complete: number; weight_points: number; sessions: number };
  output: ReviewOutput;
  proposal_id: string | null;
  model_id: string;
  prompt_version: string;
}

export type AiResponse =
  | { status: 'ok'; operation: 'weekly_review'; review: StoredReview }
  | { status: 'ok'; operation: 'coach_question'; answer: AnswerOutput; model_id: string }
  | { status: 'ok'; operation: 'photo_suggest'; kind: 'food'; result: FoodPhotoOutput; model_id: string }
  | { status: 'ok'; operation: 'photo_suggest'; kind: 'notebook'; result: NotebookPhotoOutput; model_id: string }
  | { status: 'insufficient_data'; message: string }
  | { status: 'safety'; message: string }
  | { status: 'error'; error: AiErrorCode; message: string };

export type AiErrorCode =
  | 'unauthenticated' | 'not_member' | 'consent_required' | 'bad_request' | 'too_large' | 'not_configured'
  | 'limit_user' | 'ai_paused' | 'in_progress' | 'provider_error' | 'invalid_output' | 'method' | 'origin';
