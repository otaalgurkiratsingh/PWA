import { useEffect, useMemo, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { Section, Toggle } from '@/core/design/ui';
import {
  canNotify, deviceSubscribed, disableDevice, enableDevice, loadPrefs, permission, pushConfigured, pushSupport, savePrefs, testNotification,
} from '@/core/notifications/push';
import { defaultPrefs, describeWhen, LEAD_CHOICES, minusMinutes, nextReminders, validTime, type NotificationPrefs } from '@/core/notifications/schedule';
import { WEEKDAY_SHORT } from '@/domain/training/plan';

/** Settings → Notifications: daily motivation + a reminder before gym time. */
export function NotificationsScreen() {
  const { profile, mode, journal, notify } = useJournal();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saved, setSaved] = useState<NotificationPrefs | null>(null);
  const [device, setDevice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    return () => { live = false; };
  }, [mode, journal.ownerId, profile.timezone, profile.training]);

  const upcoming = useMemo(() => (prefs ? nextReminders(prefs, new Date()) : []), [prefs]);
  const dirty = !!prefs && JSON.stringify(prefs) !== JSON.stringify(saved);
  const on = !!prefs && (prefs.motivation_enabled || (prefs.gym_enabled && prefs.gym_days.length > 0));

  if (!prefs) return <div className="skeleton" style={{ height: 240 }} />;
  const set = (patch: Partial<NotificationPrefs>) => { setPrefs({ ...prefs, ...patch }); setError(null); };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!validTime(prefs.motivation_time) || !validTime(prefs.gym_time)) throw new Error('Choose a time for each reminder.');
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
          <p className="small muted">One encouraging note a day, and a heads-up before gym time so you don’t forget to go and log your sets.</p>
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

      <Section title="Daily motivation">
        <div className="card stack-sm">
          <Toggle label="Daily motivation" checked={prefs.motivation_enabled} onChange={(v) => set({ motivation_enabled: v })}
            description="A short note on how you’re doing: new bests, your weekly goal, your logging streak. Never a guilt trip." />
          {prefs.motivation_enabled ? (
            <label className="field">
              Time
              <input className="input" type="time" value={prefs.motivation_time} onChange={(e) => set({ motivation_time: e.target.value })} />
            </label>
          ) : null}
        </div>
      </Section>

      <Section title="Gym reminder">
        <div className="card stack-sm">
          <Toggle label="Remind me before gym time" checked={prefs.gym_enabled} onChange={(v) => set({ gym_enabled: v })}
            description="Names your planned workout, so you can get ready and log as you go." />
          {prefs.gym_enabled ? (
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
              {validTime(prefs.gym_time) ? <span className="label">You’ll get it at {minusMinutes(prefs.gym_time, prefs.lead_minutes)} on the days you picked.</span> : null}
            </>
          ) : null}
        </div>
      </Section>

      <Section title="Privacy">
        <div className="card stack-sm">
          <Toggle label="Hide details on the lock screen" checked={prefs.hide_details} onChange={(v) => set({ hide_details: v })}
            description="Shows “Your daily check-in is ready” instead of your numbers or workout name." />
          <span className="label">Reminders are encrypted for this phone; the delivery service (Google or Apple) can’t read them.</span>
        </div>
      </Section>

      {upcoming.length ? (
        <Section title="Coming up">
          <div className="card tight list-divided" aria-label="Next reminders">
            {upcoming.map((u) => (
              <div key={u.kind} className="row" style={{ padding: '10px 4px', gap: 12 }}>
                <span className="mini-icon" aria-hidden="true"><Icon name={u.kind === 'gym' ? 'workout' : 'star'} size={18} /></span>
                <span className="grow">{u.kind === 'gym' ? 'Gym reminder' : 'Daily motivation'}</span>
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
