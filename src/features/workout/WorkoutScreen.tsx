import { useState } from 'react';
import type { WorkoutSession } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { EquipmentArt, Icon } from '@/core/design/icons';
import { EmptyState, Section } from '@/core/design/ui';
import { formatShortDate } from '@/core/time/localDate';
import { WEEKDAY_SHORT, suggestedDay } from '@/domain/training/plan';
import { sessionProgress } from '@/domain/training/session';
import { ActiveWorkout, FinishSummary } from './ActiveWorkout';
import { useWorkout } from './useWorkout';

const MUSCLE_LABEL: Record<string, string> = { chest: 'Chest', back: 'Back', legs: 'Legs', shoulders: 'Shoulders', arms: 'Arms', core: 'Core', full: 'Full body' };

export function WorkoutScreen() {
  const { today } = useJournal();
  const program = useQuery((j) => j.currentProgram(), []);
  const sessions = useQuery((j) => j.sessions(), []);
  const { start } = useWorkout();
  const [viewing, setViewing] = useState<WorkoutSession | null>(null);

  if (program === undefined || !sessions) return <div className="skeleton" style={{ minHeight: 240 }} />;
  const active = sessions.find((s) => s.status === 'active');
  const finished = sessions.filter((s) => s.status === 'finished');
  if (active) return <ActiveWorkout session={active} history={finished} />;

  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const next = program ? suggestedDay(program, finished, weekday) : null;
  const doneToday = finished.find((s) => s.local_date === today);

  return (
    <div className="stack" style={{ gap: 24 }}>
      {!program ? (
        <div className="card train">
          <EmptyState icon="workout" title="Build your plan" action={<button className="btn" onClick={() => navigate('plan')}>Create my plan</button>}>
            Add your workout days, exercises and sets — the way your notebook has them.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card train">
            <span className="eyebrow">{doneToday ? 'Done today' : next ? 'Up next' : 'Rest day'}</span>
            <div className="feature-title">{doneToday ? doneToday.day_name : next ? next.name : 'Nothing scheduled today'}</div>
            <p className="small" style={{ color: 'var(--train-ink)' }}>
              {doneToday
                ? `${sessionProgress(doneToday).done} sets logged. Nice work.`
                : next
                  ? `${next.exercises.length} exercises · ${next.exercises.slice(0, 3).map((e) => e.name).join(', ')}${next.exercises.length > 3 ? '…' : ''}`
                  : 'Your plan follows weekdays. Pick any day below to train anyway.'}
            </p>
            {next && !doneToday ? (
              <button className="btn block" style={{ marginTop: 14 }} onClick={() => void start(program, next)}><Icon name="workout" /> Start {next.name}</button>
            ) : null}
          </div>

          <Section title="My plan" action={<button className="link" onClick={() => navigate('plan')}><Icon name="edit" size={16} /> Edit plan</button>}>
            <div className="stack-sm">
              {program.days.map((d, idx) => {
                const last = finished.find((s) => s.day_id === d.id);
                return (
                  <div key={d.id} className="card tight">
                    <div className="day-card">
                      <span className="day-badge" aria-hidden="true">{program.schedule === 'weekdays' && d.weekday !== null ? WEEKDAY_SHORT[d.weekday] : idx + 1}</span>
                      <div className="grow">
                        <div style={{ fontWeight: 700 }}>{d.name}</div>
                        <div className="label">
                          {d.muscle_groups.map((m) => MUSCLE_LABEL[m]).join(' · ') || 'No exercises'}
                        </div>
                        <div className="label">{last ? `Last done ${formatShortDate(last.local_date)}` : 'Not done yet'}</div>
                      </div>
                      <button className="btn tonal sm" onClick={() => void start(program, d)} aria-label={`Start ${d.name}`}>Start</button>
                    </div>
                    <ul className="ex-list">
                      {d.exercises.map((e) => (
                        <li key={e.id} className="row" style={{ gap: 8 }}>
                          <span style={{ color: 'var(--train-ink)', display: 'inline-flex' }}><EquipmentArt equipment={e.variant} size={20} /></span>
                          {e.name} · {e.sets.filter((s) => s.type === 'working').length} sets
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <button className="btn secondary block" onClick={() => navigate('plan')}><Icon name="plus" size={18} /> Add or change days</button>
            </div>
          </Section>
        </>
      )}

      <Section title="Recent workouts">
        {finished.length === 0 ? <p className="small muted">Finished workouts appear here.</p> : (
          <div className="card tight list-divided">
            {finished.slice(0, 8).map((s) => {
              const p = sessionProgress(s);
              return (
                <button key={s.id} className="ex-row" onClick={() => setViewing(s)}>
                  <span className="day-badge" style={{ width: 44, height: 44, fontSize: '0.8125rem' }} aria-hidden="true">{formatShortDate(s.local_date).split(' ').reverse().join(' ')}</span>
                  <span className="grow"><span className="er-name">{s.day_name}</span><br /><span className="er-sub">{formatShortDate(s.local_date)} · {p.done} sets{p.skipped ? ` · ${p.skipped} skipped` : ''}</span></span>
                  <Icon name="chevronRight" />
                </button>
              );
            })}
          </div>
        )}
      </Section>
      {viewing ? <FinishSummary session={viewing} history={finished.filter((x) => x.id !== viewing.id)} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
