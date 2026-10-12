// Runtime test of the REAL supabase/functions/notify/index.ts in Deno.
// Usage: DENO=/path/to/deno node scripts/smoke-notify-function.mjs
//
// INTEGRATION HARNESS, NOT A REAL PUSH SERVICE: a loopback mock plays both Supabase (the notify_*
// RPCs) and a push service. The device keys are generated here, so the harness decrypts what the
// function sent and checks the actual notification text. It says nothing about FCM/Apple delivery.
import { spawn } from 'node:child_process';
import { createECDH, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const DENO = process.env.DENO ?? 'deno';
const CRON = 'cron-secret-for-harness-only';
const SERVICE = 'sb_secret_smoke_not_real';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

// A "device": P-256 key pair + auth secret, exactly what a browser's PushSubscription holds.
const device = createECDH('prime256v1');
device.generateKeys();
const authSecret = randomBytes(16);
const b64u = (b) => Buffer.from(b).toString('base64url');
const vapid = createECDH('prime256v1');
vapid.generateKeys();

const hkdf = (salt, ikm, info, len) => {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
};
// RFC 8291 / RFC 8188 (aes128gcm) decryption, as a browser does it.
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const senderPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = device.computeSecret(senderPub);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), device.getPublicKey(), senderPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'));
}

const pushes = [];
const calls = [];
let mockPort = 0;
const sub = (path) => ({ endpoint: `http://127.0.0.1:${mockPort}/push/${path}`, p256dh: b64u(device.getPublicKey()), auth_secret: b64u(authSecret) });
const PRESET = '7d4c1a52-5d0e-4a8e-9f61-2b0b6c2f9a10';
// Dinner at ~18:40 Toronto (UTC-4) on the four days before Sunday 2026-10-18.
const dinner = (date, hhmm) => ({ local_date: date, preset_id: PRESET, name: 'Dal chawal', slot: 'dinner', logged_at: `${date}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`, timezone: 'America/Toronto' });
const candidate = (over) => ({
  user_id: U1, timezone: 'America/Toronto', local_ts: '2026-10-18T18:30:00', routine_enabled: true, insight_enabled: true, gym_enabled: true,
  gym_mode: 'learned', gym_days: [], gym_time: '18:00:00', lead_minutes: 15, hide_details: false, sent_today: 0, stopped_kinds: [], ...over,
});
// Tick 1 (Sunday evening): U1 gets the weekly insight + the usual-dinner nudge; U3 (details hidden,
// fixed gym 18:45) gets a neutral gym reminder. Tick 2: someone in quiet hours (22:30) gets nothing.
let mode = 'evening';
const mock = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const u = req.url;
    if (u.startsWith('/push/')) {
      pushes.push({ mode, path: u, headers: req.headers, body: raw });
      return u.endsWith('/gone') ? send(410, { reason: 'expired' }) : send(201);
    }
    calls.push({ mode, url: u, auth: req.headers.authorization, body: raw.toString() });
    if (u.startsWith('/rest/v1/rpc/notify_candidates')) return send(200, mode === 'evening'
      ? [candidate(), candidate({ user_id: U3, hide_details: true, gym_mode: 'fixed', gym_days: [0], gym_time: '18:45:00' })]
      : [candidate({ user_id: U2, local_ts: '2026-10-18T22:30:00' })]);
    if (u.startsWith('/rest/v1/rpc/notify_claim')) return send(200, true);
    if (u.startsWith('/rest/v1/rpc/notify_context')) return send(200, {
      training: { sessions_per_week: 3 },
      sessions: [{ status: 'finished', local_date: '2026-10-12', day_id: 'd1', day_name: 'Legs', started_at: '2026-10-12T22:00:00.000Z', timezone: 'America/Toronto' }],
      meals: [dinner('2026-10-14', '18:35'), dinner('2026-10-15', '18:40'), dinner('2026-10-16', '18:45'), dinner('2026-10-17', '18:40')],
      logged_dates: ['2026-10-12', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
      meal_dates: ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
      program: { name: 'Plan', schedule: 'weekdays', days: [{ id: 'd1', name: 'Legs', weekday: 1 }] },
    });
    if (u.startsWith('/rest/v1/rpc/notify_subscriptions')) return send(200, [sub('ok'), sub('gone')]);
    if (u.startsWith('/rest/v1/rpc/notify_result')) return send(200, null);
    return send(404, { message: `unexpected ${u}` });
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
mockPort = mock.address().port;

const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--config', 'supabase/functions/notify/deno.json', 'supabase/functions/notify/index.ts'], {
  env: {
    ...process.env, SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NOTIFY_CRON_SECRET: CRON,
    VAPID_PUBLIC_KEY: b64u(vapid.getPublicKey()), VAPID_PRIVATE_KEY: b64u(vapid.getPrivateKey()), VAPID_SUBJECT: 'mailto:owner@example.com',
    NOTIFY_TEST_PUSH_HOSTS: '127.0.0.1',
    // Any free port, so parallel runs don't collide (the port is read from Deno's log line).
    DENO_SERVE_ADDRESS: process.env.DENO_SERVE_ADDRESS ?? 'tcp:127.0.0.1:0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
fn.stdout.on('data', (d) => (log += d));
fn.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 100 && !/Listening/i.test(log); i++) await new Promise((r) => setTimeout(r, 200));
const port = /Listening on https?:\/\/[^\s/]*:(\d+)/i.exec(log)?.[1] ?? /localhost:(\d+)|:(\d+)\//.exec(log)?.slice(1).find(Boolean) ?? '8000';

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail).slice(0, 600)}`}`); };
const tick = (auth) => fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: auth ? { authorization: auth } : {} }).then(async (r) => ({ status: r.status, body: await r.json() }));
const rpcCalls = (name, m) => calls.filter((c) => c.url.startsWith(`/rest/v1/rpc/${name}`) && (!m || c.mode === m));

