/**
 * Scripted stand-in for a Supabase project (Auth, PostgREST RPCs, Edge Function) used by the
 * auth-harness e2e tests. It records every request so tests can assert what the browser sent.
 * This proves the APP's behaviour; it does not prove live Supabase JWT verification.
 */
import type { Page, Route } from '@playwright/test';

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
}

function b64url(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

export function fakeJwt(u: MockUser) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}.c2ln`;
}

export class MockSupabase {
  requests: Recorded[] = [];
  docs = new Map<string, { version: number; body: unknown }>();
  consent: { consent_type: string; granted: boolean }[] = [];
  aiResponses: Record<string, unknown> = {};
  proposals: { id: string; before_value: unknown; after_value: unknown; status: string }[] = [];
  reviews: unknown[] = [];
  decided: { id: string; decision: string }[] = [];
  current: MockUser | null = null;

  constructor(readonly users: MockUser[], readonly validCode = '123456') {}

  async install(page: Page) {
    await page.route(`${FAKE_URL}/**`, (route) => this.handle(route));
  }

  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
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
    this.requests.push({ method: req.method(), path: url.pathname + url.search, body, headers });
    const p = url.pathname;

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
      const now = Math.floor(Date.now() / 1000);
      return this.json(route, 200, {
        access_token: fakeJwt(u), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-e2e',
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (p === '/auth/v1/user') {
      const u = this.userFromAuth(headers);
      return u ? this.json(route, 200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' }) : this.json(route, 401, { msg: 'invalid JWT' });
    }

    const caller = this.userFromAuth(headers);
    if (p.startsWith('/rest/v1/rpc/my_membership')) return this.json(route, 200, caller?.membership ?? 'none');
    if (p.startsWith('/rest/v1/') && (!caller || caller.membership !== 'active')) return this.json(route, 401, { message: 'not authorized' });

    if (p === '/rest/v1/rpc/sync_push') {
      const ops = (body as { p_ops: { op_id: string; collection: string; doc_id: string; base_version: number; body: { owner_id: string } }[] }).p_ops;
      const out = ops.map((op) => {
        if (op.body.owner_id !== caller!.id) return { op_id: op.op_id, status: 'rejected' };
        const k = `${caller!.id}:${op.collection}:${op.doc_id}`;
        const v = (this.docs.get(k)?.version ?? 0) + 1;
        this.docs.set(k, { version: v, body: op.body });
        return { op_id: op.op_id, status: 'applied', server_version: v };
      });
      return this.json(route, 200, out);
    }
    if (p === '/rest/v1/rpc/sync_pull') return this.json(route, 200, []);
    if (p === '/rest/v1/consent_events') {
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows as { consent_type: string; granted: boolean }[]) this.consent.push(r);
      return route.fulfill({ status: 201, body: '' });
    }
    if (p === '/rest/v1/rpc/my_ai_usage') return this.json(route, 200, { photo_today: 0, questions_today: 1, reviews_week: 0, limits: { photo_per_day: 3, question_per_day: 5, review_per_week: 1 } });
    if (p === '/rest/v1/coach_reviews') return this.json(route, 200, this.reviews);
    if (p === '/rest/v1/change_proposals') return this.json(route, 200, this.proposals);
    if (p === '/rest/v1/user_confirmed_memory') return req.method() === 'GET' ? this.json(route, 200, []) : route.fulfill({ status: 201, body: '' });
    if (p === '/rest/v1/rpc/decide_change_proposal') {
      const b = body as { p_proposal_id: string; p_decision: string };
      this.decided.push({ id: b.p_proposal_id, decision: b.p_decision });
      const prop = this.proposals.find((x) => x.id === b.p_proposal_id);
      if (prop) prop.status = b.p_decision;
      return this.json(route, 200, prop ?? null);
    }
    if (p === '/functions/v1/ai') {
      if (!caller) return this.json(route, 401, { status: 'error', error: 'unauthenticated', message: 'Please sign in again.' });
      const op = (body as { operation: string }).operation;
      return this.json(route, 200, this.aiResponses[op] ?? { status: 'error', error: 'not_configured', message: 'The coach is not set up yet.' });
    }
    return this.json(route, 404, { message: `unmocked ${p}` });
  }
}
