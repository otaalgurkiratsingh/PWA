// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertPushEndpoint,
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  generateVapidKeys,
  sendPush,
  vapidAuthHeader,
  type PushSubscriptionJson,
  type VapidKeys,
} from './webpush';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array(data)));
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Independent RFC 8291 receiver: what the browser does with the push message. */
async function decryptPayload(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const record = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  expect(record.length).toBeLessThanOrEqual(rs);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const ikm = await hmac(await hmac(authSecret, ecdh), cat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, record));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2); // last-record delimiter
  return padded.slice(0, end);
}

async function subscriber(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub: PushSubscriptionJson = { endpoint, keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) } };
  return { sub, priv: kp.privateKey, pub, auth };
}

async function vapidKeys(): Promise<VapidKeys> {
  return { ...(await generateVapidKeys()), subject: 'mailto:owner@example.com' };
}

describe('encryptPayload', () => {
  it('round-trips through an RFC 8291 receiver', async () => {
    const s = await subscriber();
    const msg = enc.encode(JSON.stringify({ title: 'Log lunch', body: 'Time for a photo? 🍱' }));
    const body = await encryptPayload(s.sub, msg);
    expect(body.length).toBe(86 + msg.length + 1 + 16);
    expect(dec.decode(await decryptPayload(body, s.priv, s.pub, s.auth))).toBe(dec.decode(msg));
    // Fresh salt and sender key each time.
    const again = await encryptPayload(s.sub, msg);
    expect(b64urlEncode(again.slice(0, 86))).not.toBe(b64urlEncode(body.slice(0, 86)));
  });

  it('accepts the maximum payload and rejects one byte more', async () => {
    const s = await subscriber();
    const max = new Uint8Array(3993).fill(0x61);
    const body = await encryptPayload(s.sub, max);
    expect(body.length).toBe(4096); // 86-byte header + 3993 + delimiter + 16-byte tag
    expect((await decryptPayload(body, s.priv, s.pub, s.auth)).length).toBe(3993);
    await expect(encryptPayload(s.sub, new Uint8Array(3994))).rejects.toThrow(/exceeds/);
  });

  it('matches the RFC 8291 Section 5 test vector', async () => {
    const sub: PushSubscriptionJson = {
      endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
      keys: {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
    };
    const out = await encryptPayload(sub, enc.encode('When I grow up, I want to be a watermelon'), {
      salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'),
      localKeyPair: {
        publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      },
    });
    expect(b64urlEncode(out)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});

describe('vapidAuthHeader', () => {
  it('produces an ES256 JWT that verifies with the public key and carries aud/exp/sub', async () => {
    const v = await vapidKeys();
    const now = Date.UTC(2026, 9, 12, 8, 0, 0);
    const h = await vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc?x=1', v, 3600, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^.,]+), k=(.+)$/.exec(h);
    expect(m).not.toBeNull();
    const [, hdr, claims, sig, k] = m!;
    expect(k).toBe(v.publicKey);
    expect(JSON.parse(dec.decode(b64urlDecode(hdr)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(dec.decode(b64urlDecode(claims)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now / 1000) + 3600,
      sub: 'mailto:owner@example.com',
    });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(sig), enc.encode(`${hdr}.${claims}`));
    expect(ok).toBe(true);
    const bad = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(sig), enc.encode(`${hdr}.${claims}x`));
    expect(bad).toBe(false);
  });

  it('defaults to an expiry within 24 hours and rejects longer ones or a bad subject', async () => {
    const v = await vapidKeys();
    const now = Date.now();
    const h = await vapidAuthHeader('https://web.push.apple.com/abc', v, undefined, now);
    const claims = JSON.parse(dec.decode(b64urlDecode(h.slice('vapid t='.length).split('.')[1])));
    expect(claims.exp - Math.floor(now / 1000)).toBeLessThanOrEqual(86400);
    expect(claims.exp).toBeGreaterThan(Math.floor(now / 1000));
    await expect(vapidAuthHeader('https://web.push.apple.com/abc', v, 86401)).rejects.toThrow(/24 hours/);
    await expect(vapidAuthHeader('https://web.push.apple.com/abc', { ...v, subject: 'owner@example.com' })).rejects.toThrow(/subject/);
  });
});

describe('push endpoint SSRF guard', () => {
  it('accepts known push services', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/x',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://push.services.mozilla.com/x',
      'https://wns2-db5p.notify.windows.com/w/?token=x',
      'https://web.push.apple.com/x',
      'https://api.push.apple.com/x',
    ]) expect(() => assertPushEndpoint(e)).not.toThrow();
  });

  it('rejects http, other hosts, look-alikes, odd ports and credentials', () => {
    for (const e of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://example.com/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://evilfcm.googleapis.com.attacker.net/x',
      'https://notify.windows.com/x',
      'https://evilpush.apple.com.example/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'not a url',
    ]) expect(() => assertPushEndpoint(e), e).toThrow();
  });

  it('allows a loopback http endpoint only when explicitly listed', () => {
    expect(() => assertPushEndpoint('http://127.0.0.1:9999/push')).toThrow();
    expect(() => assertPushEndpoint('http://127.0.0.1:9999/push', ['127.0.0.1'])).not.toThrow();
    expect(() => assertPushEndpoint('http://example.test/push', ['example.test'])).toThrow(/https/);
  });
});

