import { useMemo, useState } from 'react';
import type { WeightEntry } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { newId } from '@/core/ids';
import { EquipmentArt, Icon } from '@/core/design/icons';
import { EmptyState, Metric, Section, Segmented, Sheet } from '@/core/design/ui';
import { formatShortDate } from '@/core/time/localDate';
import { addDays, dateRange, healthSeries, loggingConsistency, weightSeries, weightTrend } from '@/domain/metrics/metrics';
import { totalsOfEntries } from '@/domain/nutrition/calc';
import { E1RM_FORMULA, comparableKey, convertLoad, estimateOneRepMax, workingSummary } from '@/domain/training/session';
import { saveErrorMessage } from '@/features/food/useFood';
import { Chart, DataTable, type Point } from './charts';

type Period = '7' | '28' | '91';
const PERIODS: { value: Period; label: string }[] = [{ value: '7', label: '7 days' }, { value: '28', label: '4 weeks' }, { value: '91', label: '3 months' }];

function LogSheet({ kind, onClose }: { kind: 'weight' | 'steps'; onClose: () => void }) {
  const { journal, profile, today, refresh, notify } = useJournal();
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const v = Number(value.replace(',', '.'));
    const nowIso = new Date().toISOString();
    try {
      if (kind === 'weight') {
        if (!(v > 20 && v < 700)) return setErr(`Enter your weight in ${profile.units}.`);
        const w: WeightEntry = { id: newId(), owner_id: journal.ownerId, local_version: 0, created_at: nowIso, updated_at: nowIso, deleted_at: null,
          synthetic: profile.synthetic, local_date: today, timezone: profile.timezone, measured_at: nowIso, value: v, unit: profile.units };
        await journal.commit('weight_entries', w);
      } else {
        if (!Number.isInteger(v) || v < 0 || v > 200000) return setErr('Enter whole steps.');
        await journal.commit('daily_health', { id: `steps:${today}`, owner_id: journal.ownerId, metric: 'steps', local_date: today, timezone: profile.timezone, value: v, source: 'manual', recorded_at: nowIso, synthetic: profile.synthetic });
      }
      refresh();
      notify({ kind: 'info', message: kind === 'weight' ? `Saved ${v} ${profile.units}` : `Saved ${v.toLocaleString('en-US')} steps` });
      onClose();
    } catch (e) {
      setErr(saveErrorMessage(e));
    }
  };
  return (
    <Sheet title={kind === 'weight' ? 'Log weight' : 'Log steps'} onClose={onClose} actions={<button className="btn block" onClick={save}>Save</button>}>
      <div className="stack">
        <label className="field">
          {kind === 'weight' ? `Today (${profile.units})` : 'Steps today'}
          <input className="input num" inputMode={kind === 'weight' ? 'decimal' : 'numeric'} value={value} onChange={(e) => { setValue(e.target.value); setErr(null); }}
            onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder={kind === 'weight' ? (profile.units === 'kg' ? 'e.g. 80.4' : 'e.g. 177') : 'e.g. 8200'} />
        </label>
        {kind === 'steps' ? <p className="small muted">Entered by you. This web app can’t read Samsung Health or Health Connect directly.</p> : null}
        {err ? <div className="notice error" role="alert">{err}</div> : null}
      </div>
    </Sheet>
  );
}

