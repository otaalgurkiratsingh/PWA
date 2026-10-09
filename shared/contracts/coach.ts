import { z } from 'zod';

/**
 * Coach output schema (Phase 2). Defined now so the backend adapter has a fixed contract.
 * Every observation must reference evidence; unsupported claims are rejected by validation.
 */
export const EvidenceRef = z.object({
  kind: z.enum(['log', 'metric']),
  id: z.string().max(100),
});

export const CoachSuggestion = z.object({
  kind: z.enum(['habit', 'nutrition', 'training', 'question']),
  text: z.string().max(600),
  rationale: z.string().max(600),
  uncertainty: z.enum(['low', 'medium', 'high']),
  /** Optional plan change; always a proposal requiring explicit user approval. */
  plan_patch: z.unknown().nullable(),
});

export const CoachReview = z.object({
  data_period: z.object({ from: z.string(), to: z.string() }),
  data_completeness: z.object({
    days_with_meals: z.number().int().nonnegative(),
    days_marked_complete: z.number().int().nonnegative(),
    weight_points: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
  }),
  observations: z.array(z.object({ text: z.string().max(600), evidence_refs: z.array(EvidenceRef).min(1) })).max(8),
  suggestions: z.array(CoachSuggestion).max(5),
  questions: z.array(z.string().max(300)).max(5),
  safety_flags: z.array(z.string().max(100)),
  model_id: z.string(),
  prompt_version: z.string(),
});
export type CoachReview = z.infer<typeof CoachReview>;