describe('sendPush', () => {
  it('POSTs an encrypted body with the right headers and maps 410 to gone', async () => {
    const s = await subscriber();
    const v = await vapidKeys();
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status });
    }) as unknown as typeof fetch;

    const res = await sendPush(s.sub, { title: 'Hi' }, v, { ttl: 60, urgency: 'high', topic: 'meal-reminder', fetchImpl });
    expect(res).toEqual({ status: 201, gone: false });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(s.sub.endpoint);
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h.TTL).toBe('60');
    expect(h.Urgency).toBe('high');
    expect(h.Topic).toBe('meal-reminder');
    expect(h.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${v.publicKey}$`));
    const body = init.body as Uint8Array;
    expect(JSON.parse(dec.decode(await decryptPayload(body, s.priv, s.pub, s.auth)))).toEqual({ title: 'Hi' });

    status = 410;
    expect(await sendPush(s.sub, { title: 'Hi' }, v, { fetchImpl })).toEqual({ status: 410, gone: true });
    expect((calls[1].init.headers as Record<string, string>).Topic).toBeUndefined();
    expect((calls[1].init.headers as Record<string, string>).Urgency).toBe('normal');
    status = 404;
    expect((await sendPush(s.sub, {}, v, { fetchImpl })).gone).toBe(true);
    status = 429;
    expect(await sendPush(s.sub, {}, v, { fetchImpl })).toEqual({ status: 429, gone: false });
  });

  it('refuses oversized payloads and non-push endpoints without fetching', async () => {
    const s = await subscriber();
    const v = await vapidKeys();
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    await expect(sendPush(s.sub, { x: 'a'.repeat(4000) }, v, { fetchImpl })).rejects.toThrow(/exceeds/);
    const evil = await subscriber('https://169.254.169.254/latest');
    await expect(sendPush(evil.sub, {}, v, { fetchImpl })).rejects.toThrow(/push service/);
    expect(called).toBe(0);
  });

  it('can target a listed loopback endpoint (test harness)', async () => {
    const s = await subscriber('http://127.0.0.1:8787/push/1');
    let seen = '';
    const fetchImpl = (async (url: string) => {
      seen = url;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendPush(s.sub, {}, await vapidKeys(), { fetchImpl, allowHosts: ['127.0.0.1'] })).toEqual({ status: 201, gone: false });
    expect(seen).toBe('http://127.0.0.1:8787/push/1');
  });
});
