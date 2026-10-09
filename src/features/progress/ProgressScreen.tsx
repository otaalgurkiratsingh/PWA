import { useMemo, useState } from 'react';
import type { WeightEntry } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { dateRange, healthSeries, loggingConsistency, weightSeries, weightTrend } from '@/domain/metrics/metrics';
import { E1RM_FORMULA, comparableKey, convertLoad, estimateOneRepMax, workingSummary } from '@/domain/training/session';
import { saveErrorMessage } from '@/features/meals/useMeals';
import { DayChart } from './charts';
import { newId } from '@/core/ids';

const PERIODS = [7, 28, 90] as const;

function WeightForm() {
  const { journal, profile, today, refresh, notify } = useJournal();
  const [value, setValue] = useState('');
  const save = async () => {
    const v = Number(value.replace(',', '.'));
    if (!(v > 20 && v < 700)) return notify({ kind: 'error', message: `Enter a weight in ${profile.units}` });
    const nowIso = new Date().toISOString();
    const w: WeightEntry = {
      id: newId(), owner_id: journal.ownerId, local_version: 0, created_at: nowIso, updated_at: nowIso, deleted_at: null,
      synthetic: profile.synthetic, local_date: today, timezone: profile.timezone, measured_at: nowIso, value: v, unit: profile.units,
    };
    try {
      await journal.commit('weight_entries', w);
      setValue('');
      refresh();
      notify({ kind: 'info', message: `Saved ${v} ${profile.units} on this device` });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="field" style={{ flex: 1 }}>
        Today’s weight ({profile.units})
        <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 80.4" />
      </label>
      <button className="btn" type="submit" style={{ alignSelf: 'flex-end' }}>Save</button>
    </form>
  );
}

function StepsForm() {
  const { journal, profile, today, refresh, notify } = useJournal();
  const [value, setValue] = useState('');
  const save = async () => {
    const v = Number(value);
    if (!Number.isInteger(v) || v < 0 || v > 200000) return notify({ kind: 'error', message: 'Enter whole steps' });
    try {
      await journal.commit('daily_health', {
        id: `steps:${today}`, owner_id: journal.ownerId, metric: 'steps', local_date: today, timezone: profile.timezone,
        value: v, source: 'manual', recorded_at: new Date().toISOString(), synthetic: profile.synthetic,
      });
      setValue('');
      refresh();
      notify({ kind: 'info', message: `Saved ${v.toLocaleString('en-US')} steps (manual)` });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="field" style={{ flex: 1 }}>
        Today’s steps (manual)
        <input className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 8200" />
      </label>
      <button className="btn" type="submit" style={{ alignSelf: 'flex-end' }}>Save</button>
    </form>
  );
}

export function ProgressScreen() {
  const { profile, today } = useJournal();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(28);
  const dates = useMemo(() => dateRange(today, period), [today, period]);
  const from = dates[0]!;
  const weights = useQuery((j) => j.weightsBetween(from, today), [from, today]);
  const health = useQuery((j) => j.healthBetween(from, today), [from, today]);
  const meals = useQuery((j) => j.mealsBetween(from, today), [from, today]);
  const statuses = useQuery((j) => j.logStatuses(), []);
  const sessions = useQuery((j) => j.sessions(), []);

  const wSeries = weights ? weightSeries(weights, dates, profile.units) : null;
  const trend = wSeries ? weightTrend(wSeries, profile.units) : null;
  const steps = health ? healthSeries(health, 'steps', dates) : null;
  const consistency = meals && statuses ? loggingConsistency(meals, statuses, dates) : null;

  // Exercise trend: best working set per finished session, same comparable variant only.
  const exerciseOptions = useMemo(() => {
    const m = new Map<string, { label: string; bodyweight: boolean }>();
    for (const s of sessions ?? []) for (const e of s.exercises) m.set(comparableKey(e), { label: `${e.name} (${e.variant})`, bodyweight: e.load_convention === 'bodyweight' });
    // Loaded exercises first: a load trend is more meaningful for them.
    return [...m.entries()].sort((a, b) => Number(a[1].bodyweight) - Number(b[1].bodyweight)).map(([k, v]) => [k, v.label, v.bodyweight] as const);
  }, [sessions]);
  const [exKey, setExKey] = useState<string | null>(null);
  const chosen = exKey ?? exerciseOptions[0]?.[0] ?? null;
  const exSeries = useMemo(() => {
    if (!sessions || !chosen) return null;
    const byDate = new Map<string, number>();
    for (const s of sessions) {
      if (s.status !== 'finished' || s.local_date < from) continue;
      const e = s.exercises.find((x) => comparableKey(x) === chosen);
      if (!e) continue;
      const best = workingSummary(e, profile.units).bestSet;
      if (best) byDate.set(s.local_date, Math.round(convertLoad(best.load, best.unit, profile.units) * 10) / 10);
    }
    return dates.map((d) => ({ date: d, value: byDate.get(d) ?? null }));
  }, [sessions, chosen, from, dates, profile.units]);
  const latestBest = useMemo(() => {
    if (!sessions || !chosen) return null;
    for (const s of sessions) {
      if (s.status !== 'finished') continue;
      const e = s.exercises.find((x) => comparableKey(x) === chosen);
      const b = e ? workingSummary(e, profile.units).bestSet : null;
      if (b) return b;
    }
    return null;
  }, [sessions, chosen, profile.units]);
  const chosenIsBodyweight = exerciseOptions.find(([k]) => k === chosen)?.[2] ?? false;
  const e1rm = latestBest && !chosenIsBodyweight ? estimateOneRepMax(convertLoad(latestBest.load, latestBest.unit, profile.units), latestBest.reps) : null;

  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">Period</span>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}d</button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{from} → {today}</p>

      <section className="card" aria-labelledby="w-h">
        <h2 id="w-h">Weight</h2>
        {trend ? <p style={{ marginTop: 0 }}>{trend.message}</p> : null}
        {wSeries ? <DayChart title="Weight" points={wSeries} unit={profile.units} kind="line" emptyText="No weigh-ins in this period." /> : <div className="skeleton" />}
        <WeightForm />
      </section>

      <section className="card" aria-labelledby="n-h">
        <h2 id="n-h">Logging consistency</h2>
        {consistency ? (
          <>
            <div className="row wrap" style={{ gap: 24 }}>
              <div><div className="meter"><div className="value">{consistency.daysWithMeals}/{consistency.days}</div></div><div className="muted small">days with meals</div></div>
              <div><div className="meter"><div className="value">{consistency.daysMarkedComplete}</div></div><div className="muted small">days marked complete</div></div>
            </div>
            <p className="small">{consistency.message}</p>
          </>
        ) : <div className="skeleton" />}
      </section>

      <section className="card" aria-labelledby="s-h">
        <h2 id="s-h">Steps</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Source: manual entry. No phone or watch is connected — this web app cannot read Samsung Health or Health Connect.
        </p>
        {steps ? <DayChart title="Steps" points={steps} unit="steps" kind="bar" emptyText="No steps entered in this period." /> : <div className="skeleton" />}
        <StepsForm />
      </section>

      <section className="card" aria-labelledby="e-h">
        <h2 id="e-h">Exercise trend</h2>
        {exerciseOptions.length ? (
          <>
            <label className="field">
              Exercise (same equipment and load convention only)
              <select className="input" value={chosen ?? ''} onChange={(e) => setExKey(e.target.value)}>
                {exerciseOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
             {exSeries ? <DayChart title={chosenIsBodyweight ? 'Best set added load' : 'Best working set load'} points={exSeries} unit={profile.units} kind="line" emptyText="No sessions with this exercise in this period." /> : null}
            {latestBest ? (
              <p className="small">
                Latest best working set: {latestBest.load} {latestBest.unit} × {latestBest.reps}.{' '}
                {e1rm !== null
                  ? `Estimated 1RM ≈ ${e1rm} ${profile.units} (estimate — ${E1RM_FORMULA.name} formula v${E1RM_FORMULA.version}, valid for ${E1RM_FORMULA.minReps}–${E1RM_FORMULA.maxReps} reps; not a tested max).`
                  : chosenIsBodyweight
                    ? 'No 1RM estimate for bodyweight exercises (load shown is added load only).'
                    : 'No 1RM estimate: rep count is outside the supported range.'}
              </p>
            ) : null}
          </>
        ) : <p className="empty">Finish a workout to see exercise trends.</p>}
      </section>
      <p className="muted small">Interpretations above are calculated from your logs only. Missing days are shown as missing.</p>
    </div>
  );
}
