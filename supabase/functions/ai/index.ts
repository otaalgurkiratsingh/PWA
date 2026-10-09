// Rozana AI Edge Function: weekly_review | coach_question | photo_suggest.
// Wiring only — all decisions live in ../_shared/handler.ts (unit-tested).
//
// Secrets (set by the owner in the Supabase dashboard, never in the app or git):
//   GEMINI_API_KEY            paid, billing-linked Google API project key
//   GEMINI_MODEL              default "gemini-3.8-flash"
//   GEMINI_API_STYLE          "generate_content" (default) or "interactions" (store=false)
//   AI_PRICE_INPUT_PER_MTOK   US$ per 1M input tokens, from the current pricing page
//   AI_PRICE_OUTPUT_PER_MTOK  US$ per 1M output tokens (thinking billed as output)
//   ALLOWED_ORIGINS           comma-separated, e.g. "https://your-site.netlify.app"
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEYS,
//   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS.
import { createClient } from '@supabase/supabase-js';
import { handleAiRequest, type HandlerDeps } from '../_shared/handler.ts';
import { callModel } from '../_shared/gemini.ts';

function env(name: string): string | null {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : null;
}

function namedKey(jsonVar: string, legacyVar: string): string {
  const raw = env(jsonVar);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // fall through to the legacy variable
    }
  }
  const legacy = env(legacyVar);
  if (!legacy) throw new Error(`missing ${jsonVar}/${legacyVar}`);
  return legacy;
}

const SUPABASE_URL = env('SUPABASE_URL')!;
const PUBLISHABLE = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const SECRET = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const inPrice = Number(env('AI_PRICE_INPUT_PER_MTOK'));
const outPrice = Number(env('AI_PRICE_OUTPUT_PER_MTOK'));

const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const verifier = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });

const config: HandlerDeps['config'] = {
  apiKey: env('GEMINI_API_KEY'),
  modelId: env('GEMINI_MODEL') ?? 'gemini-3.8-flash',
  style: env('GEMINI_API_STYLE') === 'interactions' ? 'interactions' : 'generate_content',
  pricing: inPrice > 0 && outPrice > 0 ? { inputPerMTok: inPrice, outputPerMTok: outPrice } : null,
  allowedOrigins: (env('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  maxOutputTokens: 2048,
  timeoutMs: 25_000,
};

const deps: HandlerDeps = {
  config,
  async verifyToken(token) {
    // Verifies signature, issuer and expiry (JWKS for asymmetric keys, Auth server otherwise).
    const { data, error } = await verifier.auth.getClaims(token);
    if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
    return { sub: data.claims.sub };
  },
  userDb(token) {
    // Acts AS the user: every read below is filtered by RLS (owner + active membership).
    const db = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      async membership() {
        const { data, error } = await db.rpc('my_membership');
        return error ? 'none' : String(data);
      },
      async aiConsent() {
        const { data, error } = await db.from('consent_events').select('granted').eq('consent_type', 'ai_processing')
          .order('created_at', { ascending: false }).limit(1);
        return !error && data?.[0]?.granted === true;
      },
      async documents(collections) {
        const since = new Date(Date.now() - 35 * 864e5).toISOString();
        const { data, error } = await db.from('journal_documents').select('collection, doc_id, body, deleted_at')
          .in('collection', [...collections]).gte('updated_at', since).limit(2000);
        if (error) throw new Error('could not read journal');
        const rows = (data ?? []).map((r) => ({ collection: r.collection, doc_id: r.doc_id, body: r.body, deleted: r.deleted_at !== null }));
        // The settings document may be older than the window.
        if (!rows.some((r) => r.collection === 'settings')) {
          const s = await db.from('journal_documents').select('collection, doc_id, body, deleted_at').eq('collection', 'settings').limit(1);
          for (const r of s.data ?? []) rows.push({ collection: r.collection, doc_id: r.doc_id, body: r.body, deleted: r.deleted_at !== null });
        }
        return rows;
      },
      async memory() {
        const { data } = await db.from('user_confirmed_memory').select('fact').is('deleted_at', null).limit(10);
        return (data ?? []).map((r) => r.fact as string);
      },
    };
  },
  admin: {
    async reserve(user, operationId, operation, usd) {
      const { data, error } = await admin.rpc('ai_reserve', { p_user: user, p_operation_id: operationId, p_operation: operation, p_reserve_usd: usd });
      if (error) throw new Error('reservation failed');
      return data;
    },
    async finish(requestId, user, status, actual, result, usage, error) {
      await admin.rpc('ai_finish', { p_request_id: requestId, p_user: user, p_status: status, p_actual_usd: actual, p_result: result, p_usage: usage, p_error: error });
    },
    async storeReview(user, review, proposal) {
      const { data, error } = await admin.from('coach_reviews').insert({
        user_id: user,
        period_from: review.data_period.from,
        period_to: review.data_period.to,
        review: { data_completeness: review.data_completeness, output: review.output },
        model_id: review.model_id,
        prompt_version: review.prompt_version,
      }).select('id, created_at').single();
      if (error) throw new Error('could not store review');
      let proposalId: string | null = null;
      if (proposal) {
        const p = await admin.from('change_proposals').insert({
          user_id: user, coach_review_id: data.id, kind: 'target', before_value: proposal.before, after_value: proposal.after,
        }).select('id').single();
        proposalId = p.data?.id ?? null;
      }
      return { id: data.id, created_at: data.created_at, proposal_id: proposalId };
    },
  },
  callModel: (r) => callModel({ ...r, apiKey: config.apiKey!, model: config.modelId, style: config.style, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs }),
};

Deno.serve((req) => handleAiRequest(req, deps).catch(() =>
  new Response(JSON.stringify({ status: 'error', error: 'provider_error', message: 'Something went wrong. Logging still works.' }), {
    status: 500, headers: { 'content-type': 'application/json' },
  })));
