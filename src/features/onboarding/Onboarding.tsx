import { useState } from 'react';
import type { LoadUnit, LocalProfile } from '@shared/contracts';
import { useSetup } from '@/app/JournalContext';
import { useAuth } from '@/core/auth/AuthContext';
import { Icon, Mark } from '@/core/design/icons';
import { Segmented } from '@/core/design/ui';
import { deviceTimezone } from '@/core/time/localDate';

/**
 * Onboarding step 1: name, adult confirmation, units. This creates the profile (not yet
 * "onboarded"); the planning wizard continues from there with the full app context, and resumes
 * where it was if the person leaves. Nothing here is sent anywhere until backup is chosen.
 */
export function Onboarding() {
  const { journal, complete } = useSetup();
  const { signOut } = useAuth();
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [units, setUnits] = useState<LoadUnit>('kg');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    const profile: LocalProfile = {
      id: journal.ownerId,
      nickname: name.trim().slice(0, 40) || 'Me',
      units,
      timezone: deviceTimezone(),
      goal: 'consistency',
      targets: null,
      synthetic: false,
      adult_confirmed: true,
      height_cm: null,
      consent: { cloud_backup: false, ai_processing: false, photo_storage: false, ai_images: false, updated_at: now },
      food_prefs: { pattern: 'unspecified', meatless_weekdays: [], allergies: [] },
      training: null,
      profile_version: 0,
      onboarded_at: null,
      updated_at: now,
    };
    try {
      await complete(profile);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Couldn’t save. Please try again.');
    }
  };

  return (
    <main className="welcome">
      <div className="row between">
        <span className="brand"><Mark /> TrainLuma</span>
        <button className="link" onClick={() => void signOut()}>Sign out</button>
      </div>
      <div className="onboard-progress" aria-label="Step 1 of 9" style={{ marginTop: 16 }}>
        {Array.from({ length: 9 }, (_, i) => <span key={i} className={i === 0 ? 'on' : ''} />)}
      </div>
      <div className="stack" style={{ flex: 1, paddingTop: 28 }}>
        <h1>Welcome</h1>
        <p className="muted">A few short questions so your plan fits your week. Photos and AI are optional; you can skip anything optional and change it later.</p>
        <label className="field">What should we call you?<input className="input" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} /></label>
        <button className="choice" role="checkbox" aria-checked={adult} onClick={() => setAdult(!adult)}>
          <Icon name={adult ? 'check' : 'plus'} /> <span className="grow">I’m 18 or older</span>
        </button>
        <div className="stack-sm">
          <span className="label" style={{ fontWeight: 600 }}>Weights in</span>
          <Segmented label="Weight units" full value={units} onChange={setUnits} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        </div>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
      </div>
      <div className="row" style={{ paddingTop: 16 }}>
        <span className="grow" />
        <button className="btn" disabled={!name.trim() || !adult || busy} onClick={() => void start()}>{busy ? <span className="spinner" /> : 'Save and continue'}</button>
      </div>
    </main>
  );
}
