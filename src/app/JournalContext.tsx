import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LocalProfile, RestTimer } from '@shared/contracts';
import { Journal } from '@/core/database/journal';
import { seedDemoIfEmpty } from '@/core/database/seed';
import { deviceTimezone, localDateIn } from '@/core/time/localDate';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface Ctx {
  journal: Journal;
  profile: LocalProfile;
  today: string;
  /** Increments after every local write; screens re-query on change. */
  revision: number;
  refresh: () => void;
  notify: (t: Omit<Toast, 'id'>) => void;
  timer: RestTimer | null;
  setTimer: (t: RestTimer | null) => Promise<void>;
  switchProfile: (id: string) => void;
  updateProfile: (p: LocalProfile) => Promise<void>;
}

const JournalCtx = createContext<Ctx | null>(null);
const ToastCtx = createContext<{ toast: Toast | null; dismiss: () => void }>({ toast: null, dismiss: () => {} });

const PROFILE_KEY = 'aapnafit.activeProfile';

function readActiveProfile(): string {
  try {
    return localStorage.getItem(PROFILE_KEY) ?? 'demo-a';
  } catch {
    return 'demo-a';
  }
}

export function JournalProvider({ children }: { children: ReactNode }) {
  const [profileId, setProfileId] = useState(readActiveProfile);
  const [state, setState] = useState<{ journal: Journal; profile: LocalProfile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [timer, setTimerState] = useState<RestTimer | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [today, setToday] = useState(() => localDateIn(deviceTimezone()));

  useEffect(() => {
    let cancelled = false;
    let opened: Journal | null = null;
    (async () => {
      try {
        const tz = deviceTimezone();
        const j = await Journal.open(profileId);
        opened = j;
        await seedDemoIfEmpty(j, profileId, localDateIn(tz), tz);
        const profile = await j.getProfile();
        if (!profile) throw new Error('Profile missing after setup');
        const t = await j.getTimer();
        if (cancelled) return j.close();
        setTimerState(t);
        setState({ journal: j, profile });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [profileId]);

  // Keep "today" correct across midnight and when returning to the app.
  useEffect(() => {
    const tick = () => setToday(localDateIn(state?.profile.timezone ?? deviceTimezone()));
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [state?.profile.timezone]);

  const notify = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.action ? 7000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast]);
  const dismiss = useCallback(() => setToast(null), []);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const value = useMemo<Ctx | null>(() => {
    if (!state) return null;
    return {
      journal: state.journal,
      profile: state.profile,
      today,
      revision,
      refresh,
      notify,
      timer,
      setTimer: async (t) => {
        await state.journal.setTimer(t);
        setTimerState(t);
      },
      switchProfile: (id) => {
        try {
          localStorage.setItem(PROFILE_KEY, id);
        } catch {
          // storage unavailable: switch for this session only
        }
        setToast(null);
        setTimerState(null);
        setState(null); // unmount screens before the old database closes
        setProfileId(id);
      },
      updateProfile: async (p) => {
        await state.journal.setProfile(p);
        setState({ journal: state.journal, profile: p });
      },
    };
  }, [state, today, revision, refresh, notify, timer]);

  if (error) {
    return (
      <main className="app">
        <div className="card" role="alert">
          <h2>This device could not open local storage</h2>
          <p>{error}</p>
          <p className="muted small">
            Private browsing, blocked site data, or a full disk can cause this. Nothing was sent anywhere. Try a normal
            browser window, free up space, or reload.
          </p>
          <button className="btn" onClick={() => location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
  if (!value) {
    return (
      <main className="app" aria-busy="true">
        <div className="stack" style={{ marginTop: 48 }}>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </main>
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
