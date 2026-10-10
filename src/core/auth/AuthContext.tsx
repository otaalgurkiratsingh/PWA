import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { backendConfigured, supabase } from './supabase';

export type AuthStatus =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'demo' }
  | { kind: 'member'; userId: string; email: string | null; offline: boolean }
  | { kind: 'not_member'; email: string | null; membership: string }
  | { kind: 'error'; message: string };

interface AuthCtx {
  status: AuthStatus;
  configured: boolean;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  enterDemo(): void;
  exitDemo(): void;
  recheck(): void;
}

const Ctx = createContext<AuthCtx | null>(null);
const MODE_KEY = 'rozana.mode';
/** Last time this device confirmed an active membership for a user (allows offline gym use). */
const VERIFIED_KEY = 'rozana.memberVerified';
const OFFLINE_GRACE_MS = 14 * 24 * 3600 * 1000;

function readMode(): string | null {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

async function resolveMember(session: Session): Promise<AuthStatus> {
  const email = session.user.email ?? null;
  try {
    const { data, error } = await (await supabase()).rpc('my_membership');
    if (error) throw error;
    const m = String(data);
    if (m === 'active') {
      writeLocal(VERIFIED_KEY, JSON.stringify({ user: session.user.id, at: Date.now() }));
      return { kind: 'member', userId: session.user.id, email, offline: false };
    }
    writeLocal(VERIFIED_KEY, null);
    return { kind: 'not_member', email, membership: m };
  } catch {
    // Offline: allow this device's previously verified member to keep using local data.
    try {
      const v = JSON.parse(localStorage.getItem(VERIFIED_KEY) ?? 'null') as { user: string; at: number } | null;
      if (v && v.user === session.user.id && Date.now() - v.at < OFFLINE_GRACE_MS) {
        return { kind: 'member', userId: session.user.id, email, offline: true };
      }
    } catch {
      // fall through
    }
    return { kind: 'error', message: 'We couldn’t confirm your account. Check your connection and try again.' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = backendConfigured();
  const [status, setStatus] = useState<AuthStatus>({ kind: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const done = (s: AuthStatus) => live && setStatus(s);
    (async () => {
      if (readMode() === 'demo') return done({ kind: 'demo' });
      if (!configured) return done({ kind: 'signed_out' });
      const { data } = await (await supabase()).auth.getSession();
      if (!data.session) return done({ kind: 'signed_out' });
      done(await resolveMember(data.session));
    })().catch(() => done({ kind: 'signed_out' }));
    if (!configured) return () => void (live = false);
    let unsubscribe: (() => void) | null = null;
    void supabase().then((sb) => {
      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') done(readMode() === 'demo' ? { kind: 'demo' } : { kind: 'signed_out' });
        if (event === 'SIGNED_IN' && session) void resolveMember(session).then(done);
      });
      if (live) unsubscribe = () => sub.subscription.unsubscribe();
      else sub.subscription.unsubscribe();
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [configured, tick]);

  const sendCode = useCallback(async (email: string) => {
    const { error } = await (await supabase()).auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw error;
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { data, error } = await (await supabase()).auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
    if (data.session) setStatus(await resolveMember(data.session));
  }, []);

  const signOut = useCallback(async () => {
    writeLocal(VERIFIED_KEY, null);
    if (configured) await (await supabase()).auth.signOut({ scope: 'local' }).catch(() => undefined);
    setStatus({ kind: 'signed_out' });
  }, [configured]);

  const value = useMemo<AuthCtx>(() => ({
    status,
    configured,
    sendCode,
    verifyCode,
    signOut,
    enterDemo: () => {
      writeLocal(MODE_KEY, 'demo');
      setStatus({ kind: 'demo' });
    },
    exitDemo: () => {
      writeLocal(MODE_KEY, null);
      setStatus({ kind: 'loading' });
      setTick((t) => t + 1);
    },
    recheck: () => {
      setStatus({ kind: 'loading' });
      setTick((t) => t + 1);
    },
  }), [status, configured, sendCode, verifyCode, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
