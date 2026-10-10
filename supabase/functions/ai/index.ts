// TrainLuma AI Edge Function: weekly_review | coach_question (text chat) | onboarding_plan | photo_suggest.
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
import catalogue from '../_shared/data/punjabi-canadian-v2.json' with { type: 'json' };

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
  timeoutMs: 25_000,
  catalogue: (catalogue as { foods: { id: string; name: string }[] }).foods.map((f) => ({ id: f.id, name: f.name })),
};

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js generic client types differ between Deno and Node builds
async function latestConsent(db: any, type: string): Promise<boolean> {
  const { data, error } = await db.from('consent_events').select('granted').eq('consent_type', type)
    .order('created_at', { ascending: false }).limit(1);
  return !error && data?.[0]?.granted === true;
}

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
      aiConsent: () => latestConsent(db, 'ai_processing'),
      imageConsent: () => latestConsent(db, 'ai_images'),
      async documents(collections) {
        // Time series: the last 35 days only. Definitions (settings, meals, foods, plans): newest first, bounded.
        const series = collections.filter((c) => ['meal_entries', 'daily_log_status', 'weight_entries', 'workout_sessions', 'daily_health'].includes(c));
        const defs = collections.filter((c) => !series.includes(c));
        const since = new Date(Date.now() - 35 * 864e5).toISOString();
        const cols = 'collection, doc_id, body, deleted_at';
        const [a, b] = await Promise.all([
          series.length ? db.from('journal_documents').select(cols).in('collection', series).gte('updated_at', since).limit(2000) : Promise.resolve({ data: [], error: null }),
          defs.length ? db.from('journal_documents').select(cols).in('collection', defs).is('deleted_at', null).order('updated_at', { ascending: false }).limit(400) : Promise.resolve({ data: [], error: null }),
        ]);
        if (a.error || b.error) throw new Error('could not read journal');
        return [...(a.data ?? []), ...(b.data ?? [])].map((r) => ({ collection: r.collection, doc_id: r.doc_id, body: r.body, deleted: r.deleted_at !== null }));
      },
      async memory() {
        const { data } = await db.from('user_confirmed_memory').select('fact').is('deleted_at', null).limit(10);
        return (data ?? []).map((r) => r.fact as string);
      },
      async thread(threadId) {
        // RLS returns nothing for another person's or an expired thread.
        const t = await db.from('coach_threads').select('id').eq('id', threadId).maybeSingle();
        if (t.error || !t.data) return null;
        const { data, error } = await db.from('coach_messages').select('role, content, created_at').eq('thread_id', threadId)
          .order('created_at', { ascending: false }).limit(40);
        if (error) return null;
        return (data ?? []).reverse().map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content as string }));
      },
      async photos(ids) {
        // Only the caller's own rows are visible (RLS); objects are downloaded with the caller's token.
        const { data } = await db.from('progress_photos').select('id, slot, object_path').in('id', [...ids]).limit(5);
        const out: { id: string; slot: string; base64: string }[] = [];
        for (const row of data ?? []) {
          const file = await db.storage.from('progress-photos').download(row.object_path as string);
          if (file.error || !file.data || file.data.size > 1_572_864) continue;
          out.push({ id: row.id as string, slot: row.slot as string, base64: toBase64(new Uint8Array(await file.data.arrayBuffer())) });
        }
        return out;
      },
    };
  },
  admin: {
    async reserve(user, operationId, operation, usd, timezone) {
      const { data, error } = await admin.rpc('ai_reserve', { p_user: user, p_operation_id: operationId, p_operation: operation, p_reserve_usd: usd, p_timezone: timezone });
      if (error) throw new Error('reservation failed');
      return data;
    },
    async finish(requestId, user, status, actual, result, usage, error) {
      await admin.rpc('ai_finish', { p_request_id: requestId, p_user: user, p_status: status, p_actual_usd: actual, p_result: result, p_usage: usage, p_error: error });
    },
    async storeReview(user, review) {
      // Service role bypasses RLS: every write names the verified user explicitly.
      const { data, error } = await admin.from('coach_reviews').insert({
        user_id: user,
        period_from: review.data_period.from,
        period_to: review.data_period.to,
        review: { schema_version: '2.0', data_completeness: review.data_completeness, output: review.output },
        model_id: review.model_id,
        prompt_version: review.prompt_version,
      }).select('id, created_at').single();
      if (error) throw new Error('could not store review');
      return { id: data.id, created_at: data.created_at };
    },
    async storeExchange(a) {
      const { data, error } = await admin.rpc('coach_store_exchange', {
        p_user: a.user, p_thread_id: a.threadId, p_client_op_id: a.clientOpId, p_user_text: a.userText, p_assistant_text: a.assistantText,
        p_response: a.response, p_schema_version: '2.0', p_model_id: a.modelId, p_prompt_version: a.promptVersion,
      });
      if (error) throw new Error('could not store chat');
      return data;
    },
    async storePlanDraft(a) {
      const { data, error } = await admin.rpc('store_plan_draft', {
        p_user: a.user, p_profile_version: a.profileVersion, p_source: a.source, p_plan: a.plan, p_response: a.response,
        p_model_id: a.modelId, p_prompt_version: a.promptVersion,
      });
      if (error) throw new Error('could not store draft');
      return { id: data as string, created_at: new Date().toISOString() };
    },
  },
  callModel: (r) => callModel({ ...r, apiKey: config.apiKey!, model: config.modelId, style: config.style, timeoutMs: config.timeoutMs, baseUrl: env('GEMINI_TEST_BASE_URL') ?? undefined }),
};

Deno.serve((req) => handleAiRequest(req, deps).catch(() =>
  new Response(JSON.stringify({ status: 'error', error: 'provider_error', message: 'Something went wrong. Logging still works.' }), {
    status: 500, headers: { 'content-type': 'application/json' },
  })));
