/**
 * AI request handler with injected dependencies (pure — testable without Deno or network).
 *
 * Order matters: every check that can refuse a request runs BEFORE the quota reservation,
 * and the reservation runs BEFORE the model call. Unknown, expired, unapproved or
 * non-consenting callers therefore consume zero model calls.
 */
import { z } from 'zod';
import {
  AiRequest,
  AnswerOutput,
  FoodPhotoOutput,
  NotebookPhotoOutput,
  PROMPT_VERSION,
  ReviewOutput,
  type AiErrorCode,
  type AiResponse,
  type StoredReview,
} from './aiContracts.ts';
import { reservationUsd, actualUsd, ProviderError, type ModelResult, type ModelUsage, type Pricing } from './gemini.ts';
import { checkJpeg, decodeBase64 } from './image.ts';
import { dataBlock, foodPhotoSystem, notebookPhotoSystem, questionSystem, reviewSystem, screenText, urgentSafetyMessage } from './prompts.ts';
import { buildContext, hasEnoughForReview, type DocRow } from './summary.ts';

export const MAX_BODY_BYTES = 2_500_000;

export interface UserScopedDb {
  membership(): Promise<string>;
  aiConsent(): Promise<boolean>;
  documents(collections: readonly string[]): Promise<DocRow[]>;
  memory(): Promise<string[]>;
}

export type ReserveResult =
  | { status: 'reserved'; request_id: string }
  | { status: 'done'; request_id: string; result: unknown }
  | { status: 'in_progress' | 'failed' | 'not_member' | 'limit_user' | 'limit_budget' | 'disabled' };

export interface AdminDb {
  reserve(user: string, operationId: string, operation: string, usd: number): Promise<ReserveResult>;
  finish(requestId: string, user: string, status: 'succeeded' | 'failed', actualUsd: number | null, result: unknown, usage: ModelUsage | null, error: string | null): Promise<void>;
  storeReview(user: string, review: Omit<StoredReview, 'id' | 'created_at' | 'proposal_id'>, proposal: { before: unknown; after: unknown } | null): Promise<{ id: string; created_at: string; proposal_id: string | null }>;
}

