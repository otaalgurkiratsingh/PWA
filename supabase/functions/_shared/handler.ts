/**
 * AI request handler with injected dependencies (pure — testable without Deno or network).
 *
 * Order matters: every check that can refuse a request runs BEFORE the quota reservation,
 * and the reservation (covering every allowed attempt) runs BEFORE any model call. Unknown,
 * expired, unapproved or non-consenting callers therefore consume zero model calls.
 *
 * Every coach operation uses one versioned system prompt (coachPrompt.ts) and schema 2.0.
 */
import { z } from 'zod';
import {
  AiRequest,
  CoachOutput,
  NotebookPhotoOutput,
  SCHEMA_VERSION,
  emptyOutput,
  type AiErrorCode,
  type AiResponse,
  type StoredDraft,
  type StoredReview,
} from './aiContracts.ts';
import { COACH_SYSTEM_PROMPT, PROMPT_VERSION } from './coachPrompt.ts';
import { buildEnvelope, estimateTokens, fitConversation, readProfile, type ProfileView } from './envelope.ts';
import { reservationUsd, actualUsd, ProviderError, type ModelResult, type ModelUsage, type Pricing } from './gemini.ts';
import { checkJpeg, decodeBase64 } from './image.ts';
import { allowedExercises, checkPlan, missingAnswers } from './planRules.ts';
import { notebookPhotoSystem, screenText, urgentSafetyMessage, userTurn } from './prompts.ts';
import { hasEnoughForReview, type DocRow } from './summary.ts';

export const MAX_BODY_BYTES = 2_500_000;

export interface UserScopedDb {
  membership(): Promise<string>;
  /** Latest ai_processing decision in the consent ledger. */
  aiConsent(): Promise<boolean>;
  /** Latest ai_images decision in the consent ledger (separate permission). */
  imageConsent(): Promise<boolean>;
  documents(collections: readonly string[]): Promise<DocRow[]>;
  memory(): Promise<string[]>;
  /** Messages of one of the caller's own, unexpired threads (oldest first); null if not theirs/expired. */
  thread(threadId: string): Promise<{ role: 'user' | 'assistant'; text: string }[] | null>;
  /** The caller's own stored photos by id (base64 JPEG + slot); others' ids simply return nothing. */
  photos(ids: readonly string[]): Promise<{ id: string; slot: string; base64: string }[]>;
}

export type ReserveResult =
  | { status: 'reserved'; request_id: string }
  | { status: 'done'; request_id: string; result: unknown }
  | { status: 'in_progress' | 'busy' | 'failed' | 'not_member' | 'limit_user' | 'limit_budget' | 'disabled' };

export interface AdminDb {
  reserve(user: string, operationId: string, operation: string, usd: number, timezone: string): Promise<ReserveResult>;
  finish(requestId: string, user: string, status: 'succeeded' | 'failed', actualUsd: number | null, result: unknown, usage: ModelUsage | null, error: string | null): Promise<void>;
  storeReview(user: string, review: Omit<StoredReview, 'id' | 'created_at' | 'proposal_id'>): Promise<{ id: string; created_at: string }>;
  storeExchange(a: { user: string; threadId: string | null; clientOpId: string; userText: string; assistantText: string; response: unknown; modelId: string; promptVersion: string }): Promise<{ status: string; thread_id?: string; assistant_message_id?: string }>;
  storePlanDraft(a: { user: string; profileVersion: number; source: 'onboarding' | 'chat'; plan: unknown; response: unknown; modelId: string; promptVersion: string }): Promise<{ id: string; created_at: string }>;
}

/** Measured ceilings (configurable in code; the prompt cannot enforce them). */
export interface AiLimits {
  chatInputTokens: number;
  chatOutputTokens: number;
  chatMessages: number;
  reviewInputTokens: number;
  reviewOutputTokens: number;
  planInputTokens: number;
  planOutputTokens: number;
  planRetries: number;
  photoInputTokens: number;
  photoOutputTokens: number;
  /** Tokens reserved per image (conservative; verify against provider usage). */
  imageTokens: number;
  /** Extra output reserved for billable thinking, as a multiple of the output cap. */
  thinkingFactor: number;
}

