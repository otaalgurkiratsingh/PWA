import { useEffect, useState } from 'react';
import type { LoadUnit } from '@shared/contracts';
import { DEMO_PROFILES } from '@shared/fixtures/demo';
import { useJournal, useQuery } from '@/app/JournalContext';
import { Sheet } from '@/app/Sheet';
import { deleteJournalDB } from '@/core/database/db';
import { applyTheme, readTheme, type Theme } from '@/core/design/theme';

interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

async function readStorageInfo(): Promise<StorageInfo> {
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? null;
    const est = await navigator.storage?.estimate?.();
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}

function useStorageInfo() {
  const [info, setInfo] = useState<StorageInfo>({ persisted: null, usage: null, quota: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    readStorageInfo().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [tick]);
  return { info, reload: () => setTick((t) => t + 1) };
}

export function SettingsScreen() {
  const { journal, profile, switchProfile, updateProfile, notify } = useJournal();
  const pending = useQuery((j) => j.pendingOps(), []);
  const { info, reload } = useStorageInfo();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [confirmReset, setConfirmReset] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const exportData = async () => {
    const data = await journal.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rozana-export-${profile.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify({ kind: 'info', message: 'Export downloaded. It contains health records — store it privately.' });
  };

  const requestPersist = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      notify({ kind: ok ? 'info' : 'error', message: ok ? 'Browser agreed to keep this data unless you clear it.' : 'Browser did not grant persistent storage (it may still keep data).' });
      void reload();
    } catch {
      notify({ kind: 'error', message: 'Persistent storage is not supported here.' });
    }
  };

  const setUnits = (u: LoadUnit) => updateProfile({ ...profile, units: u });
  const mb = (b: number | null) => (b === null ? '—' : `${(b / 1024 / 1024).toFixed(1)} MB`);

  return (
    <div className="stack">
      <section className="card" aria-labelledby="p-h">
        <h2 id="p-h">Profile</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Each profile has its own separate on-device journal. Switching never shows another profile’s meals, sets, or drafts.
        </p>
        <div className="seg" role="group" aria-label="Active demo profile">
          {DEMO_PROFILES.map((p) => (
            <button key={p.id} aria-pressed={profile.id === p.id} onClick={() => switchProfile(p.id)}>{p.nickname}</button>
          ))}
        </div>
        <p className="small">
          {profile.nickname} · goal: {profile.goal.replace('_', ' ')} · timezone {profile.timezone} ·{' '}
          {profile.targets ? `targets ${profile.targets.energy_kcal ?? '—'} kcal / ${profile.targets.protein_g ?? '—'} g protein (${profile.targets.source})` : 'no targets (journaling works without them)'}
        </p>
      </section>

      <section className="card" aria-labelledby="u-h">
        <h2 id="u-h">Units & appearance</h2>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="seg" role="group" aria-label="Load units">
            {(['kg', 'lb'] as const).map((u) => <button key={u} aria-pressed={profile.units === u} onClick={() => setUnits(u)}>{u}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} aria-pressed={theme === t} onClick={() => { setTheme(t); applyTheme(t); }}>{t[0]!.toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>
        <p className="small muted">Existing sets keep the unit they were recorded in; comparisons convert with 1 lb = 0.45359237 kg.</p>
      </section>

      <section className="card" aria-labelledby="d-h">
        <h2 id="d-h">Your data on this device</h2>
        <ul className="small" style={{ paddingLeft: 18 }}>
          <li>Connection: {online ? 'online' : 'offline'} — logging works either way.</li>
          <li>Cloud sync: <strong>not configured</strong> (Phase 1). {pending ? `${pending.length} change${pending.length === 1 ? '' : 's'} waiting in the local outbox.` : ''}</li>
          <li>Persistent storage: {info.persisted === null ? 'unknown' : info.persisted ? 'granted' : 'not granted'} · used {mb(info.usage)}</li>
          <li>Clearing site data or uninstalling the browser app deletes anything not yet synced. Export regularly.</li>
        </ul>
        <div className="row wrap">
          <button className="btn secondary" onClick={exportData}>Export my data (JSON)</button>
          <button className="btn secondary" onClick={requestPersist}>Ask browser to keep data</button>
        </div>
      </section>

      <section className="card" aria-labelledby="pr-h">
        <h2 id="pr-h">Privacy (short version)</h2>
        <p className="small" style={{ marginTop: 0 }}>
          This local demo stores everything only in this browser on this device. Nothing is sent to a server or an AI
          provider. Browser storage is not encrypted end-to-end; keep your phone locked. Before any cloud sync or AI feature
          is turned on, you will see a separate notice and consent for each.
        </p>
      </section>

      <section className="card" aria-labelledby="r-h">
        <h2 id="r-h">Demo data</h2>
        <p className="small" style={{ marginTop: 0 }}>
          All foods, nutrition numbers, history, targets, and the workout plan here are <strong>synthetic</strong> placeholders.
          Do not treat them as real nutrition data.
        </p>
        <button className="btn danger" onClick={() => setConfirmReset(true)}>Reset {profile.nickname} demo data</button>
      </section>

      {confirmReset ? (
        <Sheet title="Reset demo data?" onClose={() => setConfirmReset(false)}>
          <p>This deletes everything stored for {profile.nickname} on this device and regenerates the synthetic demo.</p>
          <div className="row">
            <button className="btn secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
            <span className="spacer" />
            <button
              className="btn danger"
              onClick={async () => {
                journal.close();
                await deleteJournalDB(profile.id);
                location.reload();
              }}
            >
              Delete and regenerate
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
