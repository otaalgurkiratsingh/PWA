import { useMemo } from 'react';
import type { MealPreset, ProgramDay, WorkoutSession } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { formatShortDate, formatTime } from '@/core/time/localDate';
import { addDays } from '@/domain/metrics/metrics';
import { sessionProgress } from '@/domain/training/session';
import { CoachCard } from '@/features/coach/CoachCard';
import { QuickTiles } from '@/features/meals/MealTiles';
import { MealTimeline } from '@/features/meals/MealsScreen';
import { NutritionSummary } from '@/features/meals/NutritionSummary';
import { useTraining } from '@/features/train/useTraining';
import { sortByUse } from '@/features/meals/useMeals';

function nextDay(days: ProgramDay[], finished: WorkoutSession[]): ProgramDay | undefined {
  const last = finished[0];
  if (!last) return days[0];
  const idx = days.findIndex((d) => d.id === last.day_id);
  return days[(idx + 1) % days.length];
}

export function TodayScreen() {
  const { profile, today } = useJournal();
  const { start } = useTraining();
  const meals = useQuery((j) => j.mealsOn(today), [today]);
  const recent = useQuery((j) => j.mealsBetween(addDays(today, -14), today), [today]);
  const status = useQuery((j) => j.db.get('daily_log_status', today), [today]);
  const lib = useQuery((j) => j.library(), []);
  const sessions = useQuery((j) => j.sessions(), []);
  const steps = useQuery((j) => j.db.get('daily_health', `steps:${today}`), [today]);
  const weightToday = useQuery((j) => j.weightsBetween(today, today), [today]);

  const usual = useMemo<MealPreset[]>(() => {
    if (!lib || !recent) return [];
    return sortByUse(lib.presets, recent).slice(0, 4);
  }, [lib, recent]);

  const program = lib ? [...lib.programs].sort((a, b) => b.version - a.version)[0] : undefined;
  const active = sessions?.find((s) => s.status === 'active');
  const finished = sessions?.filter((s) => s.status === 'finished') ?? [];
  const trainedToday = finished.some((s) => s.local_date === today);
  const upcoming = program ? nextDay(program.days, finished) : undefined;

  const week = addDays(today, -6);
  const weekMealsDays = new Set((recent ?? []).filter((e) => e.local_date >= week).map((e) => e.local_date)).size;
  const weekSessions = finished.filter((s) => s.local_date >= week).length;

  let next: { text: string; action: string; go: () => void };
  if (active) next = { text: `Continue ${active.day_name}`, action: 'Continue workout', go: () => navigate('train') };
  else if (meals && meals.length === 0) next = { text: 'Log your first meal of the day', action: 'Open meals', go: () => navigate('meals') };
  else if (!trainedToday && upcoming && program) next = { text: `${upcoming.name} is next in your plan`, action: `Start ${upcoming.name}`, go: () => { void start(program, upcoming).then(() => navigate('train')); } };
  else if (weightToday && weightToday.length === 0) next = { text: 'Log today’s weight (optional)', action: 'Open progress', go: () => navigate('progress') };
  else next = { text: 'You’re up to date for today', action: 'Review meals', go: () => navigate('meals') };

  return (
    <div className="stack">
      <section className="card next-card" aria-labelledby="next-h">
        <span className="eyebrow" id="next-h">Next</span>
        <p>{next.text}</p>
        <button className="btn on-accent" onClick={next.go}>{next.action}</button>
      </section>

      <section className="card" aria-labelledby="intake-h">
        <div className="card-head">
          <h2 id="intake-h">Energy & protein</h2>
          <button className="btn ghost" onClick={() => navigate('meals')}>Meals ›</button>
        </div>
        {meals ? <NutritionSummary entries={meals} targets={profile.targets} dayComplete={status?.intake_complete ?? null} /> : <div className="skeleton" />}
      </section>

      <section className="card" aria-labelledby="quick-h">
        <h2 id="quick-h">Usual meals — one tap</h2>
        {usual.length ? <QuickTiles presets={usual} /> : <div className="skeleton" />}
        {meals && meals.length ? (
          <>
            <h3 className="section-title" style={{ fontSize: '0.95rem' }}>Logged today</h3>
            <MealTimeline entries={meals.slice(-3)} />
          </>
        ) : null}
      </section>

      <section className="card" aria-labelledby="workout-h">
        <div className="card-head">
          <h2 id="workout-h">Today’s workout</h2>
          {active?.synthetic || (!active && upcoming && program?.synthetic) ? <span className="badge demo">Demo plan</span> : null}
        </div>
        {active ? (
          <>
            <p style={{ marginTop: 0 }}>{active.day_name} — {sessionProgress(active).done}/{sessionProgress(active).total} sets done</p>
            <button className="btn block" onClick={() => navigate('train')}>Continue</button>
          </>
        ) : trainedToday ? (
          <p style={{ margin: 0 }}>Done today: {finished.find((s) => s.local_date === today)?.day_name}. Rest and recover.</p>
        ) : upcoming && program ? (
          <>
            <p style={{ marginTop: 0 }}>{upcoming.name} · {upcoming.exercises.map((e) => e.name).join(', ')}</p>
            <button className="btn block" onClick={() => { void start(program, upcoming).then(() => navigate('train')); }}>Start {upcoming.name}</button>
          </>
        ) : <div className="skeleton" />}
      </section>

      <section className="card" aria-labelledby="act-h">
        <h2 id="act-h">Steps & sleep</h2>
        <div className="row wrap" style={{ gap: 24 }}>
          <div>
            <div className="meter"><div className="value">{steps ? steps.value.toLocaleString('en-US') : 'Not entered'}</div></div>
            <div className="muted small">
              {steps ? `Steps · ${steps.source === 'manual' ? 'Manual' : steps.source} · ${formatShortDate(steps.local_date)}, entered ${formatTime(steps.recorded_at, profile.timezone)}` : 'Steps today · unknown until you enter them'}
            </div>
          </div>
          <div>
            <div className="meter"><div className="value">Not tracked</div></div>
            <div className="muted small">Sleep · no source connected</div>
          </div>
        </div>
        <button className="btn ghost" onClick={() => navigate('progress')} style={{ marginTop: 8 }}>Enter steps ›</button>
      </section>

      <section className="card" aria-labelledby="ins-h">
        <h2 id="ins-h">This week</h2>
        <p style={{ margin: 0 }}>
          Meals logged on {weekMealsDays} of the last 7 days and {weekSessions} workout{weekSessions === 1 ? '' : 's'} finished.
          {weekMealsDays < 7 ? ' Unlogged days are unknown, not zero.' : ''}
        </p>
      </section>

      <CoachCard />
    </div>
  );
}