export function ProgressScreen() {
  const { profile, today } = useJournal();
  const [period, setPeriod] = useState<Period>('28');
  const days = Number(period);
  const dates = useMemo(() => dateRange(today, days), [today, days]);
  const from = dates[0]!;
  const weights = useQuery((j) => j.weightsBetween(from, today), [from, today]);
  const health = useQuery((j) => j.healthBetween(from, today), [from, today]);
  const meals = useQuery((j) => j.mealsBetween(from, today), [from, today]);
  const statuses = useQuery((j) => j.logStatuses(), []);
  const sessions = useQuery((j) => j.sessions(), []);
  const [sheet, setSheet] = useState<'weight' | 'steps' | 'weightInfo' | 'exercise' | null>(null);
  const [wActive, setWActive] = useState<number | null>(null);
  const [sActive, setSActive] = useState<number | null>(null);
  const [eActive, setEActive] = useState<number | null>(null);
  const [exKey, setExKey] = useState<string | null>(null);

  const short = (d: string) => formatShortDate(d);
  const wSeries = weights ? weightSeries(weights, dates, profile.units) : null;
  const wPoints: Point[] = (wSeries ?? []).map((p) => ({ label: short(p.date), value: p.value }));
  const trend = wSeries ? weightTrend(wSeries, profile.units) : null;
  const latestW = wSeries ? [...wSeries].reverse().find((p) => p.value !== null) : undefined;
  const steps = health ? healthSeries(health, 'steps', dates) : null;
  const stepPoints: Point[] = (steps ?? []).map((p) => ({ label: short(p.date), value: p.value }));
  const stepVals = stepPoints.filter((p) => p.value !== null).map((p) => p.value!);
  const finished = (sessions ?? []).filter((s) => s.status === 'finished');
  const inPeriod = finished.filter((s) => s.local_date >= from && s.local_date <= today);
  const trainedDays = new Set(inPeriod.map((s) => s.local_date));
  const consistency = meals && statuses ? loggingConsistency(meals, statuses, dates) : null;

  const mealDays = useMemo(() => {
    if (!meals) return [];
    const byDate = new Map<string, typeof meals>();
    for (const m of meals) byDate.set(m.local_date, [...(byDate.get(m.local_date) ?? []), m]);
    return [...byDate.entries()].map(([d, list]) => ({ date: d, t: totalsOfEntries(list) }));
  }, [meals]);
  const completeSet = new Set((statuses ?? []).filter((s) => s.intake_complete).map((s) => s.local_date));
  const completeDays = mealDays.filter((d) => completeSet.has(d.date) && d.t.energy_kcal.value !== null && d.t.energy_kcal.complete);
  const avgComplete = completeDays.length ? Math.round(completeDays.reduce((a, d) => a + d.t.energy_kcal.value!, 0) / completeDays.length) : null;

  // Exercise progression: comparable variant only; x = sessions in which it was done.
  const exerciseOptions = useMemo(() => {
    const m = new Map<string, { name: string; variant: string; count: number; bodyweight: boolean }>();
    for (const s of finished) for (const e of s.exercises) {
      const k = comparableKey(e);
      const cur = m.get(k);
      m.set(k, { name: e.name, variant: e.variant, count: (cur?.count ?? 0) + 1, bodyweight: e.load_convention === 'bodyweight' || (e.measurement ?? 'weight_reps') !== 'weight_reps' });
    }
    return [...m.entries()].sort((a, b) => Number(a[1].bodyweight) - Number(b[1].bodyweight) || b[1].count - a[1].count);
  }, [finished]);
  const chosen = exKey ?? exerciseOptions[0]?.[0] ?? null;
  const chosenInfo = exerciseOptions.find(([k]) => k === chosen)?.[1];
  const exPoints: Point[] = useMemo(() => {
    if (!chosen) return [];
    return [...inPeriod].reverse().flatMap((s) => {
      const e = s.exercises.find((x) => comparableKey(x) === chosen);
      const best = e ? workingSummary(e, profile.units).bestSet : null;
      if (!best) return [];
      const v = chosenInfo?.bodyweight ? best.reps : Math.round(convertLoad(best.load, best.unit, profile.units) * 10) / 10;
      return [{ label: short(s.local_date), value: v }];
    });
  }, [chosen, chosenInfo, inPeriod, profile.units]);
  const exUnit = chosenInfo?.bodyweight ? 'reps' : profile.units;
  const lastEx = exPoints.at(-1);
  const firstEx = exPoints[0];

  // Weekly heatmap: whole weeks ending this week.
  const weeks = Math.ceil(days / 7);
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(today, -(weeks * 7 - 1) + (6 - todayDow));
  const cells = dateRange(addDays(gridStart, weeks * 7 - 1), weeks * 7);

  const wReadout = wActive !== null ? wPoints[wActive] : null;
  const loading = !weights || !sessions || !meals;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Segmented label="Period" value={period} onChange={(v) => { setPeriod(v); setWActive(null); setSActive(null); setEActive(null); }} options={PERIODS} full />

      {loading ? <div className="skeleton" style={{ minHeight: 200 }} /> : (
        <div className="metrics">
          <Metric label="Workouts" value={inPeriod.length} sub={`last ${PERIODS.find((p) => p.value === period)!.label}`} />
          {latestW ? <Metric label="Latest weight" value={latestW.value} unit={profile.units} sub={short(latestW.date)} /> : <Metric label="Weight" value="Not logged" empty sub="this period" />}
          <Metric label="Days with meals" value={consistency?.daysWithMeals ?? 0} unit={`/ ${days}`} sub={`${consistency?.daysMarkedComplete ?? 0} fully logged`} />
          {stepVals.length ? <Metric label="Steps (avg)" value={Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length).toLocaleString('en-US')} sub={`${stepVals.length} days entered`} /> : <Metric label="Steps" value="Not logged" empty sub="Manual entry" />}
        </div>
      )}

      <Section title="Weight" action={<button className="link" onClick={() => setSheet('weight')}><Icon name="plus" size={16} /> Log weight</button>}>
        <div className="card">
          {wPoints.some((p) => p.value !== null) ? (
            <>
              <div className="readout">
                <span className="r-value num">{(wReadout?.value ?? latestW?.value) ?? '—'}<small style={{ fontSize: '1rem', color: 'var(--text-2)' }}> {profile.units}</small></span>
                <span className="r-date">{wReadout ? (wReadout.value === null ? `${wReadout.label} · not logged` : wReadout.label) : `Latest · ${latestW ? short(latestW.date) : ''}`}</span>
              </div>
              <Chart points={wPoints} unit={profile.units} kind="line" title="Weight" active={wActive} onActive={setWActive} height={210} />
              <div className="row between" style={{ marginTop: 8 }}>
                <span className="small">
                  {trend && !trend.sparse && trend.change !== null
                    ? trend.change === 0 ? 'Weekly average about the same.' : `Weekly average ${trend.change < 0 ? 'down' : 'up'} ${Math.abs(trend.change)} ${profile.units}.`
                    : 'More weigh-ins will make the trend clearer.'}
                </span>
                <button className="icon-btn plain" aria-label="About this weight trend" onClick={() => setSheet('weightInfo')}><Icon name="info" size={20} /></button>
              </div>
              <details className="more"><summary>See details</summary><DataTable points={wPoints} unit={profile.units} title="Weight" /></details>
            </>
          ) : (
            <EmptyState icon="scale" tone="neutral" title="No weigh-ins yet" action={<button className="btn tonal" onClick={() => setSheet('weight')}>Log weight</button>}>Weigh in a few times a week, at a similar time of day.</EmptyState>
          )}
        </div>
      </Section>

      <Section title="Workout consistency">
        <div className="card stack-sm">
          <div className="small">{inPeriod.length === 0 ? 'No workouts logged in this period.' : `${inPeriod.length} workout${inPeriod.length === 1 ? '' : 's'} logged on ${trainedDays.size} day${trainedDays.size === 1 ? '' : 's'}.`}</div>
          <div className="heatmap" role="grid" aria-label="Workout calendar">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="hm-head" aria-hidden="true">{d}</div>)}
            {cells.map((d) => {
              const future = d > today;
              const trained = trainedDays.has(d);
              return (
                <div key={d} role="gridcell" className={`hm-day${trained ? ' trained' : ''}${d === today ? ' today' : ''}`}
                  style={future || d < from ? { opacity: 0.35 } : undefined}
                  aria-label={`${formatShortDate(d)}: ${future ? 'upcoming' : trained ? 'workout logged' : 'no workout logged'}`}>
                  {Number(d.slice(8))}
                </div>
              );
            })}
          </div>
          <div className="row label" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--chart-train)' }} /> Workout logged</span>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--card-2)', border: '1px solid var(--border)' }} /> No workout</span>
          </div>
        </div>
      </Section>

      <Section title="Exercise progress">
        <div className="card">
          {exerciseOptions.length === 0 ? <p className="small muted">Finish a workout to see how each exercise moves over time.</p> : (
            <div className="stack-sm">
              <button className="choice" onClick={() => setSheet('exercise')} aria-haspopup="dialog">
                <span className="ex-art" style={{ width: 40, height: 40 }}><EquipmentArt equipment={chosenInfo?.variant ?? 'other'} size={26} /></span>
                <span className="grow"><strong>{chosenInfo?.name}</strong><br /><span className="label">Tap to choose another exercise</span></span>
                <Icon name="chevronDown" />
              </button>
              {exPoints.length ? (
                <>
                  <div className="readout">
                    <span className="r-value num">{(eActive !== null ? exPoints[eActive]?.value : lastEx?.value) ?? '—'}<small style={{ fontSize: '1rem', color: 'var(--text-2)' }}> {exUnit}</small></span>
                    <span className="r-date">{eActive !== null ? exPoints[eActive]?.label : `Best set · ${lastEx?.label}`}</span>
                  </div>
                  <Chart points={exPoints} unit={exUnit} kind="line" tone="train" title={`${chosenInfo?.name} best set`} active={eActive} onActive={setEActive} height={180} />
                  <p className="small">
                    {exPoints.length < 2 ? 'One session so far in this period.' : `${exPoints.length} sessions. Best set went from ${firstEx!.value} to ${lastEx!.value} ${exUnit}.`}
                  </p>
                  {!chosenInfo?.bodyweight && lastEx?.value ? (() => {
                    const lastSession = inPeriod.find((s) => s.exercises.some((e) => comparableKey(e) === chosen));
                    const best = lastSession ? workingSummary(lastSession.exercises.find((e) => comparableKey(e) === chosen)!, profile.units).bestSet : null;
                    const e1 = best ? estimateOneRepMax(convertLoad(best.load, best.unit, profile.units), best.reps) : null;
                    return e1 ? <details className="more"><summary>Estimated one-rep max</summary><p className="small muted">≈ {e1} {profile.units} — an estimate using the {E1RM_FORMULA.name} formula (v{E1RM_FORMULA.version}) for sets of {E1RM_FORMULA.minReps}–{E1RM_FORMULA.maxReps} reps. Not a tested max.</p></details> : null;
                  })() : null}
                </>
              ) : <p className="small muted">Not done in this period.</p>}
            </div>
          )}
        </div>
      </Section>

      {mealDays.length ? (
        <Section title="Nutrition">
          <div className="card stack-sm">
            <div className="small">Meals logged on {mealDays.length} of {days} days; {completeDays.length} marked as fully logged.</div>
            {avgComplete !== null
              ? <div className="readout"><span className="r-value num">{avgComplete.toLocaleString('en-US')}<small style={{ fontSize: '1rem', color: 'var(--text-2)' }}> kcal</small></span><span className="r-date">average on fully logged days (estimate)</span></div>
              : <p className="small muted">Mark days as fully logged on the Food tab to see an average. Partial days aren’t averaged.</p>}
          </div>
        </Section>
      ) : null}

      <Section title="Steps" action={<button className="link" onClick={() => setSheet('steps')}><Icon name="plus" size={16} /> Add</button>}>
        <div className="card">
          {stepVals.length ? (
            <>
              <div className="readout">
                <span className="r-value num">{(sActive !== null ? stepPoints[sActive]?.value : stepVals.at(-1))?.toLocaleString('en-US') ?? 'Not logged'}</span>
                <span className="r-date">{sActive !== null ? stepPoints[sActive]?.label : 'Latest entry'} · Manual</span>
              </div>
              <Chart points={stepPoints} unit="steps" kind="bar" title="Steps" active={sActive} onActive={setSActive} height={160} />
              <details className="more"><summary>See details</summary><DataTable points={stepPoints} unit="steps" title="Steps" /></details>
            </>
          ) : <p className="small muted">Steps you enter appear here. Days without an entry show as not logged, not zero.</p>}
        </div>
      </Section>

      {sheet === 'weight' || sheet === 'steps' ? <LogSheet kind={sheet} onClose={() => setSheet(null)} /> : null}
      {sheet === 'weightInfo' ? (
        <Sheet title="About the weight trend" onClose={() => setSheet(null)}>
          <div className="stack-sm small">
            <p>{trend?.points ?? 0} weigh-ins in this period. Every weigh-in you logged is plotted; days without one are left as gaps.</p>
            <p>The trend compares the average of the first and last week of the period, and needs at least 3 weigh-ins in each of those weeks. Choose 4 weeks or 3 months for a trend.</p>
            <p>Day-to-day changes of a kilo or so are normal (water, food, timing).</p>
          </div>
        </Sheet>
      ) : null}
      {sheet === 'exercise' ? (
        <Sheet title="Choose exercise" onClose={() => setSheet(null)}>
          <div className="list-divided">
            {exerciseOptions.map(([k, info]) => (
              <button key={k} className="ex-row" onClick={() => { setExKey(k); setEActive(null); setSheet(null); }} aria-pressed={k === chosen}>
                <span className="ex-art"><EquipmentArt equipment={info.variant} /></span>
                <span className="grow"><span className="er-name">{info.name}</span><br /><span className="er-sub">{info.variant} · {info.count} session{info.count === 1 ? '' : 's'}</span></span>
                {k === chosen ? <Icon name="check" /> : null}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
