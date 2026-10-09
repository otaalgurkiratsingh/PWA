import { useState } from 'react';
import type { Goal, LoadUnit, LocalProfile } from '@shared/contracts';
import { EXERCISE_LIBRARY } from '@shared/fixtures/exerciseLibrary';
import { useSetup } from '@/app/JournalContext';
import { useAuth } from '@/core/auth/AuthContext';
import { newId } from '@/core/ids';
import { FoodArt } from '@/core/design/foodArt';
import { Icon, Mark } from '@/core/design/icons';
import { Segmented, Toggle } from '@/core/design/ui';
import { deviceTimezone } from '@/core/time/localDate';
import { addDay, addExercise, commitPlan, draftFrom, plannedFromDefinition } from '@/domain/training/plan';
import { buildMeal, STARTER_MEALS, starterForm } from '@/features/food/mealBuilder';

const GOALS: { value: Goal; label: string; sub: string }[] = [
  { value: 'consistency', label: 'Be consistent', sub: 'Show up and log regularly' },
  { value: 'strength', label: 'Get stronger', sub: 'Lift a bit more over time' },
  { value: 'muscle_gain', label: 'Build muscle', sub: 'Train and eat for growth' },
  { value: 'fat_loss', label: 'Lose fat', sub: 'Gradually, without extremes' },
  { value: 'maintenance', label: 'Maintain', sub: 'Keep things steady' },
];

const TEMPLATE: [string, string[]][] = [
  ['Full body A', ['Back squat', 'Bench press', 'Seated cable row', 'Plank']],
  ['Full body B', ['Romanian deadlift', 'Dumbbell shoulder press', 'Lat pulldown', 'Split squat']],
];