export const DEFAULT_LIMITS: AiLimits = {
  // The owner-supplied V2 system prompt alone is ~4–4.7k tokens, so the spec's "about 6,000"
  // could not hold any history; 8,000 keeps up to 8 recent messages (decision D21).
  chatInputTokens: 8000,
  chatOutputTokens: 1200,
  chatMessages: 8,
  reviewInputTokens: 12_000,
  reviewOutputTokens: 2048,
  planInputTokens: 9000,
  planOutputTokens: 6000,
  planRetries: 1,
  photoInputTokens: 6000,
  photoOutputTokens: 1024,
  imageTokens: 1300,
  thinkingFactor: 1,
};

export interface HandlerConfig {
  apiKey: string | null;
  modelId: string;
  style: 'generate_content' | 'interactions';
  pricing: Pricing | null;
  allowedOrigins: readonly string[];
  timeoutMs: number;
  limits?: Partial<AiLimits>;
  /** Compact food list (id + name) for food photo matching. */
  catalogue?: readonly { id: string; name: string }[];
}

export interface HandlerDeps {
  config: HandlerConfig;
  verifyToken(token: string): Promise<{ sub: string } | null>;
  userDb(token: string): UserScopedDb;
  admin: AdminDb;
  callModel(req: { system: string; text: string; images?: string[]; jsonSchema: Record<string, unknown>; maxOutputTokens: number }): Promise<ModelResult>;
}

function cors(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const ok = origin !== null && allowed.includes(origin);
  return {
    ...(ok ? { 'access-control-allow-origin': origin! } : {}),
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

const json = (status: number, body: AiResponse | Record<string, unknown>, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } });

const fail = (status: number, error: AiErrorCode, message: string, headers: Record<string, string>) =>
  json(status, { status: 'error', error, message }, headers);

const COLLECTIONS = ['settings', 'meal_entries', 'daily_log_status', 'weight_entries', 'workout_sessions', 'daily_health', 'presets', 'foods', 'programs'] as const;

const COACH_SCHEMA = z.toJSONSchema(CoachOutput) as Record<string, unknown>;
const NOTEBOOK_SCHEMA = z.toJSONSchema(NotebookPhotoOutput) as Record<string, unknown>;

const SCREENING_GUIDANCE = 'Thanks for answering the pre-exercise questions. Because something came up, please talk to a doctor or a qualified exercise professional before starting a new routine. TrainLuma can’t give medical clearance. You can keep logging meals and workouts, and come back to planning once you have their advice.';

/** Remove unsafe text, ungrounded observations and anything this operation may not return. */
function clean(out: CoachOutput, validRefs: ReadonlySet<string>, opts: { allowPlan: boolean; allowFood: boolean; requireEvidence: boolean }): { out: CoachOutput; flags: string[] } {
  const flags: string[] = [];
  let o: CoachOutput = { ...out, schema_version: '2.0', measurement_candidates: [] };
  const observations = o.observations
    .map((x) => ({ ...x, evidence_refs: x.evidence_refs.filter((r) => validRefs.has(r)) }))
    .filter((x) => (!opts.requireEvidence || x.evidence_refs.length > 0) && screenText(x.text).ok);
  if (observations.length < o.observations.length) flags.push('removed_ungrounded_or_unsafe');
  const suggestions = o.suggestions.filter((s) => screenText(`${s.text} ${s.rationale}`).ok).map((s) => ({ ...s, requires_approval: true }));
  if (suggestions.length < o.suggestions.length) flags.push('removed_unsafe_text');
  const memories = o.candidate_memories.filter((m) => screenText(m.value).ok).map((m) => ({ ...m, requires_confirmation: true }));
  o = { ...o, observations, suggestions, candidate_memories: memories };
  if (!opts.allowFood) o = { ...o, food_candidates: [] };
  if (!opts.allowPlan && o.plan) {
    flags.push('plan_needs_plan_operation');
    o = { ...o, plan: null, status: o.status === 'draft_ready' ? 'suggestion_ready' : o.status };
  }
  if (!screenText(`${o.assistant_message} ${o.summary}`).ok) {
    flags.push('removed_unsafe_text');
    o = { ...emptyOutput('guidance_needed', 'I can’t help with that safely. For anything medical, a doctor, physiotherapist or registered dietitian is the right person to ask.') };
  }
  return { out: o, flags };
}