try {
  const before = calls.length;
  const r0 = await tick();
  check('no cron secret → 401 before any database call', r0.status === 401 && calls.length === before, r0);
  const r1 = await tick('Bearer wrong');
  check('wrong cron secret → 401', r1.status === 401, r1);
  const r2 = await tick(`Bearer ${CRON}`);
  check('evening tick → 2 candidates, 3 due, 3 delivered, 3 expired devices', r2.status === 200 && r2.body.candidates === 2 && r2.body.due === 3 && r2.body.sent === 3 && r2.body.failed === 3 && r2.body.skipped === 0, r2);
  check('database calls use the service key', calls.every((c) => c.auth === `Bearer ${SERVICE}`), calls.map((c) => c.auth?.slice(0, 16)));
  const ok = pushes.filter((p) => p.path.endsWith('/ok'));
  const msgs = ok.map((p) => decrypt(p.body));
  const routine = msgs.find((m) => m.kind === 'routine');
  check('routine nudge decrypts on the device: "Your usual Dal chawal?" with a one-tap Log it', !!routine && routine.title === 'Your usual Dal chawal?'
    && routine.body === 'Tap Log it and it\'s done.' && routine.url === `/#/quicklog/${PRESET}/dinner` && routine.tag === 'routine-2026-10-18'
    && JSON.stringify(routine.actions) === JSON.stringify([{ action: 'log', title: 'Log it' }]), msgs);
  const insight = msgs.find((m) => m.kind === 'insight');
  check('weekly insight decrypts: recap ready, opens Insights', !!insight && insight.title === 'Luma found something in your week 👀'
    && insight.body === 'Your weekly recap is ready.' && insight.url === '/#/insights' && insight.tag === 'weekly-2026-10-12' && !insight.actions, msgs);
  const gym = msgs.find((m) => m.kind === 'gym');
  check('hidden details: neutral gym line, and that person’s records were never read', !!gym && gym.title === 'TrainLuma' && gym.body === 'Something\'s ready for you.'
    && gym.url === '/#/workout' && rpcCalls('notify_context').every((c) => JSON.parse(c.body).p_user !== U3), { gym, ctx: rpcCalls('notify_context').map((c) => c.body) });
  const claims = rpcCalls('notify_claim').map((c) => JSON.parse(c.body));
  check('claims: insight first (keyed by the week’s Monday), then routine; local dates', JSON.stringify(claims.filter((c) => c.p_user === U1).map((c) => `${c.p_kind}@${c.p_date}`)) === JSON.stringify(['insight@2026-10-12', 'routine@2026-10-18']), claims);
  const h = ok[0]?.headers ?? {};
  check('Web Push headers: aes128gcm, TTL, VAPID with our public key', h['content-encoding'] === 'aes128gcm' && h.ttl === '3600' && String(h.authorization).startsWith('vapid t=') && String(h.authorization).endsWith(`k=${b64u(vapid.getPublicKey())}`), h);
  check('the push service sees ciphertext only', ok.every((p) => !p.body.toString('latin1').includes('Dal chawal')), null);
  const gone = rpcCalls('notify_result').filter((c) => JSON.parse(c.body).p_gone === true);
  check('expired device reported for deletion', gone.length === 3 && gone.every((c) => JSON.parse(c.body).p_endpoint.endsWith('/gone')), gone.map((c) => c.body));

  mode = 'night';
  const pushedBefore = pushes.length;
  const r3 = await tick(`Bearer ${CRON}`);
  check('quiet hours (22:30 local): nothing claimed, read or sent', r3.status === 200 && r3.body.candidates === 1 && r3.body.due === 0 && r3.body.sent === 0
    && pushes.length === pushedBefore && rpcCalls('notify_claim', 'night').length === 0 && rpcCalls('notify_context', 'night').length === 0, { r3, calls: calls.filter((c) => c.mode === 'night').map((c) => c.url) });
  check('logs carry no names or message text', !/Dal chawal|Legs|Your usual|weekly recap/.test(log), log.slice(0, 400));
} finally {
  fn.kill();
  mock.close();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
