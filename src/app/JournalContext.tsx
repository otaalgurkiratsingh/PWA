import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LocalProfile, RestTimer } from '@shared/contracts';
import { Journal } from '@/core/database/journal';
import { seedDemoIfEmpty } from '@/core/database/seed';
import { syncExclusive } from '@/core/sync/engine';
import { recordConsent, supabaseTransport, type ConsentType } from '@/core/sync/supabaseTransport';
import { deviceTimezone, localDateIn } from '@/core/time/localDate';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export type SyncState =
  | { kind: 'local_only' } // demo, or the member chose not to back up
  | { kind: 'idle'; pending: number; lastSyncedAt: string | null }
  | { kind: 'syncing'; pending: number }
  | { kind: 'offline'; pending: number }
  | { kind: 'error'; pending: number; message: string };

export type Mode = 'demo' | 'account';

interface Ctx {
  journal: Journal;
  mode: Mode;
  email: string | null;
  profile: LocalProfile;
  today: string;
  revision: number;
  refresh: () => void;
  notify: (t: Omit<Toast, 'id'>) => void;
  timer: RestTimer | null;
  setTimer: (t: RestTimer | null) => Promise<void>;
  updateProfile: (p: LocalProfile) => Promise<void>;
  sync: SyncState;
  syncNow: () => Promise<void>;
  /** Record pending permission changes in the cloud ledger now (before uploads or AI calls). */
  flushConsents: () => Promise<void>;
  conflictsCount: number;
}

const JournalCtx = createContext<Ctx | null>(null);
const SetupCtx = createContext<{ journal: Journal; mode: Mode; email: string | null; complete: (p: LocalProfile) => Promise<void> } | null>(null);
const ToastCtx = createContext<{ toast: Toast | null; dismiss: () => void }>({ toast: null, dismiss: () => {} });

const PENDING_CONSENT_KEY = 'pending_consent';