export function Onboarding() {
  const { journal, email, complete } = useSetup();
  const { signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [units, setUnits] = useState<LoadUnit>('kg');
  const [goal, setGoal] = useState<Goal>('consistency');
  const [energy, setEnergy] = useState('');
  const [protein, setProtein] = useState('');
  const [height, setHeight] = useState('');
  const [meals, setMeals] = useState<string[]>([]);
  const [workout, setWorkout] = useState<'own' | 'template' | 'later'>('own');
  const [backup, setBackup] = useState<boolean | null>(null);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const STEPS = 6;

  const finish = async () => {
    if (backup === null) return setError('Choose where to keep your journal.');
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      for (const m of STARTER_MEALS.filter((x) => meals.includes(x.name))) {
        const r = buildMeal({ form: { ...starterForm(m), grams_per_unit: String(m.grams) }, ownerId: journal.ownerId, now, newId, synthetic: false, foods: new Map(), recipes: new Map(), existing: null });
        for (const f of r.foods) await journal.commit('foods', f);
        await journal.commit('presets', r.preset);
      }
      if (workout === 'template') {
        let d = draftFrom(null);
        for (const [dayName, names] of TEMPLATE) {
          d = addDay(d, dayName, newId);
          const day = d.days[d.days.length - 1]!;
          for (const n of names) {
            const def = EXERCISE_LIBRARY.find((x) => x.name === n);
            if (def) d = addExercise(d, day.id, plannedFromDefinition(def, units, newId));
          }
        }
        await journal.commit('programs', commitPlan({ draft: { ...d, name: 'My plan' }, previous: null, ownerId: journal.ownerId, newId, now, synthetic: false }));
      }
      const e = Number(energy);
      const p = Number(protein);
      const profile: LocalProfile = {
        id: journal.ownerId,
        nickname: name.trim().slice(0, 40) || 'Me',
        units,
        timezone: deviceTimezone(),
        goal,
        targets: energy.trim() || protein.trim() ? { energy_kcal: e > 0 ? e : null, protein_g: p > 0 ? p : null, source: 'Set by you' } : null,
        synthetic: false,
        adult_confirmed: true,
        height_cm: Number(height) > 0 ? Number(height) : null,
        consent: { cloud_backup: backup, ai_processing: ai, updated_at: now },
        onboarded_at: now,
        updated_at: now,
      };
      await complete(profile);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Couldn’t save. Please try again.');
    }
  };

  const canNext = step === 0 ? name.trim().length > 0 && adult : true;

  return (
    <main className="welcome">
      <div className="row between">
        <span className="brand"><Mark /> Rozana</span>
        <button className="link" onClick={() => void signOut()}>Sign out</button>
      </div>
      <div className="onboard-progress" aria-label={`Step ${step + 1} of ${STEPS}`} style={{ marginTop: 16 }}>
        {Array.from({ length: STEPS }, (_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}
      </div>

      <div className="stack" style={{ flex: 1, paddingTop: 28 }}>
        {step === 0 ? (
          <>
            <h1>Welcome{email ? '' : ''}</h1>
            <p className="muted">A few quick questions. You can change everything later.</p>
            <label className="field">What should we call you?<input className="input" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} /></label>
            <button className="choice" role="checkbox" aria-checked={adult} onClick={() => setAdult(!adult)}>
              <Icon name={adult ? 'check' : 'plus'} /> <span className="grow">I’m 18 or older</span>
            </button>
          </>
        ) : step === 1 ? (
          <>
            <h1>Your basics</h1>
            <div className="stack-sm">
              <span className="label" style={{ fontWeight: 600 }}>Weights in</span>
              <Segmented label="Weight units" full value={units} onChange={setUnits} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
            </div>
            <div className="stack-sm">
              <span className="label" style={{ fontWeight: 600 }}>Main goal right now</span>
              {GOALS.map((g) => (
                <button key={g.value} className="choice" aria-pressed={goal === g.value} onClick={() => setGoal(g.value)}>
                  <span className="grow"><strong>{g.label}</strong><br /><span className="small muted">{g.sub}</span></span>
                </button>
              ))}
            </div>
          </>
        ) : step === 2 ? (
          <>
            <h1>Targets (optional)</h1>
            <p className="muted">Only if you already have them from your own plan or a professional. Journaling works without any target.</p>
            <div className="metrics">
              <label className="field">Energy (kcal/day)<input className="input num" inputMode="numeric" value={energy} onChange={(e) => setEnergy(e.target.value)} placeholder="None" /></label>
              <label className="field">Protein (g/day)<input className="input num" inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="None" /></label>
            </div>
            <label className="field">Height (cm, optional)<input className="input num" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Skip" /></label>
          </>
        ) : step === 3 ? (
          <>
            <h1>Meals you eat often</h1>
            <p className="muted">Pick a few to start your one-tap list. Add your recipe or label numbers later — until then their nutrition shows as not set.</p>
            <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              {STARTER_MEALS.map((m) => {
                const on = meals.includes(m.name);
                return (
                  <button key={m.name} className="choice" aria-pressed={on} style={{ flexDirection: 'column', padding: 8, gap: 4 }} onClick={() => setMeals(on ? meals.filter((x) => x !== m.name) : [...meals, m.name])}>
                    <FoodArt icon={m.icon} size={56} />
                    <span className="small" style={{ fontWeight: 600 }}>{m.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : step === 4 ? (
          <>
            <h1>Your workouts</h1>
            {([
              ['own', 'I’ll build my own plan', 'Add your days, exercises and sets, like your notebook.'],
              ['template', 'Start from a simple 2-day plan', 'Full body A and B. You can change every part.'],
              ['later', 'Set this up later', 'You can log meals first.'],
            ] as const).map(([v, t, s]) => (
              <button key={v} className="choice" aria-pressed={workout === v} onClick={() => setWorkout(v)}>
                <span className="grow"><strong>{t}</strong><br /><span className="small muted">{s}</span></span>
              </button>
            ))}
          </>
        ) : (
          <>
            <h1>Your privacy</h1>
            <div className="stack-sm">
              <button className="choice" aria-pressed={backup === true} onClick={() => setBackup(true)}>
                <Icon name="cloud" /> <span className="grow"><strong>Back up to my private cloud</strong><br /><span className="small muted">Kept in Rozana’s private database, readable only by your account. Recommended, so a lost phone doesn’t lose your journal.</span></span>
              </button>
              <button className="choice" aria-pressed={backup === false} onClick={() => setBackup(false)}>
                <Icon name="phone" /> <span className="grow"><strong>Keep it on this phone only</strong><br /><span className="small muted">Nothing is uploaded. Export regularly to keep a copy.</span></span>
              </button>
            </div>
            <div className="card flat">
              <Toggle label="AI help (optional)" checked={ai} onChange={setAi}
                description="Weekly review, questions and photo suggestions. Sends minimal summaries through our backend to Google’s Gemini API — never your name or email. Off by default." />
            </div>
          </>
        )}
        {error ? <div className="notice error" role="alert">{error}</div> : null}
      </div>

      <div className="row" style={{ paddingTop: 16 }}>
        {step > 0 ? <button className="btn secondary" onClick={() => setStep(step - 1)}>Back</button> : null}
        {step === 2 || step === 3 ? <button className="btn ghost" onClick={() => { if (step === 3) setMeals([]); else { setEnergy(''); setProtein(''); setHeight(''); } setStep(step + 1); }}>Skip</button> : null}
        <span className="grow" />
        {step < STEPS - 1
          ? <button className="btn" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button>
          : <button className="btn" disabled={busy} onClick={() => void finish()}>{busy ? <span className="spinner" /> : 'Start using Rozana'}</button>}
      </div>
    </main>
  );
}
