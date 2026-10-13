import { useEffect, useMemo, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { Section, Toggle } from '@/core/design/ui';
import {
  canNotify, deviceSubscribed, disableDevice, enableDevice, loadDismissals, loadPrefs, permission, pushConfigured, pushSupport, savePrefs, testNotification,
} from '@/core/notifications/push';
import {
  DAILY_MAX, defaultPrefs, describeWhen, DISMISS_STOP, inQuietHours, LEAD_CHOICES, minusMinutes, nextReminders, validTime, type NotificationPrefs, type NotifyKind,
} from '@/core/notifications/schedule';
import { WEEKDAY_SHORT } from '@/domain/training/plan';

/**
 * Settings → Notifications (v2): three kinds only — a routine nudge, the gym reminder (learned or a
 * fixed time) and "your milestone / weekly insight is ready". At most 2 a day, quiet 10pm–7am, and a
 * kind dismissed 3 times stops for good. No guilt, ever.
 */
export function NotificationsScreen() {
  const { profile, mode, journal, notify } = useJournal();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saved, setSaved] = useState<NotificationPrefs | null>(null);
  const [device, setDevice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Partial<Record<NotifyKind, number>>>({});
  const support = pushSupport();
  const account = mode === 'account';

  useEffect(() => {
    let live = true;
    const base = defaultPrefs(profile.timezone, profile.training?.days_available ?? []);
    loadPrefs(mode, journal.ownerId).then(
      (p) => { if (live) { const v = p ? { ...base, ...p, timezone: profile.timezone } : base; setPrefs(v); setSaved(p ? v : null); } },
      (e: Error) => { if (live) { setPrefs(base); setError(e.message); } },
    );
    void deviceSubscribed().then((d) => live && setDevice(d));
    void loadDismissals(mode).then((d) => live && setDismissed(d));
    return () => { live = false; };
  }, [mode, journal.ownerId, profile.timezone, profile.training]);

  const upcoming = useMemo(() => (prefs ? nextReminders(prefs, new Date()) : []), [prefs]);
  const dirty = !!prefs && JSON.stringify(prefs) !== JSON.stringify(saved);
  const on = !!prefs && (prefs.routine_enabled || prefs.insight_enabled || (prefs.gym_enabled && (prefs.gym_mode === 'learned' || prefs.gym_days.length > 0)));
  const stopped = (k: NotifyKind) => (dismissed[k] ?? 0) >= DISMISS_STOP;
  const stoppedNote = (k: NotifyKind) => (stopped(k) ? <span className="label">Stopped because you dismissed it {DISMISS_STOP} times. We took the hint 🙂</span> : null);

  if (!prefs) return <div className="skeleton" style={{ height: 240 }} />;
  const set = (patch: Partial<NotificationPrefs>) => { setPrefs({ ...prefs, ...patch }); setError(null); };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (prefs.gym_mode === 'fixed' && !validTime(prefs.gym_time)) throw new Error('Choose a gym time.');
      if (account && on && support === 'supported' && pushConfigured() && !device) {
        await enableDevice();
        setDevice(true);
      }
      await savePrefs(mode, journal.ownerId, prefs);
      setSaved(prefs);
      notify({ kind: 'info', message: on ? 'Reminders saved.' : 'Reminders turned off.' });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const test = async () => {
    setError(null);
    try {
      await testNotification(prefs);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stopDevice = async () => {
    setBusy(true);
    await disableDevice();
    setDevice(false);
    setBusy(false);
    notify({ kind: 'info', message: 'This phone won’t get reminders any more.' });
  };

  const blocked = permission() === 'denied';

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('settings')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Notifications</h1>
      </div>

      <div className="card notify-hero">
        <span className="nh-icon" aria-hidden="true"><Icon name="clock" size={24} /></span>
        <div className="grow">
          <strong>Stay on track, gently</strong>
          <p className="small muted">Only three kinds of notes, each one useful. Never more than {DAILY_MAX} a day, never between 10pm and 7am, and never a guilt trip.</p>
        </div>
      </div>

      {support === 'needs_install' ? (
        <div className="notice warn" role="status">On iPhone, reminders work after you add TrainLuma to your Home Screen: tap Share, then <strong>Add to Home Screen</strong>, and open it from there.</div>
      ) : support === 'unsupported' ? (
        <div className="notice warn" role="status">This browser can’t show notifications. Try Chrome on Android, or Safari from the Home Screen on iPhone.</div>
      ) : blocked ? (
        <div className="notice warn" role="status">Notifications are blocked for TrainLuma. Allow them in your phone’s settings, then come back here.</div>
      ) : null}
      {!account ? (
        <div className="notice" role="status">In the demo, these settings stay on this phone and only the test notification is sent. Real reminders need a signed-in account.</div>
      ) : !pushConfigured() ? (
        <div className="notice" role="status">Phone reminders are still being set up by the owner. Your choices are saved and start working once that’s done.</div>
      ) : null}

      <Section title="Your routine">
        <div className="card stack-sm">
          <Toggle label="Routine nudge" checked={prefs.routine_enabled} onChange={(v) => set({ routine_enabled: v })}
            description="When you usually log a meal and haven’t yet, e.g. “Time for your usual chai?” with a one-tap Log it." />
          {stoppedNote('routine')}
        </div>
      </Section>

      <Section title="Gym reminder">
        <div className="card stack-sm">
          <Toggle label="Remind me before gym time" checked={prefs.gym_enabled} onChange={(v) => set({ gym_enabled: v })}
            description="Names your planned workout, so you can get ready and log as you go. Skipped on days you’ve already trained." />
          {stoppedNote('gym')}
          {prefs.gym_enabled ? (
            <>
              <div className="chips wrap" role="radiogroup" aria-label="When is gym time">
                <button type="button" role="radio" className="chip" aria-checked={prefs.gym_mode === 'learned'} aria-pressed={prefs.gym_mode === 'learned'} onClick={() => set({ gym_mode: 'learned' })}>Learn it from my workouts</button>
                <button type="button" role="radio" className="chip" aria-checked={prefs.gym_mode === 'fixed'} aria-pressed={prefs.gym_mode === 'fixed'} onClick={() => set({ gym_mode: 'fixed' })}>I’ll set a time</button>
              </div>
              {prefs.gym_mode === 'learned' ? (
                <span className="label">After two workouts on the same weekday, we’ll remind you before the time you usually start.</span>
              ) : (
                <>
                  <div className="stack-sm">
                    <span className="label" style={{ fontWeight: 600 }}>Gym days</span>
                    <div className="chips wrap" role="group" aria-label="Gym days">
                      {WEEKDAY_SHORT.map((d, i) => {
                        const sel = prefs.gym_days.includes(i);
                        return (
                          <button key={d} type="button" className="chip" aria-pressed={sel}
                            onClick={() => set({ gym_days: sel ? prefs.gym_days.filter((x) => x !== i) : [...prefs.gym_days, i].sort() })}>{d}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="row wrap" style={{ gap: 12 }}>
                    <label className="field grow">
                      Gym time
                      <input className="input" type="time" value={prefs.gym_time} onChange={(e) => set({ gym_time: e.target.value })} />
                    </label>
                    <label className="field grow">
                      Remind me
                      <select className="input" value={prefs.lead_minutes} onChange={(e) => set({ lead_minutes: Number(e.target.value) })}>
                        {LEAD_CHOICES.map((m) => <option key={m} value={m}>{m} min before</option>)}
                      </select>
                    </label>
                  </div>
                  {validTime(prefs.gym_time) ? (
                    inQuietHours(minusMinutes(prefs.gym_time, prefs.lead_minutes))
                      ? <span className="label">That’s inside quiet hours (10pm–7am), so this one stays silent.</span>
                      : <span className="label">You’ll get it at {minusMinutes(prefs.gym_time, prefs.lead_minutes)} on the days you picked.</span>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>
      </Section>

      <Section title="Milestones and insights">
        <div className="card stack-sm">
          <Toggle label="Milestone or insight ready" checked={prefs.insight_enabled} onChange={(v) => set({ insight_enabled: v })}
            description="When you reach 7, 30 or 100 days, and when your weekly Luma Insight is ready." />
          {stoppedNote('insight')}
        </div>
      </Section>

      <Section title="Privacy">
        <div className="card stack-sm">
          <Toggle label="Hide details on the lock screen" checked={prefs.hide_details} onChange={(v) => set({ hide_details: v })}
            description="Shows a plain “Something’s ready for you” instead of meal names, numbers or your workout." />
          {prefs.hide_details ? <span className="label">With details hidden, only a fixed-time gym reminder can be sent (routine nudges and insights need their details).</span> : null}
          <span className="label">Reminders are encrypted for this phone; the delivery service (Google or Apple) can’t read them.</span>
        </div>
      </Section>

      {upcoming.length ? (
        <Section title="Coming up">
          <div className="card tight list-divided" aria-label="Next reminders">
            {upcoming.map((u) => (
              <div key={u.kind} className="row" style={{ padding: '10px 4px', gap: 12 }}>
                <span className="mini-icon" aria-hidden="true"><Icon name="workout" size={18} /></span>
                <span className="grow">Gym reminder</span>
                <span className="small muted num">{describeWhen(u.at, new Date(), prefs.timezone)}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <div className="stack-sm">
        <button className="btn block" disabled={busy || (!dirty && saved !== null)} onClick={() => void save()}>
          {busy ? <span className="spinner" /> : saved === null ? 'Turn on reminders' : 'Save changes'}
        </button>
        {canNotify() && !blocked ? <button className="btn secondary block" onClick={() => void test()}>Send a test notification</button> : null}
        {account && device ? <button className="btn ghost block" disabled={busy} onClick={() => void stopDevice()}>Stop reminders on this phone</button> : null}
      </div>
    </div>
  );
}