export async function handleAiRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const L: AiLimits = { ...DEFAULT_LIMITS, ...deps.config.limits };
  const origin = req.headers.get('origin');
  const h = cors(origin, deps.config.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return fail(405, 'method', 'Use POST.', h);
  // CORS is not authorization, but browsers from other sites are refused early.
  if (origin !== null && !deps.config.allowedOrigins.includes(origin)) return fail(403, 'origin', 'Origin not allowed.', h);

  // 1. Identity from a verified token only (never from the body).
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (!token) return fail(401, 'unauthenticated', 'Please sign in again.', h);
  const claims = await deps.verifyToken(token).catch(() => null);
  if (!claims?.sub) return fail(401, 'unauthenticated', 'Please sign in again.', h);
  const user = claims.sub;

  // 2. Bounded, validated body. Unknown fields (e.g. a forged user_id) are ignored by the schema.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return fail(413, 'too_large', 'That request is too large.', h);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', 'That request is too large.', h);
  let parsed: AiRequest;
  try {
    const r = AiRequest.safeParse(JSON.parse(raw));
    if (!r.success) {
      const tooLong = r.error.issues.some((i) => i.code === 'too_big' && i.path[0] === 'message');
      return tooLong ? fail(413, 'too_large', 'That message is too long. Please shorten it.', h) : fail(400, 'bad_request', 'The request was not understood.', h);
    }
    parsed = r.data;
  } catch {
    return fail(400, 'bad_request', 'The request was not understood.', h);
  }

  // 3. Membership + consent through the caller's own (RLS-scoped) access.
  const db = deps.userDb(token);
  if ((await db.membership()) !== 'active') return fail(403, 'not_member', 'This account is not active.', h);
  if (!(await db.aiConsent())) return fail(403, 'consent_required', 'Turn on AI help in Settings first.', h);
  if (!deps.config.apiKey || !deps.config.pricing) return fail(503, 'not_configured', 'The coach is not set up yet.', h);
  const pricing = deps.config.pricing;
  const op = parsed.operation;

  // 4. Requests that never need the model.
  const untrustedText = parsed.operation === 'coach_question' ? parsed.message : parsed.operation === 'onboarding_plan' ? parsed.instruction : '';
  const urgent = untrustedText ? urgentSafetyMessage(untrustedText) : null;
  if (urgent) return json(200, { status: 'safety', message: urgent }, h);

  let history: { role: 'user' | 'assistant'; text: string }[] = [];
  if (parsed.operation === 'coach_question' && parsed.thread_id) {
    const t = await db.thread(parsed.thread_id);
    if (!t) return fail(404, 'thread_not_found', 'That chat was deleted or has expired. Start a new chat.', h);
    history = t;
  }

  let notebookImage: string | undefined;
  let foodImage: string | undefined;
  if (parsed.operation === 'photo_suggest') {
    const bytes = decodeBase64(parsed.image_base64);
    const check = bytes ? checkJpeg(bytes) : ({ ok: false, reason: 'not base64' } as const);
    if (!check.ok) return fail(400, 'bad_request', `Photo rejected: ${check.reason}.`, h);
    if (parsed.kind === 'notebook') notebookImage = parsed.image_base64;
    else foodImage = parsed.image_base64;
  }

  const rows = parsed.operation === 'photo_suggest' && parsed.kind === 'notebook' ? [] : await db.documents(COLLECTIONS);
  const profile: ProfileView = readProfile(rows);
  const memory = parsed.operation === 'photo_suggest' ? [] : await db.memory();

  // Onboarding plan pre-checks: current profile version, required answers, screening outcome.
  let planImages: { id: string; slot: string; base64: string }[] = [];
  let allowed: ReturnType<typeof allowedExercises> = [];
  if (parsed.operation === 'onboarding_plan') {
    if (parsed.profile_version !== profile.version) {
      return fail(409, 'stale_profile', 'Your answers changed since you reviewed them. Review them again, then generate.', h);
    }
    const missing = missingAnswers(profile.training, profile.adult);
    if (missing.length) {
      const out = { ...emptyOutput('questions_needed', 'A few answers are still needed before a plan can be drafted.'), questions: missing.slice(0, 4).map((text, i) => ({ id: `missing_${i + 1}`, text, options: [] })) };
      return json(200, { status: 'ok', operation: 'onboarding_plan', output: out, draft: null, model_id: null }, h);
    }
    if (profile.training!.screening === 'has_concerns') {
      return json(200, { status: 'ok', operation: 'onboarding_plan', output: emptyOutput('guidance_needed', SCREENING_GUIDANCE), draft: null, model_id: null }, h);
    }
    allowed = allowedExercises(profile.training!);
    if (allowed.length < 3) {
      const out = { ...emptyOutput('questions_needed', 'There aren’t enough exercises for the equipment you listed.'), questions: [{ id: 'equipment', text: 'Which equipment can you use? Bodyweight-only plans need a little more detail about what feels comfortable.', options: [] }] };
      return json(200, { status: 'ok', operation: 'onboarding_plan', output: out, draft: null, model_id: null }, h);
    }
    // Photos only with the separate AI-image permission; otherwise the plan uses answers alone.
    if ((parsed.photo_ids.length || parsed.inline_photos.length) && (await db.imageConsent())) {
      const owned = parsed.photo_ids.length ? await db.photos(parsed.photo_ids) : [];
      const inline = parsed.inline_photos.map((p, i) => ({ id: `inline-${i}`, slot: p.slot, base64: p.image_base64 }));
      planImages = [...owned, ...inline].filter((p) => {
        const bytes = decodeBase64(p.base64);
        return bytes !== null && checkJpeg(bytes).ok;
      }).slice(0, 5);
    }
  }

  // 5. Build the input within the measured ceiling.
  let text: string;
  let validRefs: Set<string>;
  let dataWindow = { from: '', to: '' };
  let inputCap: number;
  let outputCap: number;
  let images: string[] | undefined;
  let schema = COACH_SCHEMA;
  let system = COACH_SYSTEM_PROMPT;
  let ctxForReview: ReturnType<typeof buildEnvelope>['ctx'] | null = null;

  if (parsed.operation === 'photo_suggest' && parsed.kind === 'notebook') {
    system = notebookPhotoSystem();
    schema = NOTEBOOK_SCHEMA;
    text = 'Extract the exercises.';
    validRefs = new Set();
    inputCap = L.photoInputTokens;
    outputCap = L.photoOutputTokens;
    images = [notebookImage!];
  } else if (parsed.operation === 'photo_suggest') {
    const env = buildEnvelope({ operation: 'photo_suggest', rows, today: new Date().toISOString().slice(0, 10), memory, profile });
    const body = {
      operation: 'photo_suggest',
      requested_output_schema_version: '2.0',
      enabled_capabilities: ['text_chat'],
      nutrition_preferences: env.json.nutrition_preferences,
      catalogue_candidates: (deps.config.catalogue ?? []).map((c) => [c.id, c.name]),
      optional_images: [{ role: 'food_photo' }],
    };
    text = userTurn('photo_suggest', body, 'Match the food photo to catalogue ids or the person\'s usual foods. Never give nutrition numbers.');
    validRefs = new Set();
    inputCap = L.photoInputTokens + L.imageTokens;
    outputCap = L.photoOutputTokens;
    images = [foodImage!];
  } else if (parsed.operation === 'weekly_review') {
    const env = buildEnvelope({ operation: 'weekly_review', rows, today: parsed.today, memory, profile });
    if (!hasEnoughForReview(env.ctx)) {
      return json(200, { status: 'insufficient_data', message: 'Log a few meals, workouts or weigh-ins this week and the review will have something real to say.' }, h);
    }
    ctxForReview = env.ctx;
    text = userTurn('weekly_review', env.json, 'Each observation must cite evidence refs from valid_evidence_refs.');
    validRefs = new Set(env.ctx.valid_refs);
    dataWindow = env.ctx.period;
    inputCap = L.reviewInputTokens;
    outputCap = L.reviewOutputTokens;
  } else if (parsed.operation === 'coach_question') {
    const base = buildEnvelope({ operation: 'coach_question', rows, today: parsed.today, memory, profile, message: parsed.message, conversation: [] });
    const baseTokens = estimateTokens(COACH_SYSTEM_PROMPT) + estimateTokens(userTurn('coach_question', base.json)) + 50;
    // Trim old history before ever rejecting a valid message.
    const convo = fitConversation(history, L.chatMessages, Math.max(0, L.chatInputTokens - baseTokens));
    let env = buildEnvelope({ operation: 'coach_question', rows, today: parsed.today, memory, profile, message: parsed.message, conversation: convo });
    text = userTurn('coach_question', env.json);
    if (estimateTokens(COACH_SYSTEM_PROMPT) + estimateTokens(text) > L.chatInputTokens) {
      // Still too big (a very full journal): drop per-day detail and per-exercise bests.
      const lean = { ...env.json, history: { period: env.ctx.period, completeness: env.ctx.completeness, weights: env.ctx.weights, steps: env.ctx.steps } };
      text = userTurn('coach_question', lean);
      env = { ...env, json: lean };
      if (estimateTokens(COACH_SYSTEM_PROMPT) + estimateTokens(text) > L.chatInputTokens) return fail(413, 'too_large', 'That message is too long. Please shorten it.', h);
    }
    validRefs = new Set(env.ctx.valid_refs);
    dataWindow = env.ctx.period;
    inputCap = L.chatInputTokens;
    outputCap = L.chatOutputTokens;
  } else {
    const env = buildEnvelope({
      operation: 'onboarding_plan', rows, today: parsed.today, memory, profile, allowed, instruction: parsed.instruction,
      images: planImages.map((p) => ({ role: p.slot === 'inspiration' ? 'inspiration' : `current_${p.slot}` })),
    });
    text = userTurn('onboarding_plan', env.json, 'Return a plan draft that uses only allowed_exercises ids and fits availability and minutes_per_session.');
    validRefs = new Set(env.ctx.valid_refs);
    dataWindow = env.ctx.period;
    inputCap = L.planInputTokens + planImages.length * L.imageTokens;
    outputCap = L.planOutputTokens;
    images = planImages.length ? planImages.map((p) => p.base64) : undefined;
  }

  const attempts = parsed.operation === 'onboarding_plan' ? 1 + L.planRetries : 1;

  // 6. Transactional reservation for the maximum cost of every allowed attempt.
  const reserveUsd = attempts * reservationUsd(pricing, inputCap + 1500, outputCap * (1 + L.thinkingFactor));
  const reserve = await deps.admin.reserve(user, parsed.operation_id, op, reserveUsd, parsed.timezone);
  switch (reserve.status) {
    case 'reserved':
      break;
    case 'done':
      return json(200, reserve.result as AiResponse, h);
    case 'in_progress':
      return fail(409, 'in_progress', 'Still working on that. Try again in a moment.', h);
    case 'busy':
      return fail(409, 'busy', 'The coach is still answering your last request. Try again in a moment.', h);
    case 'failed':
      return fail(409, 'provider_error', 'That attempt failed. Start a new request.', h);
    case 'not_member':
      return fail(403, 'not_member', 'This account is not active.', h);
    case 'limit_user':
      return fail(429, 'limit_user', op === 'weekly_review' ? 'One new review per week.' : op === 'onboarding_plan' ? 'You’ve used this week’s plan drafts. You can still edit your plan by hand.' : 'Daily limit reached. It resets tomorrow.', h);
    default:
      return fail(503, 'ai_paused', 'The coach is paused for now. Logging still works.', h);
  }
  const requestId = reserve.request_id;

  // 7. Model call(s). Only the plan operation retries, once, and only after an INVALID answer
  //    (never after an unknown provider outcome such as a timeout).
  const usageTotal: ModelUsage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 };
  let usageKnown = true;
  const addUsage = (u: ModelUsage) => {
    if (u.input_tokens === null || u.output_tokens === null) usageKnown = false;
    usageTotal.input_tokens = (usageTotal.input_tokens ?? 0) + (u.input_tokens ?? 0);
    usageTotal.output_tokens = (usageTotal.output_tokens ?? 0) + (u.output_tokens ?? 0);
    usageTotal.thinking_tokens = (usageTotal.thinking_tokens ?? 0) + (u.thinking_tokens ?? 0);
    usageTotal.total_tokens = (usageTotal.total_tokens ?? 0) + (u.total_tokens ?? 0);
  };
  const cost = () => (usageKnown ? actualUsd(pricing, usageTotal) : null);

  let feedback = '';
  let lastError = 'invalid output';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let model: ModelResult;
    try {
      model = await deps.callModel({ system, text: feedback ? `${text}\n\nPREVIOUS DRAFT WAS REJECTED BY VALIDATION:\n${feedback}\nReturn a corrected draft.` : text, images, jsonSchema: schema, maxOutputTokens: outputCap });
    } catch (e) {
      await deps.admin.finish(requestId, user, 'failed', cost(), null, usageTotal, e instanceof ProviderError ? e.message : 'provider error');
      return fail(502, 'provider_error', 'The coach could not answer right now. Logging still works. Your message is kept, so you can try again.', h);
    }
    addUsage(model.usage);

    if (parsed.operation === 'photo_suggest' && parsed.kind === 'notebook') {
      const nb = NotebookPhotoOutput.safeParse(model.json);
      if (!nb.success) break;
      const response: AiResponse = { status: 'ok', operation: 'photo_suggest', kind: 'notebook', model_id: deps.config.modelId, result: { ...nb.data, exercises: nb.data.exercises.map((x) => ({ ...x, reps_max: Math.max(x.reps_min, x.reps_max) })) } };
      await deps.admin.finish(requestId, user, 'succeeded', cost(), response, usageTotal, null);
      return json(200, response, h);
    }

    const parsedOut = CoachOutput.safeParse(model.json);
    if (!parsedOut.success) {
      lastError = 'invalid output';
      feedback = 'The JSON did not match the schema.';
      continue;
    }

    if (parsed.operation === 'weekly_review') {
      const { out, flags } = clean({ ...parsedOut.data, status: 'review_ready' }, validRefs, { allowPlan: false, allowFood: false, requireEvidence: true });
      const base = {
        data_period: ctxForReview!.period,
        data_completeness: ctxForReview!.completeness,
        output: { ...out, limitations: [...out.limitations, ...flags.map((f) => `(${f.replaceAll('_', ' ')})`)].slice(0, 6) },
        model_id: deps.config.modelId,
        prompt_version: PROMPT_VERSION,
      };
      const stored = await deps.admin.storeReview(user, base);
      const response: AiResponse = { status: 'ok', operation: 'weekly_review', review: { ...base, ...stored, proposal_id: null } };
      await deps.admin.finish(requestId, user, 'succeeded', cost(), response, usageTotal, null);
      return json(200, response, h);
    }

    if (parsed.operation === 'coach_question') {
      const { out } = clean(parsedOut.data, validRefs, { allowPlan: false, allowFood: false, requireEvidence: false });
      const assistantText = out.assistant_message.trim() || out.summary.trim() || 'I don’t have enough information to answer that yet.';
      // Recheck permission and membership at persistence time (inside the RPC).
      const saved = await deps.admin.storeExchange({
        user, threadId: parsed.thread_id, clientOpId: parsed.operation_id, userText: parsed.message, assistantText,
        response: out, modelId: deps.config.modelId, promptVersion: PROMPT_VERSION,
      });
      if (saved.status === 'not_allowed' || saved.status === 'thread_not_found') {
        await deps.admin.finish(requestId, user, 'failed', cost(), null, usageTotal, `not persisted: ${saved.status}`);
        return saved.status === 'not_allowed'
          ? fail(403, 'consent_required', 'AI help was turned off or the account changed. Nothing was saved.', h)
          : fail(404, 'thread_not_found', 'That chat was deleted or has expired. Start a new chat.', h);
      }
      const response: AiResponse = {
        status: 'ok', operation: 'coach_question',
        reply: { thread_id: saved.thread_id!, message_id: saved.assistant_message_id ?? null, output: { ...out, assistant_message: assistantText }, data_window: dataWindow, model_id: deps.config.modelId, prompt_version: PROMPT_VERSION },
      };
      await deps.admin.finish(requestId, user, 'succeeded', cost(), response, usageTotal, null);
      return json(200, response, h);
    }

    if (parsed.operation === 'photo_suggest') {
      const { out } = clean(parsedOut.data, validRefs, { allowPlan: false, allowFood: true, requireEvidence: false });
      const catIds = new Set((deps.config.catalogue ?? []).map((c) => c.id));
      const presetIds = new Set(rows.filter((r) => r.collection === 'presets').map((r) => r.doc_id));
      const food_candidates = out.food_candidates.map((c) => ({
        ...c,
        catalogue_id: c.catalogue_id && catIds.has(c.catalogue_id) ? c.catalogue_id : null,
        preset_id: c.preset_id && presetIds.has(c.preset_id) ? c.preset_id : null,
      }));
      const response: AiResponse = { status: 'ok', operation: 'photo_suggest', kind: 'food', model_id: deps.config.modelId, result: { ...out, food_candidates } };
      await deps.admin.finish(requestId, user, 'succeeded', cost(), response, usageTotal, null);
      return json(200, response, h);
    }

    // onboarding_plan
    const { out } = clean(parsedOut.data, validRefs, { allowPlan: true, allowFood: false, requireEvidence: false });
    if (!out.plan) {
      if (out.status === 'questions_needed' || out.status === 'guidance_needed') {
        const response: AiResponse = { status: 'ok', operation: 'onboarding_plan', output: out, draft: null, model_id: deps.config.modelId };
        await deps.admin.finish(requestId, user, 'succeeded', cost(), response, usageTotal, null);
        return json(200, response, h);
      }
      lastError = 'no plan in draft';
      feedback = 'status was draft_ready but plan was null.';
      continue;
    }
    const check = checkPlan(out.plan, profile.training!, allowed, profile.units, profile.version);
    if (!check.ok) {
      lastError = `plan rejected: ${check.errors.join(' | ')}`.slice(0, 300);
      feedback = check.errors.join('\n');
      continue;
    }
    const output: CoachOutput = { ...out, status: 'draft_ready', plan: check.plan };
    const stored = await deps.admin.storePlanDraft({ user, profileVersion: profile.version, source: parsed.source, plan: check.plan, response: { ...output, plan: null }, modelId: deps.config.modelId, promptVersion: PROMPT_VERSION });
    const draft: StoredDraft = { id: stored.id, created_at: stored.created_at, profile_version: profile.version, plan: check.plan, model_id: deps.config.modelId, prompt_version: PROMPT_VERSION };
    const response: AiResponse = { status: 'ok', operation: 'onboarding_plan', output, draft, model_id: deps.config.modelId };
    await deps.admin.finish(requestId, user, 'succeeded', cost(), response, usageTotal, null);
    return json(200, response, h);
  }

  // Every attempt was invalid: nothing is stored or activated.
  await deps.admin.finish(requestId, user, 'failed', cost(), null, usageTotal, lastError);
  return fail(502, 'invalid_output', op === 'onboarding_plan'
    ? 'The coach couldn’t produce a plan that fits your answers. Your answers are saved; try again later or build your plan by hand.'
    : 'The coach gave an unusable answer. Please try again later.', h);
}

export { SCHEMA_VERSION };
