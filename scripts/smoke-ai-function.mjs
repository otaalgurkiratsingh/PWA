// Runtime test of the REAL supabase/functions/ai/index.ts in Deno.
// Usage: DENO=/path/to/deno node scripts/smoke-ai-function.mjs
//
// Phase 1 (no AI secrets): token check before anything else, membership/consent via user-scoped
//   requests, "not configured" without a reservation, no provider call.
// Phase 2 — INTEGRATION HARNESS, NOT THE REAL PROVIDER: the function runs with a fake key and
//   GEMINI_TEST_BASE_URL pointing at a loopback mock of the Gemini API, plus a mock Supabase.
//   It proves the wiring end to end (envelope → reservation → model call → validation → storage
//   RPCs → finish) for text chat and an onboarding plan. It says nothing about real Gemini output.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const DENO = process.env.DENO ?? 'deno';
const USER = '11111111-1111-4111-8111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const goodJwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', aud: 'authenticated', exp: now + 600, iat: now })}.sig`;
const SECRET = 'sb_secret_smoke_not_real';
const promptSrc = readFileSync('supabase/functions/_shared/coachPrompt.ts', 'utf8');
const SYSTEM = JSON.parse(/COACH_SYSTEM_PROMPT = (".*");/s.exec(promptSrc)[1]);

const training = {
  goal_priorities: ['consistency'], days_available: [1, 3], sessions_per_week: 2, minutes_per_session: 40, time_windows: [], rotating_schedule: false,
  experience: 'new', current_routine: '', exercise_likes: '', recent_performance: '', location: 'home', equipment: ['dumbbell'], avoid_exercises: '',
  restrictions: '', screening: 'no_concerns', inspiration_note: '', updated_at: '2026-10-10T00:00:00Z',
};
const docs = [
  { collection: 'settings', doc_id: 's', body: { profile: { units: 'kg', goal: 'consistency', timezone: 'America/Toronto', adult_confirmed: true, profile_version: 1, training, food_prefs: { pattern: 'unspecified', meatless_weekdays: [], allergies: [] }, consent: {} } }, deleted_at: null },
  { collection: 'workout_sessions', doc_id: 'w1', body: { status: 'finished', local_date: '2026-10-09', day_name: 'Full body', exercises: [] }, deleted_at: null },
];
const ex = (id) => ({ exercise_id: id, variant_id: null, working_sets: 2, rep_min: 8, rep_max: 12, target_load: null, load_unit: 'kg', rest_seconds: 60, effort_instruction: 'Comfortable', substitution_exercise_ids: [], notes: '' });
const baseOut = { schema_version: '2.0', summary: 's', questions: [], observations: [], assumptions: [], limitations: [], suggestions: [], candidate_memories: [], safety: { state: 'none', message: null }, food_candidates: [], measurement_candidates: [] };
const chatOut = { ...baseOut, status: 'suggestion_ready', assistant_message: 'Keep the first two exercises and do 2 sets each; that fits in 30 minutes.', plan: null };
const planOut = { ...baseOut, status: 'draft_ready', assistant_message: 'Here is a draft.', plan: {
  title: 'Two-day start', status: 'draft', goal: 'consistency', profile_version: '1', schedule_mode: 'weekdays', duration_weeks_before_review: 4,
  warmup: [{ instruction: 'March in place', minutes: 4 }],
  days: [{ label: 'Day 1', weekday: 1, estimated_minutes: 30, exercises: [ex('goblet_squat:dumbbell'), ex('push_up:bodyweight')] }],
  recovery_notes: [], progression_rule: 'Add a rep when all sets feel easy.', review_trigger: 'After 4 weeks',
} };

const calls = [];
let geminiBodies = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, key: req.headers['x-goog-api-key'] ?? null, body });
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
    const u = req.url;
    if (u.startsWith('/auth/v1/.well-known/jwks.json')) return send(200, { keys: [] });
    if (u.startsWith('/auth/v1/user')) return bearer === goodJwt ? send(200, { id: USER, aud: 'authenticated', role: 'authenticated', email: 'x@example.com' }) : send(401, { msg: 'invalid JWT' });
    if (u.startsWith('/rest/v1/rpc/my_membership')) return send(200, 'active');
    if (u.startsWith('/rest/v1/consent_events')) return send(200, [{ granted: true }]);
    if (u.startsWith('/rest/v1/journal_documents')) return send(200, docs);
    if (u.startsWith('/rest/v1/user_confirmed_memory')) return send(200, []);
    if (u.startsWith('/rest/v1/rpc/ai_reserve')) return send(200, { status: 'reserved', request_id: '99999999-9999-4999-8999-999999999999' });
    if (u.startsWith('/rest/v1/rpc/ai_finish')) return send(200, null);
    if (u.startsWith('/rest/v1/rpc/coach_store_exchange')) return send(200, { status: 'stored', thread_id: '77777777-7777-4777-8777-777777777777', assistant_message_id: '88888888-8888-4888-8888-888888888888' });
    if (u.startsWith('/rest/v1/rpc/store_plan_draft')) return send(200, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    if (u.startsWith('/v1beta/models/')) {
      const parsed = JSON.parse(body);
      geminiBodies.push(parsed);
      const isPlan = parsed.contents[0].parts[0].text.startsWith('OPERATION: onboarding_plan');
      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(isPlan ? planOut : chatOut) }] } }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 200, thoughtsTokenCount: 40, totalTokenCount: 3240 } });
    }
    return send(404, { message: `unexpected ${u}` });
  });
});
await new Promise((r) => mock.listen(54321, '127.0.0.1', r));

async function startFn(extraEnv) {
  const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--config', 'supabase/functions/ai/deno.json', 'supabase/functions/ai/index.ts'], {
    env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'sb_publishable_smoke', SUPABASE_SERVICE_ROLE_KEY: SECRET, ALLOWED_ORIGINS: 'https://rozana.example', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  fn.stdout.on('data', (d) => (log += d));
  fn.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100 && !/Listening/i.test(log); i++) await new Promise((r) => setTimeout(r, 200));
  const port = /localhost:(\d+)|:(\d+)\//.exec(log)?.slice(1).find(Boolean) ?? '8000';
  return { fn, port, log: () => log };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail).slice(0, 600)}`}`); };
const chatReq = { operation: 'coach_question', operation_id: '33333333-3333-4333-8333-333333333333', today: '2026-10-10', timezone: 'America/Toronto', thread_id: null, message: 'Can I do today’s workout in 30 minutes?' };
const planReq = { operation: 'onboarding_plan', operation_id: '44444444-4444-4444-8444-444444444444', today: '2026-10-10', timezone: 'America/Toronto', profile_version: 1 };

let phase = await startFn({});
const post = (port, headers, body) => fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://rozana.example', ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
try {
  console.log('— phase 1: no AI secrets —');
  const before = calls.length;
  const r1 = await post(phase.port, {}, chatReq);
  check('no token → 401 before any backend call', r1.status === 401 && calls.length === before, r1);
  const r2 = await post(phase.port, { authorization: 'Bearer not-a-jwt' }, chatReq);
  check('malformed token → 401', r2.status === 401, r2);
  const r3 = await post(phase.port, { authorization: `Bearer ${goodJwt.slice(0, -3)}bad` }, chatReq);
  check('token rejected by Auth → 401', r3.status === 401, r3);
  const r4 = await post(phase.port, { authorization: `Bearer ${goodJwt}`, origin: 'https://evil.example' }, chatReq);
  check('other origin → 403', r4.status === 403, r4);
  const r5 = await post(phase.port, { authorization: `Bearer ${goodJwt}` }, chatReq);
  check('valid member without AI configuration → 503 not_configured', r5.status === 503 && r5.body.error === 'not_configured', r5);
  check('membership checked with the caller\'s own token', calls.some((c) => c.url.startsWith('/rest/v1/rpc/my_membership') && c.auth === `Bearer ${goodJwt}`), calls.map((c) => c.url));
  check('no reservation was attempted', !calls.some((c) => c.url.includes('ai_reserve')), calls.map((c) => c.url));
  phase.fn.kill();

  console.log('— phase 2: integration harness (mock Gemini on 127.0.0.1, fake key) —');
  calls.length = 0;
  geminiBodies = [];
  phase = await startFn({ GEMINI_API_KEY: 'fake-key-for-harness', AI_PRICE_INPUT_PER_MTOK: '0.5', AI_PRICE_OUTPUT_PER_MTOK: '3', GEMINI_TEST_BASE_URL: 'http://127.0.0.1:54321/v1beta' });
  const c1 = await post(phase.port, { authorization: `Bearer ${goodJwt}` }, chatReq);
  check('chat → 200 with a stored reply in schema 2.0', c1.status === 200 && c1.body.reply?.thread_id && c1.body.reply.output.schema_version === '2.0', c1);
  const g = geminiBodies[0];
  check('model got the installed V2 system prompt', g?.systemInstruction?.parts?.[0]?.text === SYSTEM, g?.systemInstruction?.parts?.[0]?.text?.slice(0, 80));
  check('chat output budget 1,200 tokens, JSON schema, no tools', g?.generationConfig?.maxOutputTokens === 1200 && g?.generationConfig?.responseJsonSchema && !g?.tools, g?.generationConfig);
  check('provider key sent only in the header', calls.some((c) => c.url.startsWith('/v1beta/') && c.key === 'fake-key-for-harness' && !c.url.includes('fake-key')), calls.filter((c) => c.url.startsWith('/v1beta')));
  const reserveCall = calls.find((c) => c.url.includes('ai_reserve'));
  check('reservation made with the service key, for the verified user, with the timezone', reserveCall && reserveCall.auth === `Bearer ${SECRET}` && JSON.parse(reserveCall.body).p_user === USER && JSON.parse(reserveCall.body).p_timezone === 'America/Toronto', reserveCall?.body);
  const storeCall = calls.find((c) => c.url.includes('coach_store_exchange'));
  check('exchange stored through the service RPC for the verified user', storeCall && JSON.parse(storeCall.body).p_user === USER, storeCall?.body);
  check('journal read with the caller\'s token (RLS), not the service key', calls.filter((c) => c.url.startsWith('/rest/v1/journal_documents')).every((c) => c.auth === `Bearer ${goodJwt}`), calls.filter((c) => c.url.startsWith('/rest/v1/journal_documents')).map((c) => c.auth?.slice(0, 20)));
  check('request finished as succeeded', calls.some((c) => c.url.includes('ai_finish') && JSON.parse(c.body).p_status === 'succeeded'), calls.filter((c) => c.url.includes('ai_finish')).map((c) => c.body));

  const p1 = await post(phase.port, { authorization: `Bearer ${goodJwt}` }, planReq);
  check('onboarding plan → validated draft stored (not activated)', p1.status === 200 && p1.body.draft?.id && p1.body.draft.plan.days[0].exercises.length === 2, p1);
  const g2 = geminiBodies[1];
  check('plan output budget 6,000 tokens and allowed exercise ids in the envelope', g2?.generationConfig?.maxOutputTokens === 6000 && g2.contents[0].parts[0].text.includes('"allowed_exercises"'), g2?.generationConfig);
  const stale = await post(phase.port, { authorization: `Bearer ${goodJwt}` }, { ...planReq, operation_id: '45444444-4444-4444-8444-444444444444', profile_version: 0 });
  check('stale profile version refused before any model call', stale.status === 409 && geminiBodies.length === 2, stale);
} finally {
  phase.fn.kill();
  mock.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