export function JournalProvider({ ownerId, mode, email, onboarding, children }: {
  ownerId: string;
  mode: Mode;
  email: string | null;
  /** Rendered instead of the app when a signed-in member has no profile yet. */
  onboarding: ReactNode;
  children: ReactNode;
}) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [timer, setTimerState] = useState<RestTimer | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [today, setToday] = useState(() => localDateIn(deviceTimezone()));
  const [sync, setSync] = useState<SyncState>({ kind: 'local_only' });
  const [conflictsCount, setConflictsCount] = useState(0);
  const syncTimer = useRef<number | undefined>(undefined);
  const commitListener = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: Journal | null = null;
    (async () => {
      try {
        const tz = deviceTimezone();
        const j = await Journal.open(ownerId, { onCommit: () => commitListener.current?.() });
        opened = j;
        if (mode === 'demo') await seedDemoIfEmpty(j, ownerId, localDateIn(tz), tz);
        const p = await j.getProfile();
        const t = await j.getTimer();
        if (cancelled) return j.close();
        setTimerState(t);
        setProfile(p);
        setJournal(j);
        setConflictsCount((await j.conflicts()).length);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(syncTimer.current);
      opened?.close();
    };
  }, [ownerId, mode]);

  const backupEnabled = mode === 'account' && Boolean(profile?.consent.cloud_backup);

  const flushConsent = useCallback(async (j: Journal) => {
    const queue = (await j.getMeta<{ type: ConsentType; granted: boolean }[]>(PENDING_CONSENT_KEY)) ?? [];
    while (queue.length) {
      const c = queue[0]!;
      await recordConsent(c.type, c.granted);
      queue.shift();
      await j.setMeta(PENDING_CONSENT_KEY, queue);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!journal || mode !== 'account') return;
    const pending = (await journal.pendingOps()).length;
    // Consent decisions are recorded even when backup itself is off.
    if (navigator.onLine) await flushConsent(journal).catch(() => undefined);
    if (!profile?.consent.cloud_backup) return setSync({ kind: 'local_only' });
    if (!navigator.onLine) return setSync({ kind: 'offline', pending });
    setSync({ kind: 'syncing', pending });
    try {
      const r = await syncExclusive(journal, supabaseTransport);
      if (!r) return;
      setSync({ kind: 'idle', pending: r.pending, lastSyncedAt: new Date().toISOString() });
      setConflictsCount((await journal.conflicts()).length);
      if (r.pulled || r.conflicts) {
        const p = await journal.getProfile();
        if (p) setProfile(p);
        setRevision((x) => x + 1);
      }
    } catch {
      setSync({ kind: navigator.onLine ? 'error' : 'offline', pending: (await journal.pendingOps()).length, message: 'Couldn’t back up just now. Your entries are safe on this phone.' } as SyncState);
    }
  }, [journal, mode, flushConsent, profile?.consent.cloud_backup]);

  // Schedule sync shortly after each local save; on network return; when visible; every 60 s in the foreground.
  useEffect(() => {
    if (!journal || mode !== 'account') return;
    commitListener.current = () => {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void syncNow(), 1500);
    };
    const first = window.setTimeout(() => void syncNow(), 0);
    const onVisible = () => document.visibilityState === 'visible' && void syncNow();
    window.addEventListener('online', onVisible);
    window.addEventListener('offline', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60_000);
    return () => {
      commitListener.current = null;
      window.clearTimeout(first);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('offline', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [journal, mode, syncNow, backupEnabled]);


  useEffect(() => {
    const tick = () => setToday(localDateIn(profile?.timezone ?? deviceTimezone()));
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [profile?.timezone]);

  const notify = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.action ? 6000 : 3200);
    return () => window.clearTimeout(id);
  }, [toast]);
  const dismiss = useCallback(() => setToast(null), []);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const updateProfile = useCallback(async (p: LocalProfile) => {
    if (!journal) return;
    const prev = profile ?? null;
    const TYPES: ConsentType[] = ['cloud_backup', 'ai_processing', 'photo_storage', 'ai_images'];
    const changed = TYPES.filter((t) => !prev || prev.consent[t] !== p.consent[t]);
    await journal.setProfile(p);
    if (mode === 'account' && changed.length) {
      // Each permission is recorded separately in the append-only ledger (the server checks the latest).
      const queue = (await journal.getMeta<{ type: ConsentType; granted: boolean }[]>(PENDING_CONSENT_KEY)) ?? [];
      for (const t of changed) queue.push({ type: t, granted: p.consent[t] });
      await journal.setMeta(PENDING_CONSENT_KEY, queue);
    }
    setProfile(p);
    // Sync runs from the profile-change effect (it needs the updated consent).
  }, [journal, mode, profile]);

  const value = useMemo<Ctx | null>(() => {
    if (!journal || !profile) return null;
    return {
      journal, mode, email, profile, today, revision, refresh, notify, timer,
      setTimer: async (t) => {
        await journal.setTimer(t);
        setTimerState(t);
      },
      updateProfile, sync, syncNow, conflictsCount,
      flushConsents: () => flushConsent(journal),
    };
  }, [journal, mode, email, profile, today, revision, refresh, notify, timer, updateProfile, sync, syncNow, conflictsCount, flushConsent]);

  if (error) {
    return (
      <main className="app no-nav">
        <div className="card stack" role="alert" style={{ marginTop: 48 }}>
          <h2>TrainLuma can’t open its storage on this device</h2>
          <p className="muted">Private browsing, blocked site data, or a full disk can cause this. Nothing was sent anywhere.</p>
          <button className="btn" onClick={() => location.reload()}>Try again</button>
        </div>
      </main>
    );
  }
  if (!journal || profile === undefined) {
    return (
      <main className="app no-nav" aria-busy="true">
        <div className="stack" style={{ marginTop: 56 }}>
          <div className="skeleton" />
          <div className="skeleton" style={{ minHeight: 160 }} />
          <div className="skeleton" />
        </div>
      </main>
    );
  }
  if (!value) {
    return (
      <SetupCtx.Provider value={{ journal, mode, email, complete: updateProfile }}>
        <ToastCtx.Provider value={{ toast, dismiss }}>{onboarding}</ToastCtx.Provider>
      </SetupCtx.Provider>
    );
  }
  return (
    <JournalCtx.Provider value={value}>
      <ToastCtx.Provider value={{ toast, dismiss }}>{children}</ToastCtx.Provider>
    </JournalCtx.Provider>
  );
}

export function useJournal(): Ctx {
  const c = useContext(JournalCtx);
  if (!c) throw new Error('useJournal outside provider');
  return c;
}

/** For components rendered both inside and outside a journal (e.g. toasts during onboarding). */
export function useJournalOptional(): Ctx | null {
  return useContext(JournalCtx);
}

export function useSetup() {
  const c = useContext(SetupCtx);
  if (!c) throw new Error('useSetup outside onboarding');
  return c;
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Run an async query whenever the journal revision or deps change. */
export function useQuery<T>(fn: (j: Journal) => Promise<T>, deps: unknown[]): T | undefined {
  const { journal, revision } = useJournal();
  const [data, setData] = useState<T | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fn(journal).then((d) => live && setData(d));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, revision, ...deps]);
  return data;
}
