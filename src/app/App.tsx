import { useEffect, useState } from 'react';
import { NavIcon } from '@/core/design/icons';
import { formatLongDate } from '@/core/time/localDate';
import { MealsScreen } from '@/features/meals/MealsScreen';
import { ProgressScreen } from '@/features/progress/ProgressScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { TodayScreen } from '@/features/today/TodayScreen';
import { RestTimerBar } from '@/features/train/RestTimerBar';
import { TrainScreen } from '@/features/train/TrainScreen';
import { JournalProvider, useJournal, useToast } from './JournalContext';
import { navigate, useRoute, type Route } from './router';
import { onUpdateReady, applyUpdate } from './serviceWorker';

const TITLES: Record<Route, string> = { today: 'Today', meals: 'Meals', train: 'Train', progress: 'Progress', settings: 'Settings' };
const NAV: Exclude<Route, 'settings'>[] = ['today', 'meals', 'train', 'progress'];

function ToastView() {
  const { toast, dismiss } = useToast();
  if (!toast) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast${toast.kind === 'error' ? ' error' : ''}`} key={toast.id}>
        <span className="msg">{toast.message}</span>
        {toast.action ? (
          <button className="btn" onClick={() => { toast.action!.run(); dismiss(); }}>{toast.action.label}</button>
        ) : null}
        <button className="btn" aria-label="Dismiss" onClick={dismiss}>×</button>
      </div>
    </div>
  );
}

function UpdatePrompt() {
  const { journal } = useJournal();
  const [ready, setReady] = useState(false);
  const [activeWorkout, setActiveWorkout] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  useEffect(() => {
    if (ready) void journal.activeSession().then((s) => setActiveWorkout(!!s));
  }, [ready, journal]);
  if (!ready || activeWorkout) return null; // never swap the app mid-workout
  return (
    <div className="card" role="status" style={{ marginBottom: 12 }}>
      <div className="row">
        <span className="small" style={{ flex: 1 }}>An app update is ready. Your saved entries are kept.</span>
        <button className="btn" onClick={applyUpdate}>Update</button>
      </div>
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const { profile, today } = useJournal();
  useEffect(() => {
    document.title = `${TITLES[route]} · AapnaFit`;
  }, [route]);
  const Screen = { today: TodayScreen, meals: MealsScreen, train: TrainScreen, progress: ProgressScreen, settings: SettingsScreen }[route];
  return (
    <>
      <main className="app" id="main">
        <header className="topbar">
          <div>
            <h1>{TITLES[route]}</h1>
            <p className="sub">{formatLongDate(today)}</p>
          </div>
          <button className="avatar-btn" onClick={() => navigate('settings')} aria-label={`Profile and settings for ${profile.nickname}`}>
            <span className="dot" aria-hidden="true">{profile.nickname.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
            {profile.nickname}
          </button>
        </header>
        {profile.synthetic ? (
          <div className="demo-banner" role="note">
            <strong>Demo</strong>
            <span>Synthetic data only — placeholder nutrition numbers, fictional plan. Saved only on this device; no cloud, no AI.</span>
          </div>
        ) : null}
        <UpdatePrompt />
        <Screen key={`${profile.id}:${route}`} />
      </main>
      <RestTimerBar />
      <nav className="bottom-nav" aria-label="Main">
        <ul>
          {NAV.map((r) => (
            <li key={r}>
              <a href={`#/${r}`} aria-current={route === r ? 'page' : undefined} onClick={() => window.scrollTo({ top: 0 })}>
                <NavIcon name={r} />
                {TITLES[r]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <ToastView />
    </>
  );
}

export function App() {
  return (
    <JournalProvider>
      <Shell />
    </JournalProvider>
  );
}