export interface HandlerConfig {
  apiKey: string | null;
  modelId: string;
  style: 'generate_content' | 'interactions';
  pricing: Pricing | null;
  allowedOrigins: readonly string[];
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface HandlerDeps {
  config: HandlerConfig;
  verifyToken(token: string): Promise<{ sub: string } | null>;
  userDb(token: string): UserScopedDb;
  admin: AdminDb;
  callModel(req: { system: string; text: string; imageJpegBase64?: string; jsonSchema: Record<string, unknown> }): Promise<ModelResult>;
}

const MAX_INPUT_TOKENS = { weekly_review: 12_000, coach_question: 10_000, photo_suggest: 4_000 } as const;

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

export async function handleAiRequest(req: Request, deps: HandlerDeps): Promise<Response> {
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

  // 2. Bounded, validated body.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return fail(413, 'too_large', 'That request is too large.', h);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', 'That request is too large.', h);
  let parsed: AiRequest;
  try {
    const r = AiRequest.safeParse(JSON.parse(raw));
    if (!r.success) return fail(400, 'bad_request', 'The request was not understood.', h);
    parsed = r.data;
  } catch {
    return fail(400, 'bad_request', 'The request was not understood.', h);
  }

  // 3. Membership + consent through the caller's own (RLS-scoped) access.
  const db = deps.userDb(token);
  if ((await db.membership()) !== 'active') return fail(403, 'not_member', 'This account is not active.', h);
  if (!(await db.aiConsent())) return fail(403, 'consent_required', 'Turn on AI help in Settings first.', h);
  if (!deps.config.apiKey || !deps.config.pricing) return fail(503, 'not_configured', 'The coach is not set up yet.', h);

  // 4. Requests that never need the model.
  if (parsed.operation === 'coach_question') {
    const urgent = urgentSafetyMessage(parsed.question);
    if (urgent) return json(200, { status: 'safety', message: urgent }, h);
  }
  let imageB64: string | undefined;
  if (parsed.operation === 'photo_suggest') {
    const bytes = decodeBase64(parsed.image_base64);
    const check = bytes ? checkJpeg(bytes) : ({ ok: false, reason: 'not base64' } as const);
    if (!check.ok) return fail(400, 'bad_request', `Photo rejected: ${check.reason}.`, h);
    imageB64 = parsed.image_base64;
  }
  let ctx: ReturnType<typeof buildContext> | null = null;
  if (parsed.operation !== 'photo_suggest') {
    const days = parsed.operation === 'weekly_review' ? 7 : 14;
    const docs = await db.documents(['settings', 'meal_entries', 'daily_log_status', 'weight_entries', 'workout_sessions', 'daily_health']);
    ctx = buildContext(docs, parsed.today, days, await db.memory());
    if (parsed.operation === 'weekly_review' && !hasEnoughForReview(ctx)) {
      return json(200, { status: 'insufficient_data', message: 'Log a few meals, workouts or weigh-ins this week and the review will have something real to say.' }, h);
    }
  }

  // 5. Transactional reservation (idempotent per operation_id; per-user limits; global budget).
  const op = parsed.operation;
  const reserve = await deps.admin.reserve(user, parsed.operation_id, op, reservationUsd(deps.config.pricing, MAX_INPUT_TOKENS[op], deps.config.maxOutputTokens));
  switch (reserve.status) {
    case 'reserved':
      break;
    case 'done':
      return json(200, reserve.result as AiResponse, h);
    case 'in_progress':
      return fail(409, 'in_progress', 'Still working on that — try again in a moment.', h);
    case 'failed':
      return fail(409, 'provider_error', 'That attempt failed. Start a new request.', h);
    case 'not_member':
      return fail(403, 'not_member', 'This account is not active.', h);
    case 'limit_user':
      return fail(429, 'limit_user', op === 'weekly_review' ? 'One new review per week.' : 'Daily limit reached. It resets tomorrow.', h);
    default:
      return fail(503, 'ai_paused', 'The coach is paused for now. Logging still works.', h);
  }
  const requestId = reserve.request_id;

  // 6. One model call. No automatic retries.
  let schema: z.ZodType;
  let system: string;
  let text: string;
  if (op === 'weekly_review') {
    schema = ReviewOutput;
    system = reviewSystem();
    text = dataBlock(ctx!);
  } else if (op === 'coach_question') {
    schema = AnswerOutput;
    system = questionSystem();
    text = `${dataBlock(ctx!)}\n\nQUESTION (untrusted): ${JSON.stringify(parsed.question)}`;
  } else if (parsed.kind === 'food') {
    schema = FoodPhotoOutput;
    system = foodPhotoSystem();
    text = `SAVED_MEALS (untrusted): ${JSON.stringify(parsed.presets)}`;
  } else {
    schema = NotebookPhotoOutput;
    system = notebookPhotoSystem();
    text = 'Extract the exercises.';
  }

  let model: ModelResult;
  try {
    model = await deps.callModel({ system, text, imageJpegBase64: imageB64, jsonSchema: z.toJSONSchema(schema) as Record<string, unknown> });
  } catch (e) {
    await deps.admin.finish(requestId, user, 'failed', null, null, null, e instanceof ProviderError ? e.message : 'provider error');
    return fail(502, 'provider_error', 'The coach could not answer right now. Logging still works.', h);
  }
  const cost = actualUsd(deps.config.pricing, model.usage);
  const out = schema.safeParse(model.json);
  if (!out.success) {
    await deps.admin.finish(requestId, user, 'failed', cost, null, model.usage, 'invalid output');
    return fail(502, 'invalid_output', 'The coach gave an unusable answer. Please try again later.', h);
  }

  // 7. Post-validation: drop ungrounded or unsafe content.
  let response: AiResponse;
  if (op === 'weekly_review') {
    const r = out.data as ReviewOutput;
    const valid = new Set(ctx!.valid_refs);
    const flags = new Set(r.safety_flags);
    const observations = r.observations
      .map((o) => ({ ...o, evidence_refs: o.evidence_refs.filter((x) => valid.has(x)) }))
      .filter((o) => o.evidence_refs.length > 0 && screenText(o.text).ok);
    if (observations.length < r.observations.length) flags.add('removed_ungrounded_or_unsafe');
    const suggestions = r.suggestions.filter((s) => screenText(`${s.text} ${s.rationale}`).ok);
    if (suggestions.length < r.suggestions.length) flags.add('removed_unsafe_text');
    let proposal: { before: unknown; after: unknown } | null = null;
    const t = r.proposed_target_change;
    if (t && ctx!.targets) {
      const sane = (t.energy_kcal === null || (t.energy_kcal >= 1200 && t.energy_kcal <= 4500)) && (t.protein_g === null || (t.protein_g >= 40 && t.protein_g <= 300));
      if (sane && screenText(t.rationale).ok && (t.energy_kcal !== null || t.protein_g !== null)) {
        proposal = {
          before: ctx!.targets,
          after: { energy_kcal: t.energy_kcal ?? ctx!.targets.energy_kcal, protein_g: t.protein_g ?? ctx!.targets.protein_g, rationale: t.rationale },
        };
      } else flags.add('dropped_target_proposal');
    }
    const cleaned: ReviewOutput = { ...r, observations, suggestions, safety_flags: [...flags], proposed_target_change: proposal ? r.proposed_target_change : null };
    const base = {
      data_period: ctx!.period,
      data_completeness: ctx!.completeness,
      output: cleaned,
      model_id: deps.config.modelId,
      prompt_version: PROMPT_VERSION,
    };
    const stored = await deps.admin.storeReview(user, base, proposal);
    response = { status: 'ok', operation: 'weekly_review', review: { ...base, ...stored } };
  } else if (op === 'coach_question') {
    const a = out.data as AnswerOutput;
    const valid = new Set(ctx!.valid_refs);
    const screened = screenText(a.answer);
    response = {
      status: 'ok',
      operation: 'coach_question',
      model_id: deps.config.modelId,
      answer: screened.ok
        ? { ...a, evidence_refs: a.evidence_refs.filter((x) => valid.has(x)) }
        : { answer: 'I can’t help with that safely. A doctor or registered dietitian is the right person to ask.', evidence_refs: [], follow_up_questions: [], safety_flags: ['removed_unsafe_text'] },
    };
  } else if (parsed.operation === 'photo_suggest' && parsed.kind === 'food') {
    const f = out.data as FoodPhotoOutput;
    const ids = new Set(parsed.presets.map((p) => p.id));
    response = {
      status: 'ok', operation: 'photo_suggest', kind: 'food', model_id: deps.config.modelId,
      result: { ...f, candidates: f.candidates.map((c) => ({ ...c, matched_preset_id: c.matched_preset_id && ids.has(c.matched_preset_id) ? c.matched_preset_id : null })) },
    };
  } else {
    const nb = out.data as NotebookPhotoOutput;
    response = {
      status: 'ok', operation: 'photo_suggest', kind: 'notebook', model_id: deps.config.modelId,
      result: { ...nb, exercises: nb.exercises.map((x) => ({ ...x, reps_max: Math.max(x.reps_min, x.reps_max) })) },
    };
  }

  await deps.admin.finish(requestId, user, 'succeeded', cost, response, model.usage, null);
  return json(200, response, h);
}
