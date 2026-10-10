import { useEffect, useState } from 'react';
import type { Goal, LoadUnit } from '@shared/contracts';
import { DEMO_PROFILES } from '@shared/fixtures/demo';
import { useJournal, useQuery } from '@/app/JournalContext';
import { goBack, navigate } from '@/app/router';
import { useAuth } from '@/core/auth/AuthContext';
import { supabase } from '@/core/auth/supabase';
import { deleteJournalDB } from '@/core/database/db';
import { Icon } from '@/core/design/icons';
import { Section, Segmented, Sheet, Toggle } from '@/core/design/ui';
import { applyTheme, readTheme, type Theme } from '@/core/design/theme';
import { formatTime } from '@/core/time/localDate';
import { saveErrorMessage } from '@/features/food/useFood';

const GOALS: { value: Goal; label: string }[] = [
  { value: 'consistency', label: 'Be consistent' }, { value: 'maintenance', label: 'Maintain' }, { value: 'fat_loss', label: 'Lose fat' },
  { value: 'strength', label: 'Get stronger' }, { value: 'muscle_gain', label: 'Build muscle' },
];

export function setDemoProfile(id: string) {
  try {
    localStorage.setItem('rozana.demoProfile', id);
  } catch {
    // session only
  }
}

export function SyncLine() {
  const { sync, mode } = useJournal();
  if (mode === 'demo') return <span>Demo data stays on this device only.</span>;
  switch (sync.kind) {
    case 'local_only': return <span>Saved on this phone only (backup is off).</span>;
    case 'syncing': return <span>Backing up…</span>;
    case 'offline': return <span>Offline — {sync.pending} change{sync.pending === 1 ? '' : 's'} saved on this phone, will back up when you’re online.</span>;
    case 'error': return <span>{sync.message}</span>;
    default: return <span>{sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to back up.` : `Backed up${sync.lastSyncedAt ? ` · ${formatTime(sync.lastSyncedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}` : ''}.`}</span>;
  }
}

export function SettingsScreen() {
  const { journal, profile, updateProfile, mode, email, notify, refresh, syncNow, sync, conflictsCount } = useJournal();
  const { signOut, exitDemo } = useAuth();
  const conflicts = useQuery((j) => j.conflicts(), [conflictsCount]);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [sheet, setSheet] = useState<'signout' | 'delete' | 'restore' | null>(null);
  const [pending, setPending] = useState(0);
  const [confirmText, setConfirmText] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    navigator.storage?.persisted?.().then((p) => live && setPersisted(p)).catch(() => undefined);
    return () => void (live = false);
  }, []);
  useEffect(() => {
    const on = () => setTheme(readTheme());
    window.addEventListener('rozana-theme', on);
    return () => window.removeEventListener('rozana-theme', on);
  }, []);

  const save = (patch: Partial<typeof profile>) => updateProfile({ ...profile, ...patch }).catch((e) => notify({ kind: 'error', message: saveErrorMessage(e) }));
  const setT = (t: Theme) => { applyTheme(t); setTheme(t); };
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';

  const exportData = async () => {
    const data = await journal.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rozana-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify({ kind: 'info', message: 'Export downloaded. It contains health records — keep it private.' });
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await journal.restore(JSON.parse(await file.text()));
      refresh();
      notify({ kind: r.rejected.length ? 'error' : 'info', message: `Restored ${r.written} item${r.written === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} already up to date` : ''}${r.rejected.length ? `, ${r.rejected.length} skipped as invalid` : ''}.` });
      setSheet(null);
    } catch (e) {
      notify({ kind: 'error', message: e instanceof Error ? e.message : 'That file couldn’t be restored.' });
    }
  };

  const startSignOut = async () => {
    if (mode === 'account' && profile.consent.cloud_backup) await syncNow();
    setPending((await journal.pendingOps()).length);
    setSheet('signout');
  };

  const finishSignOut = async (removeLocal: boolean) => {
    const id = journal.ownerId;
    journal.close();
    if (removeLocal) await deleteJournalDB(id);
    await signOut();
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('today')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Settings</h1>
        <div className="row" role="group" aria-label="Theme">
          <button className="icon-btn" aria-label="Light theme" aria-pressed={!dark} onClick={() => setT('light')}><Icon name="sun" /></button>
          <button className="icon-btn" aria-label="Dark theme" aria-pressed={dark} onClick={() => setT('dark')}><Icon name="moon" /></button>
        </div>
      </div>

      <div className="card row" style={{ gap: 14 }}>
        <span className="avatar" style={{ width: 56, height: 56, fontSize: '1.25rem' }} aria-hidden="true">{profile.nickname.slice(0, 1).toUpperCase()}</span>
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{profile.nickname}</div>
          <div className="small muted">{mode === 'demo' ? 'Demo data' : email ?? 'Signed in'}</div>
        </div>
      </div>

      <Section title="Appearance">
        <div className="card stack-sm">
          <Segmented label="Theme" full value={theme} onChange={setT} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
          <span className="label">Light is the default. “System” follows your phone.</span>
        </div>
      </Section>

      <Section title="You">
        <YouForm key={`${profile.nickname}|${JSON.stringify(profile.targets)}`} />
      </Section>

      <Section title="Backup">
        <div className="card stack-sm">
          <div className="row" style={{ gap: 10 }}>
            <Icon name={mode === 'account' && profile.consent.cloud_backup && sync.kind === 'idle' && !sync.pending ? 'cloudCheck' : 'phone'} />
            <span className="small grow"><SyncLine /></span>
          </div>
          {mode === 'account' ? (
            <>
              <Toggle label="Back up to my private cloud" description="Stored in Rozana’s private Supabase project, readable only by your account." checked={profile.consent.cloud_backup}
                onChange={(v) => void save({ consent: { ...profile.consent, cloud_backup: v, updated_at: new Date().toISOString() } })} />
              {profile.consent.cloud_backup ? <button className="btn secondary sm" onClick={() => void syncNow()} disabled={sync.kind === 'syncing'}>Back up now</button> : null}
            </>
          ) : null}
          {conflicts && conflicts.length ? (
            <div className="notice warn stack-sm">
              <strong>{conflicts.length} edit{conflicts.length === 1 ? '' : 's'} changed on another device at the same time</strong>
              <span>We kept the newer cloud version and saved your copy here.</span>
              {conflicts.map((c, i) => (
                <div key={i} className="row wrap">
                  <span className="grow">{(c.local as { name?: string; day_name?: string } | undefined)?.name ?? (c.local as { day_name?: string } | undefined)?.day_name ?? c.aggregate}</span>
                  <button className="btn sm secondary" onClick={async () => { await journal.restoreConflict(i); refresh(); void syncNow(); }}>Use my copy</button>
                  <button className="btn sm ghost" onClick={async () => { await journal.dismissConflict(i); refresh(); }}>Dismiss</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Section>

      {mode === 'account' ? (
        <Section title="Privacy">
          <div className="card stack-sm">
            <Toggle label="AI help" description="Weekly review, questions and photo suggestions. Sends minimal summaries — never your name or email." checked={profile.consent.ai_processing}
              onChange={(v) => void save({ consent: { ...profile.consent, ai_processing: v, updated_at: new Date().toISOString() } })} />
            <button className="link" onClick={() => navigate('coach')}>What the coach remembers <Icon name="chevronRight" size={16} /></button>
          </div>
        </Section>
      ) : null}

      <Section title="Your data">
        <div className="card stack-sm">
          <button className="btn secondary" onClick={exportData}><Icon name="download" size={18} /> Export my data</button>
          <button className="btn secondary" onClick={() => setSheet('restore')}><Icon name="upload" size={18} /> Restore from an export</button>
          {persisted === false ? (
            <button className="btn ghost sm" onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>Ask this browser to keep my data</button>
          ) : null}
          <span className="label">Exports are JSON files with your meals, recipes, plans, workouts and settings. Clearing this site’s data removes anything not exported or backed up.</span>
        </div>
      </Section>

      {mode === 'demo' ? (
        <Section title="Demo">
          <div className="card stack-sm">
            <span className="small muted">Two separate demo people, so you can see that their data never mixes.</span>
            <Segmented label="Demo person" full value={profile.id} onChange={(id) => { setDemoProfile(id); location.reload(); }} options={DEMO_PROFILES.map((p) => ({ value: p.id, label: p.nickname }))} />
            <button className="btn danger sm" onClick={async () => { const id = journal.ownerId; journal.close(); await deleteJournalDB(id); location.reload(); }}>Reset this demo</button>
            <button className="btn" onClick={exitDemo}>Leave demo</button>
          </div>
        </Section>
      ) : (
        <Section title="Account">
          <div className="card stack-sm">
            <button className="btn secondary" onClick={() => void startSignOut()}><Icon name="signout" size={18} /> Sign out</button>
            <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={() => setSheet('delete')}>Delete my account…</button>
          </div>
        </Section>
      )}

      {sheet === 'restore' ? (
        <Sheet title="Restore from an export" onClose={() => setSheet(null)}>
          <div className="stack">
            <p className="small muted">Choose a Rozana export from this account or demo person. Anything missing here, or older here, is brought back. Nothing newer is overwritten.</p>
            <label className="btn">Choose file<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void restore(e.target.files?.[0])} /></label>
          </div>
        </Sheet>
      ) : null}
      {sheet === 'signout' ? (
        <Sheet title="Sign out?" onClose={() => setSheet(null)}>
          <div className="stack">
            {pending ? (
              <div className="notice warn">{pending} change{pending === 1 ? ' hasn’t' : 's haven’t'} backed up yet. {profile.consent.cloud_backup ? 'They stay on this phone and back up the next time you sign in here.' : 'Backup is off, so they only exist on this phone.'}</div>
            ) : <p className="small muted">Everything is backed up. You can also remove this phone’s copy.</p>}
            {pending ? <button className="btn secondary" onClick={exportData}><Icon name="download" size={18} /> Export a copy first</button> : null}
            <button className="btn" onClick={() => void finishSignOut(false)}>Sign out</button>
            {!pending ? <button className="btn ghost" onClick={() => void finishSignOut(true)}>Sign out and remove this phone’s copy</button> : null}
            <span className="label">After signing out, nobody can open your journal in Rozana without signing in. The browser doesn’t encrypt stored data, so keep your phone locked.</span>
          </div>
        </Sheet>
      ) : null}
      {sheet === 'delete' ? (
        <Sheet title="Delete your account" onClose={() => setSheet(null)}>
          <div className="stack">
            <p>This removes your cloud journal, coach reviews, notes and consent records, signs you out everywhere you use Rozana, and removes this phone’s copy.</p>
            <p className="small muted">Backups kept by the hosting provider expire on their own schedule; the owner re-applies your deletion if one is ever restored. Export first if you want a copy.</p>
            <label className="field">Type DELETE to confirm<input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" /></label>
            <button className="btn danger" disabled={confirmText.trim().toUpperCase() !== 'DELETE'} onClick={async () => {
              const { error } = await (await supabase()).rpc('request_account_deletion');
              if (error) return notify({ kind: 'error', message: 'Couldn’t delete right now. Check your connection and try again.' });
              await finishSignOut(true);
            }}>Delete my account</button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

/** Keyed by the saved values, so changes from sync or an accepted proposal show up immediately. */
function YouForm() {
  const { profile, updateProfile, notify } = useJournal();
  const [name, setName] = useState(profile.nickname);
  const [energy, setEnergy] = useState(profile.targets?.energy_kcal ? String(profile.targets.energy_kcal) : '');
  const [protein, setProtein] = useState(profile.targets?.protein_g ? String(profile.targets.protein_g) : '');
  const save = (patch: Partial<typeof profile>) => updateProfile({ ...profile, ...patch }).catch((e) => notify({ kind: 'error', message: saveErrorMessage(e) }));
  const saveTargets = () => {
    const e = Number(energy);
    const p = Number(protein);
    const targets = energy.trim() || protein.trim()
      ? { energy_kcal: energy.trim() && e > 0 ? e : null, protein_g: protein.trim() && p > 0 ? p : null, source: 'Set by you' }
      : null;
    void save({ targets });
    notify({ kind: 'info', message: targets ? 'Targets saved' : 'Targets cleared — journaling works without them' });
  };
  return (
    <div className="card stack">
      <label className="field">Name
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== profile.nickname && void save({ nickname: name.trim() })} />
      </label>
      <div className="stack-sm">
        <span className="label" style={{ fontWeight: 600 }}>Weight units</span>
        <Segmented label="Weight units" full value={profile.units} onChange={(u: LoadUnit) => void save({ units: u })} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        <span className="label">Sets you already logged keep the unit they were recorded in.</span>
      </div>
      <label className="field">Main goal
        <select className="select" value={profile.goal} onChange={(e) => void save({ goal: e.target.value as Goal })}>{GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select>
      </label>
      <div className="metrics">
        <label className="field">Daily energy target (kcal)<input className="input num" inputMode="numeric" placeholder="None" value={energy} onChange={(e) => setEnergy(e.target.value)} /></label>
        <label className="field">Daily protein target (g)<input className="input num" inputMode="numeric" placeholder="None" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
      </div>
      <button className="btn secondary" onClick={saveTargets}>Save targets</button>
      <span className="label">Optional. Use targets from your own plan or a qualified professional. {profile.targets ? `Current source: ${profile.targets.source}.` : ''}</span>
    </div>
  );
}
