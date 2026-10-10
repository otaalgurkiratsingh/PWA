import { useEffect, useState, type ReactNode } from 'react';
import { DEMO_PROFILES } from '@shared/fixtures/demo';
import { AuthProvider, useAuth } from '@/core/auth/AuthContext';
import { Icon, Mark, type IconName } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';
import { watchSystemTheme } from '@/core/design/theme';
import { formatLongDate } from '@/core/time/localDate';
import { AccessScreen, WelcomeScreen } from '@/features/auth/WelcomeScreen';
import { ChatScreen } from '@/features/coach/ChatScreen';
import { CoachScreen } from '@/features/coach/CoachScreen';
import { DraftScreen } from '@/features/coach/DraftScreen';
import { PhotosScreen } from '@/features/photos/PhotosScreen';
import { FoodScreen } from '@/features/food/FoodScreen';
import { MealEditor } from '@/features/food/MealEditor';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { PlanningWizard } from '@/features/onboarding/PlanningWizard';
import { ProgressScreen } from '@/features/progress/ProgressScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { TodayScreen } from '@/features/today/TodayScreen';
import { PlanEditor } from '@/features/workout/PlanEditor';
import { RestDock } from '@/features/workout/RestDock';
import { WorkoutScreen } from '@/features/workout/WorkoutScreen';
import { JournalProvider, useJournal, useJournalOptional, useToast } from './JournalContext';
import { navigate, TABS, useRoute, type RouteName } from './router';
import { applyUpdate, onUpdateReady } from './serviceWorker';

const TITLES: Record<RouteName, string> = {
  today: 'Today', food: 'Food', workout: 'Workout', progress: 'Progress', settings: 'Settings', coach: 'AI Coach', chat: 'AI Coach chat', draft: 'Plan draft',
  plan: 'Edit plan', meal: 'Meal', photos: 'Progress photos', answers: 'Planning answers',
};
const NAV_ICON: Record<(typeof TABS)[number], IconName> = { today: 'today', food: 'food', workout: 'workout', progress: 'progress' };

function ToastView() {
  const { toast, dismiss } = useToast();
  const journal = useJournalOptional();
  if (!toast) return null;
  return (
    <div className={`toast-wrap${journal?.timer ? ' above-dock' : ''}`} role="status" aria-live="polite">
      <div className={`toast${toast.kind === 'error' ? ' error' : ''}`} key={toast.id}>
        <span className="msg">{toast.message}</span>
        {toast.action ? <button className="t-action" onClick={() => { toast.action!.run(); dismiss(); }}>{toast.action.label}</button> : null}
        <button aria-label="Dismiss" onClick={dismiss}><Icon name="close" size={18} /></button>
      </div>
    </div>
  );
}

function UpdatePrompt() {
  const { journal } = useJournal();
  const [ready, setReady] = useState(false);
  const [busyWorkout, setBusyWorkout] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  useEffect(() => {
    if (ready) void journal.activeSession().then((s) => setBusyWorkout(!!s));
  }, [ready, journal]);
  if (!ready || busyWorkout) return null; // never replace the app mid-workout
  return (
    <div className="notice row" role="status" style={{ marginBottom: 16 }}>
      <span className="grow">A new version is ready. Your entries are kept.</span>
      <button className="btn sm" onClick={applyUpdate}>Update</button>
    </div>
  );
}

function SyncChip() {
  const { sync, mode } = useJournal();
  if (mode !== 'account') return null;
  const [icon, text]: [IconName, string] =
    sync.kind === 'local_only' ? ['phone', 'On this phone']
      : sync.kind === 'syncing' ? ['cloud', 'Backing up']
        : sync.kind === 'offline' ? ['phone', sync.pending ? `${sync.pending} saved offline` : 'Offline']
          : sync.kind === 'error' ? ['phone', 'Saved on phone']
            : sync.pending ? ['cloud', `${sync.pending} to back up`] : ['cloudCheck', 'Backed up'];
  return (
    <button className="sync-chip" onClick={() => navigate('settings')} aria-label={`Backup status: ${text}. Open settings`}>
      <Icon name={icon} size={16} /> <span>{text}</span>
    </button>
  );
}

function DemoChip() {
  const { mode } = useJournal();
  const { exitDemo } = useAuth();
  const [open, setOpen] = useState(false);
  if (mode !== 'demo') return null;
  return (
    <>
      <button className="demo-chip" onClick={() => setOpen(true)}>Demo data</button>
      {open ? (
        <Sheet title="Demo data" onClose={() => setOpen(false)} actions={<button className="btn block" onClick={exitDemo}>Leave demo</button>}>
          <p className="muted">Everything here is made up: meals, nutrition numbers, history and the workout plan. It stays on this device and never mixes with a real account. The coach is off in the demo.</p>
        </Sheet>
      ) : null}
    </>
  );
}

