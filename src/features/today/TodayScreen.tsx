import { useMemo, useState } from 'react';
import type { MealPreset, MealSlot } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { Section } from '@/core/design/ui';
import { formatShortDate, formatTime, localHourIn } from '@/core/time/localDate';
import { addDays } from '@/domain/metrics/metrics';
import { formatTotal, totalsOfItems } from '@/domain/nutrition/calc';
import { suggestedDay } from '@/domain/training/plan';
import { sessionProgress } from '@/domain/training/session';
import { AddMealSheet, MealCard } from '@/features/food/FoodScreen';
import { NutritionSummary } from '@/features/food/NutritionSummary';
import { describeAmount, slotForHour } from '@/features/food/mealActions';
import { sortPresets, useLibrary, useMealLogging } from '@/features/food/useFood';
import { useWorkout } from '@/features/workout/useWorkout';

export function TodayScreen() {
  const { profile, today, mode } = useJournal();
  const { start } = useWorkout();
  const { logPreset } = useMealLogging();
  const { data: lib } = useLibrary();
  const meals = useQuery((j) => j.mealsOn(today), [today]);
  const recent = useQuery((j) => j.mealsBetween(addDays(today, -14), today), [today]);
  const status = useQuery((j) => j.db.get('daily_log_status', today), [today]);
  const program = useQuery((j) => j.currentProgram(), []);
  const sessions = useQuery((j) => j.sessions(), []);
  const steps = useQuery((j) => j.db.get('daily_health', `steps:${today}`), [today]);
  const weights = useQuery((j) => j.weightsBetween(addDays(today, -13), today), [today]);
  const [adding, setAdding] = useState<MealPreset | null>(null);
  const slot: MealSlot = slotForHour(localHourIn(profile.timezone));

  const usual = useMemo(() => (lib && recent ? sortPresets(lib.presets, recent).slice(0, 6) : []), [lib, recent]);
  const active = sessions?.find((s) => s.status === 'active');
  const finished = sessions?.filter((s) => s.status === 'finished') ?? [];
  const doneToday = finished.find((s) => s.local_date === today);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const next = program ? suggestedDay(program, finished, weekday) : null;
  const weekCount = finished.filter((s) => s.local_date >= addDays(today, -6)).length;
  const latestWeight = weights?.sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0];

  const hour = localHourIn(profile.timezone);
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // One featured action.
  let feature: { tone: 'train' | 'food'; eyebrow: string; title: string; text: string; action: string; go: () => void };
  if (active) {
    const p = sessionProgress(active);
    feature = { tone: 'train', eyebrow: 'Workout in progress', title: active.day_name, text: `${p.done} of ${p.total} sets done`, action: 'Continue workout', go: () => navigate('workout') };
  } else if (next && !doneToday && program) {
    feature = {
      tone: 'train', eyebrow: 'Today’s workout', title: next.name,
      text: `${next.exercises.length} exercises · about ${Math.max(20, next.exercises.reduce((a, e) => a + e.sets.length, 0) * 3)} min`,
      action: `Start ${next.name}`, go: () => void start(program, next).then((s) => s && navigate('workout')),
    };
  } else if (!program && mode === 'account') {
    feature = { tone: 'train', eyebrow: 'Get started', title: 'Set up your workout plan', text: 'Add your days and exercises once; then each workout is a tap away.', action: 'Create my plan', go: () => navigate('plan') };
  } else {
    feature = { tone: 'food', eyebrow: doneToday ? `${doneToday.day_name} done` : 'Food', title: meals?.length ? 'Log your next meal' : 'Log your first meal', text: usual.length ? `Usual: ${usual.slice(0, 3).map((p) => p.name).join(', ')}` : 'Save meals you eat often for one-tap logging.', action: 'Open Food', go: () => navigate('food') };
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{greeting}, {profile.nickname.split(' ')[0]}</h2>
      </div>

      <div className={`card ${feature.tone}`}>
        <span className="eyebrow">{feature.eyebrow}</span>
        <div className="feature-title">{feature.title}</div>
        <p className="small" style={{ color: feature.tone === 'train' ? 'var(--train-ink)' : 'var(--food-ink)' }}>{feature.text}</p>
        <button className="btn block" style={{ marginTop: 14 }} onClick={feature.go}>{feature.action}</button>
      </div>

      <Section title="Food today" action={<button className="link" onClick={() => navigate('food')}>Open <Icon name="chevronRight" size={16} /></button>}>
        <div className="card">
          {meals ? <NutritionSummary entries={meals} targets={profile.targets} dayComplete={status?.intake_complete ?? false} compact /> : <div className="skeleton" />}
        </div>
        {usual.length ? (
          <div className="carousel" role="list" aria-label="Usual meals">
            {usual.map((p) => (
              <div role="listitem" key={p.id}>
                <MealCard preset={p} onOpen={() => setAdding(p)} onQuickAdd={() => void logPreset(p, 1, { slot })} />
              </div>
            ))}
          </div>
        ) : null}
        {meals && meals.length ? (
          <div className="card tight list-divided">
            {meals.slice(-3).reverse().map((e) => {
              const t = totalsOfItems(e.items);
              return (
                <div key={e.id} className="meal-row">
                  <span className="mini-thumb"><FoodArt icon={e.icon} photo={lib?.presets.find((p) => p.id === e.preset_id)?.photo} catalogueId={e.catalogue_id} size={48} label={e.name} /></span>
                  <span className="grow"><span className="mr-name">{e.name}</span><br /><span className="mr-sub">{e.items.map((i) => describeAmount(i.unit_label, i.quantity)).join(' + ')} · {formatTime(e.logged_at, e.timezone)}</span></span>
                  <span className="small muted num">{t.energy_kcal.value === null ? '' : formatTotal(t.energy_kcal, 'kcal')}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Section>

      {steps || latestWeight || weekCount ? (
        <div className="metrics">
          {weekCount ? <div className="metric"><span className="m-label">This week</span><span className="m-value">{weekCount}<small>workout{weekCount === 1 ? '' : 's'}</small></span><span className="m-sub">last 7 days</span></div> : null}
          {latestWeight ? <div className="metric"><span className="m-label">Weight</span><span className="m-value">{latestWeight.value}<small>{latestWeight.unit}</small></span><span className="m-sub">{latestWeight.local_date === today ? 'Today' : formatShortDate(latestWeight.local_date)}</span></div> : null}
          {steps ? <div className="metric"><span className="m-label">Steps</span><span className="m-value">{steps.value.toLocaleString('en-US')}</span><span className="m-sub">Manual · {formatTime(steps.recorded_at, profile.timezone)}</span></div> : null}
        </div>
      ) : null}

      <button className="card coach" style={{ textAlign: 'left', width: '100%', color: 'inherit' }} onClick={() => navigate('coach')}>
        <div className="row" style={{ gap: 14 }}>
          <span className="ex-art" style={{ background: 'var(--coach-strong)', color: 'var(--coach-ink)' }}><Icon name="sparkle" size={26} /></span>
          <span className="grow">
            <span className="eyebrow">Coach</span>
            <span style={{ display: 'block', fontWeight: 700, fontSize: '1.0625rem' }}>Your weekly review</span>
            <span className="small" style={{ color: 'var(--coach-ink)' }}>{mode === 'demo' ? 'Available with your own signed-in account' : 'Grounded in your own logs. Ask a question any time.'}</span>
          </span>
          <Icon name="chevronRight" />
        </div>
      </button>

      {adding ? <AddMealSheet preset={adding} slot={slot} date={today} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}
