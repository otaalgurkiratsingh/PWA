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
const sub = (path) => ({ endpoint: `http://127.0.0.1:54322/push/${path}`, p256dh: b64u(device.getPublicKey()), auth_secret: b64u(authSecret) });
const mock = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const u = req.url;
    if (u.startsWith('/push/')) {
      pushes.push({ path: u, headers: req.headers, body: raw });
      return u.endsWith('/gone') ? send(410, { reason: 'expired' }) : send(201);
    }
    calls.push({ url: u, auth: req.headers.authorization, body: raw.toString() });
    if (u.startsWith('/rest/v1/rpc/notify_due')) return send(200, [
      { user_id: U1, kind: 'motivation', local_date: '2026-10-12', hide_details: false, lead_minutes: 15, timezone: 'America/Toronto' },
      { user_id: U1, kind: 'gym', local_date: '2026-10-12', hide_details: false, lead_minutes: 15, timezone: 'America/Toronto' },
    ]);
    if (u.startsWith('/rest/v1/rpc/notify_claim')) return send(200, true);
    if (u.startsWith('/rest/v1/rpc/notify_context')) return send(200, {
      training: { sessions_per_week: 3 },
      sessions: [
        { status: 'finished', local_date: '2026-09-20', day_id: 'd1', exercises: [{ exercise_key: 'squat', name: 'Back squat', sets: [{ status: 'completed', actual: { load: 80, unit: 'kg' } }] }] },
        { status: 'finished', local_date: '2026-10-10', day_id: 'd1', exercises: [{ exercise_key: 'squat', name: 'Back squat', sets: [{ status: 'completed', actual: { load: 85, unit: 'kg' } }] }] },
      ],
      meal_dates: ['2026-10-11'],
      program: { name: 'Plan', schedule: 'weekdays', days: [{ id: 'd1', name: 'Legs', weekday: 1 }] },
    });
    if (u.startsWith('/rest/v1/rpc/notify_subscriptions')) return send(200, [sub('ok'), sub('gone')]);
    if (u.startsWith('/rest/v1/rpc/notify_result')) return send(200, null);
    return send(404, { message: `unexpected ${u}` });
  });
});
await new Promise((r) => mock.listen(54322, '127.0.0.1', r));

const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--config', 'supabase/functions/notify/deno.json', 'supabase/functions/notify/index.ts'], {
  env: {
    ...process.env, SUPABASE_URL: 'http://127.0.0.1:54322', SUPABASE_SERVICE_ROLE_KEY: SERVICE, NOTIFY_CRON_SECRET: CRON,
    VAPID_PUBLIC_KEY: b64u(vapid.getPublicKey()), VAPID_PRIVATE_KEY: b64u(vapid.getPrivateKey()), VAPID_SUBJECT: 'mailto:owner@example.com',
    NOTIFY_TEST_PUSH_HOSTS: '127.0.0.1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
fn.stdout.on('data', (d) => (log += d));
fn.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 100 && !/Listening/i.test(log); i++) await new Promise((r) => setTimeout(r, 200));
const port = /localhost:(\d+)|:(\d+)\//.exec(log)?.slice(1).find(Boolean) ?? '8000';

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail).slice(0, 600)}`}`); };
const tick = (auth) => fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: auth ? { authorization: auth } : {} }).then(async (r) => ({ status: r.status, body: await r.json() }));

try {
  const before = calls.length;
  const r0 = await tick();
  check('no cron secret → 401 before any database call', r0.status === 401 && calls.length === before, r0);
  const r1 = await tick('Bearer wrong');
  check('wrong cron secret → 401', r1.status === 401, r1);
  const r2 = await tick(`Bearer ${CRON}`);
  check('tick → 2 due, 2 delivered, 2 expired devices', r2.status === 200 && r2.body.due === 2 && r2.body.sent === 2 && r2.body.failed === 2, r2);
  check('database calls use the service key', calls.every((c) => c.auth === `Bearer ${SERVICE}`), calls.map((c) => c.auth?.slice(0, 16)));
  const ok = pushes.filter((p) => p.path.endsWith('/ok'));
  const msgs = ok.map((p) => decrypt(p.body));
  check('payload decrypts on the device: motivation with the new best', msgs.some((m) => m.title === 'You’re getting stronger' && m.body.includes('Back squat at 85 kg') && m.url === '/#/today'), msgs);
  check('gym reminder names the planned day 15 minutes ahead', msgs.some((m) => m.title === 'Legs in 15 minutes' && m.url === '/#/workout'), msgs);
  const h = ok[0]?.headers ?? {};
  check('Web Push headers: aes128gcm, TTL, VAPID with our public key', h['content-encoding'] === 'aes128gcm' && h.ttl === '3600' && String(h.authorization).startsWith('vapid t=') && String(h.authorization).endsWith(`k=${b64u(vapid.getPublicKey())}`), h);
  check('the push service sees ciphertext only', ok.every((p) => !p.body.toString('latin1').includes('Back squat')), null);
  const gone = calls.filter((c) => c.url.startsWith('/rest/v1/rpc/notify_result') && JSON.parse(c.body).p_gone === true);
  check('expired device reported for deletion', gone.length === 2 && gone.every((c) => JSON.parse(c.body).p_endpoint.endsWith('/gone')), gone.map((c) => c.body));
  check('logs carry no names or message text', !/Back squat|Legs|85 kg/.test(log), log.slice(0, 400));
} finally {
  fn.kill();
  mock.close();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
