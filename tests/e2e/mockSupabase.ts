/**
 * Scripted stand-in for a Supabase project (Auth, PostgREST, Storage, Edge Function) used by the
 * auth-harness e2e tests. It records every request so tests can assert what the browser sent, and
 * filters every read by the caller (like RLS) so cross-account caching bugs in the APP show up.
 * This proves the APP's behaviour; database RLS itself is proven by `npm run test:db`.
 */
import type { Page, Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const FAKE_URL = 'https://abcdefghijklmnopqrst.supabase.co';

export interface MockUser {
  id: string;
  email: string;
  membership: 'active' | 'none' | 'revoked';
}

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  caller: string | null;
}

function b64url(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

export function fakeJwt(u: MockUser) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}.c2ln`;
}

export interface Thread { id: string; user_id: string; title: string; created_at: string; updated_at: string; expires_at: string }
export interface Message { id: string; thread_id: string; user_id: string; role: 'user' | 'assistant'; content: string; response: unknown; created_at: string; model_id: string | null; client_op_id: string }
export interface Draft { id: string; user_id: string; created_at: string; status: string; profile_version: number; source: string; plan: unknown; response: unknown; model_id: string; prompt_version: string }
export interface PhotoRow { id: string; user_id: string; slot: string; object_path: string; created_at: string; width: number; height: number; bytes: number }

type AiHandler = (op: string, body: Record<string, unknown>, caller: MockUser, sb: MockSupabase) => unknown;

/** Minimal schema-2.0 output builder for scripted replies. */
export function v2(over: Record<string, unknown> = {}) {
  return {
    schema_version: '2.0', status: 'suggestion_ready', summary: '', assistant_message: '', questions: [], observations: [], assumptions: [], limitations: [],
    suggestions: [], candidate_memories: [], safety: { state: 'none', message: null }, plan: null, food_candidates: [], measurement_candidates: [], ...over,
  };
}

export function samplePlan(profileVersion: number) {
  const ex = (id: string) => ({ exercise_id: id, variant_id: null, working_sets: 3, rep_min: 8, rep_max: 12, target_load: null, load_unit: 'kg', rest_seconds: 90, effort_instruction: 'Controlled, comfortable effort', substitution_exercise_ids: ['leg_press:machine'], notes: '' });
  return {
    title: 'Three-day starter', status: 'draft', goal: 'strength', profile_version: String(profileVersion), schedule_mode: 'weekdays', duration_weeks_before_review: 4,
    warmup: [{ instruction: 'Easy bike or brisk walk', minutes: 5 }],
    days: [
      { label: 'Lower body', weekday: 1, estimated_minutes: 42, exercises: [ex('squat:barbell'), ex('romanian_deadlift:dumbbell'), ex('plank:bodyweight')] },
      { label: 'Upper body', weekday: 3, estimated_minutes: 40, exercises: [ex('bench_press:dumbbell'), ex('row:cable'), ex('lateral_raise:dumbbell')] },
      { label: 'Full body', weekday: 5, estimated_minutes: 38, exercises: [ex('goblet_squat:dumbbell'), ex('push_up:bodyweight'), ex('lat_pulldown:cable')] },
    ],
    recovery_notes: ['Leave a rest day between sessions.'], progression_rule: 'When every set reaches the top of the rep range with good form, add a small amount of weight next time.', review_trigger: 'After 4 weeks or if anything hurts.',
  };
}

export class MockSupabase {
  requests: Recorded[] = [];
  docs = new Map<string, { version: number; body: unknown }>();
  consent: { user_id: string; consent_type: string; granted: boolean; notice_version?: string }[] = [];
  aiResponses: Record<string, unknown> = {};
  aiHandler: AiHandler | null = null;
  proposals: { id: string; before_value: unknown; after_value: unknown; status: string }[] = [];
  reviews: unknown[] = [];
  decided: { id: string; decision: string }[] = [];
  threads: Thread[] = [];
  messages: Message[] = [];
  drafts: Draft[] = [];
  photos: PhotoRow[] = [];
  objects = new Map<string, { owner: string; bytes: number }>();
  memory: { id: string; user_id: string; fact: string }[] = [];
  usage = { questions_today: 0, limit: 20 };
  current: MockUser | null = null;

  constructor(readonly users: MockUser[], readonly validCode = '123456') {}

  async install(page: Page) {
    await page.route(`${FAKE_URL}/**`, (route) => this.handle(route));
  }

  latestConsent(user: string, type: string): boolean {
    return [...this.consent].reverse().find((c) => c.user_id === user && c.consent_type === type)?.granted ?? false;
  }

  /** The synced settings document of a user (what the real backend would read). */
  profileOf(user: string): Record<string, unknown> | null {
    for (const [k, d] of this.docs) if (k.startsWith(`${user}:settings:`)) return ((d.body as { profile: Record<string, unknown> }).profile);
    return null;
  }

  aiCalls(op?: string) {
    return this.requests.filter((r) => r.path === '/functions/v1/ai' && (!op || (r.body as { operation?: string }).operation === op));
  }

  private json(route: Route, status: number, body: unknown, extra: Record<string, string> = {}) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', ...extra } });
  }

  private userFromAuth(headers: Record<string, string>): MockUser | null {
    const token = headers.authorization?.replace(/^Bearer /, '');
    if (!token || token.split('.').length !== 3) return null;
    try {
      const sub = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub;
      return this.users.find((u) => u.id === sub) ?? null;
    } catch {
      return null;
    }
  }

  /** PostgREST-ish filters: col=eq.x, col=in.(a,b), col=is.null, order, limit. */
  private filter<T extends Record<string, unknown>>(rows: T[], url: URL): T[] {
    let out = [...rows];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('in.(')) {
        const vals = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, ''));
        out = out.filter((r) => vals.includes(String(r[k])));
      } else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    }
    const order = url.searchParams.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out.sort((a, b) => String(a[col!]).localeCompare(String(b[col!])) * (dir === 'desc' ? -1 : 1));
    }
    const limit = Number(url.searchParams.get('limit') ?? '0');
    return limit ? out.slice(0, limit) : out;
  }

  private rows(route: Route, headers: Record<string, string>, rows: unknown[]) {
    if ((headers.accept ?? '').includes('vnd.pgrst.object')) {
      return rows.length ? this.json(route, 200, rows[0]) : this.json(route, 406, { code: 'PGRST116', message: 'no rows' });
    }
    return this.json(route, 200, rows);
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const headers = req.headers();
    let body: unknown;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const caller = this.userFromAuth(headers);
    const isStorageUpload = url.pathname.startsWith('/storage/') && req.method() === 'POST';
    this.requests.push({ method: req.method(), path: url.pathname + url.search, body: isStorageUpload ? '<bytes>' : body, headers, caller: caller?.id ?? null });
    const p = url.pathname;
    const now = new Date().toISOString();

    if (p === '/auth/v1/otp') {
      const email = (body as { email: string }).email;
      const u = this.users.find((x) => x.email === email);
      const create = (body as { create_user?: boolean }).create_user;
      if (!u && create === false) return this.json(route, 422, { code: 'otp_disabled', error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
      return this.json(route, 200, {});
    }
    if (p === '/auth/v1/verify') {
      const { email, token } = body as { email: string; token: string };
      const u = this.users.find((x) => x.email === email);
      if (!u || token !== this.validCode) return this.json(route, 403, { code: 'otp_expired', error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      this.current = u;
      const n = Math.floor(Date.now() / 1000);
      return this.json(route, 200, {
        access_token: fakeJwt(u), token_type: 'bearer', expires_in: 3600, expires_at: n + 3600, refresh_token: 'refresh-e2e',
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: now },
      });
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (p === '/auth/v1/user') {
      return caller ? this.json(route, 200, { id: caller.id, email: caller.email, aud: 'authenticated', role: 'authenticated' }) : this.json(route, 401, { msg: 'invalid JWT' });
    }

    if (p.startsWith('/rest/v1/rpc/my_membership')) return this.json(route, 200, caller?.membership ?? 'none');
    const active = caller && caller.membership === 'active';
    if ((p.startsWith('/rest/v1/') || p.startsWith('/storage/')) && !active) return this.json(route, 401, { message: 'not authorized' });
    const me = caller?.id ?? '';

    // ---- sync ----
    if (p === '/rest/v1/rpc/sync_push') {
      const ops = (body as { p_ops: { op_id: string; collection: string; doc_id: string; base_version: number; body: { owner_id: string } }[] }).p_ops;
      const out = ops.map((op) => {
        if (op.body.owner_id !== me) return { op_id: op.op_id, status: 'rejected' };
        const k = `${me}:${op.collection}:${op.doc_id}`;
        const v = (this.docs.get(k)?.version ?? 0) + 1;
        this.docs.set(k, { version: v, body: op.body });
        return { op_id: op.op_id, status: 'applied', server_version: v };
      });
      return this.json(route, 200, out);
    }
    if (p === '/rest/v1/rpc/sync_pull') return this.json(route, 200, []);
    if (p === '/rest/v1/consent_events') {
      if (req.method() === 'GET') return this.json(route, 200, []);
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows as { consent_type: string; granted: boolean; notice_version?: string }[]) this.consent.push({ ...r, user_id: me });
      return route.fulfill({ status: 201, body: '' });
    }

    // ---- coach data (every read filtered to the caller, like RLS) ----
    if (p === '/rest/v1/rpc/my_ai_usage') {
      return this.json(route, 200, { photo_today: 0, questions_today: this.usage.questions_today, reviews_week: 0, plans_week: 0, has_first_plan: false, limits: { photo_per_day: 3, question_per_day: this.usage.limit, review_per_week: 1, plan_regen_per_week: 2 } });
    }
    if (p === '/rest/v1/coach_reviews') return this.json(route, 200, this.reviews);
    if (p === '/rest/v1/change_proposals') return this.json(route, 200, this.proposals);
    if (p === '/rest/v1/user_confirmed_memory') {
      if (req.method() === 'GET') return this.json(route, 200, this.memory.filter((m) => m.user_id === me));
      if (req.method() === 'POST') {
        const r = body as { fact: string };
        this.memory.push({ id: randomUUID(), user_id: me, fact: r.fact });
        return route.fulfill({ status: 201, body: '' });
      }
      return route.fulfill({ status: 204, body: '' });
    }
    if (p === '/rest/v1/rpc/decide_change_proposal') {
      const b = body as { p_proposal_id: string; p_decision: string };
      this.decided.push({ id: b.p_proposal_id, decision: b.p_decision });
      const prop = this.proposals.find((x) => x.id === b.p_proposal_id);
      if (prop) prop.status = b.p_decision;
      return this.json(route, 200, prop ?? null);
    }
    if (p === '/rest/v1/coach_threads') return this.rows(route, headers, this.filter(this.threads.filter((t) => t.user_id === me) as unknown as Record<string, unknown>[], url));
    if (p === '/rest/v1/coach_messages') return this.rows(route, headers, this.filter(this.messages.filter((m) => m.user_id === me) as unknown as Record<string, unknown>[], url));
    if (p === '/rest/v1/rpc/delete_coach_thread') {
      const id = (body as { p_thread_id: string | null }).p_thread_id;
      const mine = this.threads.filter((t) => t.user_id === me && (id === null || t.id === id)).map((t) => t.id);
      this.threads = this.threads.filter((t) => !mine.includes(t.id));
      this.messages = this.messages.filter((m) => !mine.includes(m.thread_id));
      return this.json(route, 200, mine.length);
    }
    if (p === '/rest/v1/plan_drafts') return this.rows(route, headers, this.filter(this.drafts.filter((d) => d.user_id === me) as unknown as Record<string, unknown>[], url));
    if (p === '/rest/v1/rpc/decide_plan_draft') {
      const b = body as { p_draft_id: string; p_decision: string; p_profile_version: number };
      const d = this.drafts.find((x) => x.id === b.p_draft_id && x.user_id === me);
      if (!d || d.status !== 'draft') return this.json(route, 200, { status: 'not_found' });
      if (b.p_decision === 'accepted' && d.profile_version !== b.p_profile_version) return this.json(route, 200, { status: 'stale' });
      d.status = b.p_decision;
      this.decided.push({ id: d.id, decision: b.p_decision });
      return this.json(route, 200, { status: b.p_decision, plan: b.p_decision === 'accepted' ? d.plan : null });
    }
    if (p === '/rest/v1/progress_photos') {
      if (req.method() === 'GET') return this.rows(route, headers, this.filter(this.photos.filter((x) => x.user_id === me) as unknown as Record<string, unknown>[], url));
      if (req.method() === 'POST') {
        const r = body as Omit<PhotoRow, 'user_id' | 'created_at'>;
        if (!this.latestConsent(me, 'photo_storage') || !r.object_path.startsWith(`${me}/`)) return this.json(route, 403, { message: 'new row violates row-level security policy' });
        const row: PhotoRow = { ...r, user_id: me, created_at: now };
        this.photos.push(row);
        return this.rows(route, headers, [row]);
      }
      if (req.method() === 'DELETE') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        this.photos = this.photos.filter((x) => !(x.user_id === me && x.id === id));
        return route.fulfill({ status: 204, body: '' });
      }
    }

    // ---- storage (private bucket, owner folder only) ----
    const obj = /^\/storage\/v1\/object\/(?:authenticated\/)?progress-photos\/(.+)$/.exec(p);
    if (obj && req.method() === 'POST') {
      const path = decodeURIComponent(obj[1]!);
      if (!path.startsWith(`${me}/`) || !this.latestConsent(me, 'photo_storage')) return this.json(route, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      this.objects.set(path, { owner: me, bytes: req.postDataBuffer()?.length ?? 0 });
      return this.json(route, 200, { Key: `progress-photos/${path}`, Id: randomUUID() });
    }
    if (obj && req.method() === 'GET') {
      const path = decodeURIComponent(obj[1]!);
      const o = this.objects.get(path);
      if (!o || o.owner !== me) return this.json(route, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      // A tiny valid JPEG stand-in.
      const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpg, headers: { 'access-control-allow-origin': '*' } });
    }
    if (p === '/storage/v1/object/progress-photos' && req.method() === 'DELETE') {
      const prefixes = (body as { prefixes: string[] }).prefixes ?? [];
      const removed = prefixes.filter((x) => this.objects.get(x)?.owner === me);
      for (const x of removed) this.objects.delete(x);
      return this.json(route, 200, removed.map((name) => ({ name })));
    }

    // ---- the ai Edge Function ----
    if (p === '/functions/v1/ai') {
      if (!caller) return this.json(route, 401, { status: 'error', error: 'unauthenticated', message: 'Please sign in again.' });
      const b = body as Record<string, unknown>;
      const op = b.operation as string;
      if (this.aiHandler) return this.json(route, 200, this.aiHandler(op, b, caller, this));
      return this.json(route, 200, this.aiResponses[op] ?? { status: 'error', error: 'not_configured', message: 'The coach is not set up yet.' });
    }
    return this.json(route, 404, { message: `unmocked ${p}` });
  }

  /** Behaves like the real function for chat (stores the exchange, replays by operation id). */
  chatReply(caller: MockUser, b: Record<string, unknown>, output: Record<string, unknown>) {
    const opId = b.operation_id as string;
    const prev = this.messages.find((m) => m.user_id === caller.id && m.client_op_id === opId && m.role === 'assistant');
    let threadId = (b.thread_id as string | null) ?? null;
    if (!prev) {
      if (threadId && !this.threads.some((t) => t.id === threadId && t.user_id === caller.id)) {
        return { status: 'error', error: 'thread_not_found', message: 'That chat was deleted or has expired. Start a new chat.' };
      }
      const now = new Date().toISOString();
      if (!threadId) {
        threadId = randomUUID();
        this.threads.push({ id: threadId, user_id: caller.id, title: String(b.message).slice(0, 60), created_at: now, updated_at: now, expires_at: now });
      }
      this.messages.push({ id: randomUUID(), thread_id: threadId, user_id: caller.id, role: 'user', content: String(b.message), response: null, created_at: now, model_id: null, client_op_id: opId });
      this.messages.push({ id: randomUUID(), thread_id: threadId, user_id: caller.id, role: 'assistant', content: String(output.assistant_message), response: output, created_at: new Date(Date.now() + 1).toISOString(), model_id: 'gemini-3.8-flash', client_op_id: opId });
      this.usage.questions_today++;
    } else threadId = prev.thread_id;
    const msg = this.messages.find((m) => m.user_id === caller.id && m.client_op_id === opId && m.role === 'assistant')!;
    return { status: 'ok', operation: 'coach_question', reply: { thread_id: threadId, message_id: msg.id, output, data_window: { from: '2026-09-27', to: '2026-10-10' }, model_id: 'gemini-3.8-flash', prompt_version: 'coach-2.0+test' } };
  }

  /** Behaves like the real function for plans: stale check against the synced profile, stores a draft. */
  planReply(caller: MockUser, b: Record<string, unknown>) {
    const prof = this.profileOf(caller.id);
    const version = Number(prof?.profile_version ?? -1);
    if (version !== Number(b.profile_version)) return { status: 'error', error: 'stale_profile', message: 'Your answers changed since you reviewed them.' };
    const plan = samplePlan(version);
    const now = new Date().toISOString();
    for (const d of this.drafts) if (d.user_id === caller.id && d.status === 'draft') d.status = 'superseded';
    const output = v2({ status: 'draft_ready', assistant_message: 'A three-day starting plan around your Monday, Wednesday and Friday. Start light and controlled.', plan });
    const draft: Draft = { id: randomUUID(), user_id: caller.id, created_at: now, status: 'draft', profile_version: version, source: String(b.source ?? 'onboarding'), plan, response: { ...output, plan: null }, model_id: 'gemini-3.8-flash', prompt_version: 'coach-2.0+test' };
    this.drafts.push(draft);
    return { status: 'ok', operation: 'onboarding_plan', output, draft: { id: draft.id, created_at: now, profile_version: version, plan, model_id: draft.model_id, prompt_version: draft.prompt_version }, model_id: 'gemini-3.8-flash' };
  }
}
