// Runtime smoke test of supabase/functions/ai/index.ts in Deno, against a local mock Supabase.
// Usage: DENO=/path/to/deno node scripts/smoke-ai-function.mjs
// Proves the real entry point's wiring: token check before anything else, membership/consent via
// user-scoped requests, "not configured" without a reservation, and no provider call.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const DENO = process.env.DENO ?? 'deno';
const calls = [];
const USER = '11111111-1111-4111-8111-111111111111';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const goodJwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', aud: 'authenticated', exp: now + 600, iat: now })}.sig`;

const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null });
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (req.url.startsWith('/auth/v1/.well-known/jwks.json')) return send(200, { keys: [] });
    if (req.url.startsWith('/auth/v1/user')) return bearer === goodJwt ? send(200, { id: USER, aud: 'authenticated', role: 'authenticated', email: 'x@example.com' }) : send(401, { msg: 'invalid JWT' });
    if (req.url.startsWith('/rest/v1/rpc/my_membership')) return send(200, 'active');
    if (req.url.startsWith('/rest/v1/consent_events')) return send(200, [{ granted: true }]);
    return send(404, { message: 'unexpected' });
  });
});
await new Promise((r) => mock.listen(54321, '127.0.0.1', r));

const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--config', 'supabase/functions/ai/deno.json', 'supabase/functions/ai/index.ts'], {
  env: {
    ...process.env,
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'sb_publishable_smoke',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_smoke_not_real',
    ALLOWED_ORIGINS: 'https://rozana.example',
    // No GEMINI_API_KEY and no pricing: the function must say "not configured" and never reserve or call out.
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
fn.stdout.on('data', (d) => (log += d));
fn.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 100 && !/Listening/i.test(log); i++) await new Promise((r) => setTimeout(r, 200));
const port = /localhost:(\d+)|:(\d+)\//.exec(log)?.slice(1).find(Boolean) ?? '8000';

const post = (headers, body) => fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://rozana.example', ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const req = { operation: 'coach_question', operation_id: '33333333-3333-4333-8333-333333333333', today: '2026-10-09', question: 'How was my week?' };
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`); };

try {
  const before = calls.length;
  const r1 = await post({}, req);
  check('no token → 401 before any backend call', r1.status === 401 && calls.length === before, r1);
  const r2 = await post({ authorization: 'Bearer not-a-jwt' }, req);
  check('malformed token → 401', r2.status === 401, r2);
  const r3 = await post({ authorization: `Bearer ${goodJwt.slice(0, -3)}bad` }, req);
  check('token rejected by Auth → 401', r3.status === 401, r3);
  const r4 = await post({ authorization: `Bearer ${goodJwt}`, origin: 'https://evil.example' }, req);
  check('other origin → 403', r4.status === 403, r4);
  const r5 = await post({ authorization: `Bearer ${goodJwt}` }, req);
  check('valid member without AI configuration → 503 not_configured', r5.status === 503 && r5.body.error === 'not_configured', r5);
  check('membership checked with the caller\'s own token', calls.some((c) => c.url.startsWith('/rest/v1/rpc/my_membership') && c.auth === `Bearer ${goodJwt}`), calls);
  check('no reservation was attempted', !calls.some((c) => c.url.includes('ai_reserve')), calls);
} finally {
  fn.kill();
  mock.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
