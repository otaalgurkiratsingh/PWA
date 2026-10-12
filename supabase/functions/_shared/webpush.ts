/**
 * Dependency-free Web Push sender. Uses only WebCrypto (`crypto.subtle`), so it runs unchanged in
 * Deno (Edge Functions) and Node 20+ (vitest).
 *
 *  - Payload encryption: RFC 8291 (Message Encryption for Web Push) over RFC 8188 `aes128gcm`,
 *    one record, record size 4096, padding delimiter 0x02.
 *  - Authorization: RFC 8292 VAPID, ES256 JWT (`vapid t=<jwt>, k=<publicKey>`).
 *  - SSRF guard: only https endpoints on known push-service hosts are contacted.
 */

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** publicKey: base64url uncompressed P-256 point (65 bytes); privateKey: base64url 32-byte d; subject: mailto: or https: URL. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface EncryptOptions {
  /** Fixed 16-byte salt (tests only). */
  salt?: Uint8Array;
  /** Fixed sender key pair, base64url like VapidKeys (tests only). */
  localKeyPair?: { publicKey: string; privateKey: string };
}

export interface SendOptions {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
  fetchImpl?: typeof fetch;
  /** Test harness only: extra exact hostnames allowed (http permitted only for loopback). */
  allowHosts?: string[];
}

export class WebPushError extends Error {}

type Bytes = Uint8Array<ArrayBuffer>;

const RECORD_SIZE = 4096;
/** 4096 - 16 (GCM tag) - 1 (delimiter) - 86 (header: salt 16 + rs 4 + idlen 1 + key 65). */
export const MAX_PAYLOAD_BYTES = 3993;
const MAX_VAPID_EXP_SECONDS = 24 * 60 * 60;

const PUSH_HOSTS_EXACT = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const enc = new TextEncoder();

// ---------- encoding helpers ----------

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Bytes {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new WebPushError('invalid base64url');
  const b64 = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function copy(u: Uint8Array): Bytes {
  return new Uint8Array(u);
}

// ---------- crypto helpers ----------

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', copy(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, copy(data)));
}

function assertPoint(raw: Uint8Array, what: string): void {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new WebPushError(`${what} must be a 65-byte uncompressed P-256 point`);
}

function importPublic(raw: Uint8Array, alg: 'ECDH' | 'ECDSA'): Promise<CryptoKey> {
  assertPoint(raw, 'public key');
  return crypto.subtle.importKey('raw', copy(raw), { name: alg, namedCurve: 'P-256' }, true, alg === 'ECDSA' ? ['verify'] : []);
}

/** WebCrypto cannot import a bare `d`, so build a JWK from the public point plus d. */
function importPrivate(publicKey: string, privateKey: string, alg: 'ECDH' | 'ECDSA'): Promise<CryptoKey> {
  const pub = b64urlDecode(publicKey);
  assertPoint(pub, 'public key');
  const d = b64urlDecode(privateKey);
  if (d.length !== 32) throw new WebPushError('private key must be 32 bytes');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.subarray(1, 33)),
    y: b64urlEncode(pub.subarray(33, 65)),
    d: b64urlEncode(d),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: alg, namedCurve: 'P-256' }, false, alg === 'ECDSA' ? ['sign'] : ['deriveBits']);
}

/** Generate a VAPID (or any P-256) key pair in the `web-push generate-vapid-keys` format. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  if (!jwk.d) throw new WebPushError('key export failed');
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d };
}

// ---------- RFC 8291 / RFC 8188 ----------

export async function encryptPayload(sub: PushSubscriptionJson, payload: Uint8Array, opts: EncryptOptions = {}): Promise<Uint8Array> {
  if (payload.length > MAX_PAYLOAD_BYTES) throw new WebPushError(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  if (authSecret.length !== 16) throw new WebPushError('auth secret must be 16 bytes');
  const uaKey = await importPublic(uaPublic, 'ECDH');

  const local = opts.localKeyPair ?? (await generateVapidKeys());
  const asPublic = b64urlDecode(local.publicKey);
  const asPrivate = await importPrivate(local.publicKey, local.privateKey, 'ECDH');

  const salt = opts.salt ? copy(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new WebPushError('salt must be 16 bytes');

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  // HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);

  // RFC 8188 content keys.
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, concat(payload, new Uint8Array([2]))),
  );

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, record);
}

// ---------- RFC 8292 VAPID ----------

export async function vapidAuthHeader(endpoint: string, vapid: VapidKeys, expSeconds = 12 * 60 * 60, now = Date.now()): Promise<string> {
  if (!/^(mailto:|https:\/\/)/.test(vapid.subject)) throw new WebPushError('VAPID subject must be a mailto: or https: URL');
  if (!(expSeconds > 0 && expSeconds <= MAX_VAPID_EXP_SECONDS)) throw new WebPushError('VAPID expiry must be within 24 hours');
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + Math.floor(expSeconds), sub: vapid.subject })));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivate(vapid.publicKey, vapid.privateKey, 'ECDSA');
  // WebCrypto returns the raw r||s (IEEE P1363) signature, which is exactly the JWS ES256 form.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

// ---------- SSRF guard ----------

export function assertPushEndpoint(endpoint: string, allowHosts: string[] = []): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new WebPushError('invalid push endpoint');
  }
  const host = url.hostname.toLowerCase();
  if (url.username || url.password) throw new WebPushError('push endpoint must not carry credentials');
  if (allowHosts.includes(host)) {
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && LOOPBACK.has(host)) return url;
    throw new WebPushError('push endpoint must use https');
  }
  if (url.protocol !== 'https:') throw new WebPushError('push endpoint must use https');
  if (url.port && url.port !== '443') throw new WebPushError('push endpoint must use the default port');
  const known = PUSH_HOSTS_EXACT.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
  if (!known) throw new WebPushError('push endpoint host is not a known push service');
  return url;
}

// ---------- send ----------

export async function sendPush(
  sub: PushSubscriptionJson,
  payloadJson: unknown,
  vapid: VapidKeys,
  opts: SendOptions = {},
): Promise<{ status: number; gone: boolean }> {
  const url = assertPushEndpoint(sub.endpoint, opts.allowHosts);
  const payload = enc.encode(JSON.stringify(payloadJson));
  if (payload.length > MAX_PAYLOAD_BYTES) throw new WebPushError(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  const ttl = opts.ttl ?? 24 * 60 * 60;
  if (!Number.isInteger(ttl) || ttl < 0) throw new WebPushError('TTL must be a non-negative integer');
  if (opts.topic !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) throw new WebPushError('topic must be 1-32 base64url characters');

  const body = await encryptPayload(sub, payload);
  const headers: Record<string, string> = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: opts.urgency ?? 'normal',
    Authorization: await vapidAuthHeader(url.href, vapid),
  };
  if (opts.topic) headers.Topic = opts.topic;

  const f = opts.fetchImpl ?? fetch;
  const res = await f(url.href, { method: 'POST', headers, body: copy(body), redirect: 'manual' });
  await res.body?.cancel();
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
}