function Header({ title }: { title: string }) {
  const { profile, today } = useJournal();
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p className="date">{formatLongDate(today)}</p>
      </div>
      <div className="header-actions">
        <DemoChip />
        <SyncChip />
        <button className="avatar" aria-label={`Profile and settings for ${profile.nickname}`} onClick={() => navigate('settings')}>
          {profile.nickname.slice(0, 1).toUpperCase()}
        </button>
      </div>
    </header>
  );
}

/** A signed-in member who hasn't finished onboarding continues the wizard (it resumes where it was). */
function Shell() {
  const { profile, mode } = useJournal();
  if (mode === 'account' && !profile.onboarded_at) return <><PlanningWizard mode="onboarding" /><ToastView /></>;
  return <AppShell />;
}

function AppShell() {
  const route = useRoute();
  const { profile } = useJournal();
  useEffect(() => {
    document.title = `${TITLES[route.name]} · TrainLuma`;
    window.scrollTo({ top: 0 });
  }, [route.name, route.param]);
  const isTab = (TABS as readonly string[]).includes(route.name);
  const focused = route.name === 'plan' || route.name === 'meal' || route.name === 'chat' || route.name === 'answers';
  let screen: ReactNode;
  switch (route.name) {
    case 'food': screen = <FoodScreen />; break;
    case 'workout': screen = <WorkoutScreen />; break;
    case 'progress': screen = <ProgressScreen />; break;
    case 'settings': screen = <SettingsScreen />; break;
    case 'coach': screen = <CoachScreen />; break;
    case 'chat': screen = <ChatScreen threadParam={route.param} />; break;
    case 'draft': screen = <DraftScreen draftId={route.param} />; break;
    case 'photos': screen = <PhotosScreen />; break;
    case 'answers': screen = <PlanningWizard mode="edit" />; break;
    case 'plan': screen = <PlanEditor />; break;
    case 'meal': screen = <MealEditor presetId={route.param} />; break;
    default: screen = <TodayScreen />;
  }
  return (
    <>
      <main className={`app${focused ? ' no-nav' : ''}`} id="main">
        {isTab ? <Header title={TITLES[route.name]} /> : focused && route.name !== 'chat' && route.name !== 'answers' ? <h1 className="sr-only">{TITLES[route.name]}</h1> : null}
        <UpdatePrompt />
        <div key={`${profile.id}:${route.name}:${route.param ?? ''}`}>{screen}</div>
      </main>
      {!focused ? <RestDock /> : null}
      {!focused ? (
        <nav className="bottom-nav" aria-label="Main">
          <ul>
            {TABS.map((t) => (
              <li key={t}>
                <a href={`#/${t}`} aria-current={route.name === t ? 'page' : undefined}>
                  <span className="nav-pill"><Icon name={NAV_ICON[t]} size={24} /></span>
                  {TITLES[t]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <ToastView />
    </>
  );
}

function Splash() {
  return (
    <main className="welcome" aria-busy="true" aria-label="Loading">
      <div className="hero" style={{ alignItems: 'center' }}>
        <Mark size={56} />
      </div>
    </main>
  );
}

function demoProfileId(): string {
  try {
    const id = localStorage.getItem('rozana.demoProfile');
    return DEMO_PROFILES.some((p) => p.id === id) ? id! : 'demo-a';
  } catch {
    return 'demo-a';
  }
}

function Root() {
  const { status } = useAuth();
  switch (status.kind) {
    case 'loading':
      return <Splash />;
    case 'signed_out':
      return <WelcomeScreen />;
    case 'not_member':
      return <AccessScreen kind="not_member" membership={status.membership} email={status.email} />;
    case 'error':
      return <AccessScreen kind="error" message={status.message} />;
    case 'demo':
      return (
        <JournalProvider key="demo" ownerId={demoProfileId()} mode="demo" email={null} onboarding={<Splash />}>
          <Shell />
        </JournalProvider>
      );
    case 'member':
      return (
        <JournalProvider key={status.userId} ownerId={status.userId} mode="account" email={status.email} onboarding={<Onboarding />}>
          <Shell />
        </JournalProvider>
      );
  }
}

export function App() {
  useEffect(() => watchSystemTheme(), []);
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
