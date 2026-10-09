import { useState } from 'react';
import type { WorkoutSession } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { Sheet } from '@/app/Sheet';
import { MuscleIcon } from '@/core/design/icons';
import { formatShortDate } from '@/core/time/localDate';
import {
  comparableKey,
  completeSet,
  describePrescription,
  finishSession,
  lastComparable,
  reopenSession,
  sessionProgress,
  skipSet,
  undoSet,
  updateDraft,
  workingSummary,
} from '@/domain/training/session';
import { SetRow } from './SetRow';
import { useTraining } from './useTraining';

function PreviousLine({ history, ex }: { history: WorkoutSession[]; ex: WorkoutSession['exercises'][number] }) {
  const prev = lastComparable(history, comparableKey(ex));
  if (!prev) return <div className="previous">No previous comparable session.</div>;
  const sets = prev.sets.filter((s) => s.type === 'working' && s.status === 'completed' && s.actual);
  const session = history.find((h) => h.exercises.includes(prev));
  return (
    <div className="previous">
      Last time{session ? ` (${formatShortDate(session.local_date)})` : ''}:{' '}
      {sets.map((s) => `${s.actual!.load}${s.actual!.unit}×${s.actual!.reps}`).join(', ') || 'no working sets'}
    </div>
  );
}

function ActiveSession({ session, history }: { session: WorkoutSession; history: WorkoutSession[] }) {
  const { profile, notify, timer } = useJournal();
  const { mutate, startRest, setTimer } = useTraining();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const prog = sessionProgress(session);
  const editable = session.status === 'active';
  const now = () => new Date().toISOString();

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <span className="eyebrow">{editable ? 'In progress' : 'Finished'} · v{session.program_version}</span>
            <h2>{session.day_name}</h2>
          </div>
          {session.synthetic ? <span className="badge demo">Demo</span> : null}
        </div>
        <p className="muted small" style={{ margin: 0 }} aria-live="polite">
          {prog.done} of {prog.total} sets done{prog.skipped ? ` · ${prog.skipped} skipped` : ''} · saved on this device after every set
        </p>
      </section>

      {session.exercises.map((ex) => {
        let working = 0;
        const sum = workingSummary(ex, profile.units);
        return (
          <section key={ex.planned_exercise_id} className="card ex-card" aria-label={ex.name}>
            <div className="card-head">
              <div className="row">
                <span className="muscle-chip"><MuscleIcon group={ex.muscle_group} /></span>
                <div>
                  <h3>{ex.name}</h3>
                  <div className="planned">
                    {ex.variant} · {describePrescription(ex.sets.map((s) => s.planned))}
                    {ex.load_convention === 'per_dumbbell' ? ' · load per dumbbell' : ''}
                    {ex.unilateral ? ' · each side' : ''}
                  </div>
                </div>
              </div>
            </div>
            <PreviousLine history={history} ex={ex} />
            {ex.sets.map((set) => {
              const n = set.type === 'working' ? ++working : null;
              return (
                <SetRow
                  key={`${set.id}:${set.status}`}
                  exercise={ex}
                  set={set}
                  workingNumber={n}
                  unit={profile.units}
                  editable={editable}
                  onComplete={async (actual) => {
                    const saved = await mutate(session.id, (s) => completeSet(s, set.id, actual, now()));
                    if (saved) await startRest(session.id, set.id, set.planned.rest_seconds);
                  }}
                  onUndo={async () => {
                    await mutate(session.id, (s) => undoSet(s, set.id));
                    if (timer?.set_id === set.id) await setTimer(null);
                  }}
                  onSkip={() => mutate(session.id, (s) => skipSet(s, set.id))}
                  onDraft={(reps, load) => {
                    if (reps !== set.draft.reps || load !== set.draft.load) void mutate(session.id, (s) => updateDraft(s, set.id, { reps, load }));
                  }}
                />
              );
            })}
            {sum.completedWorkingSets ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                {sum.completedWorkingSets} working set{sum.completedWorkingSets === 1 ? '' : 's'} · volume {sum.volume} {sum.unit}·reps (descriptive, this exercise only)
              </p>
            ) : null}
          </section>
        );
      })}

      {editable ? (
        <button className="btn block" onClick={() => setConfirmFinish(true)}>Finish workout</button>
      ) : (
        <button className="btn secondary block" onClick={() => mutate(session.id, reopenSession)}>Reopen to edit</button>
      )}

      {confirmFinish ? (
        <Sheet title="Finish workout?" onClose={() => setConfirmFinish(false)}>
          <p>
            {prog.done} of {prog.total} sets completed.
            {prog.total - prog.done - prog.skipped > 0 ? ` ${prog.total - prog.done - prog.skipped} not done will be kept as not done (not zero).` : ''}
          </p>
          <div className="row">
            <button className="btn secondary" onClick={() => setConfirmFinish(false)}>Keep going</button>
            <span className="spacer" />
            <button
              className="btn"
              onClick={async () => {
                setConfirmFinish(false);
                await mutate(session.id, (s) => finishSession(s, now()));
                await setTimer(null);
                notify({ kind: 'info', message: 'Workout saved on this device' });
              }}
            >
              Finish
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

export function TrainScreen() {
  const lib = useQuery((j) => j.library(), []);
  const sessions = useQuery((j) => j.sessions(), []);
  const { start } = useTraining();
  const [viewing, setViewing] = useState<string | null>(null);

  if (!lib || !sessions) return <div className="skeleton" />;
  const program = [...lib.programs].sort((a, b) => b.version - a.version)[0];
  const active = sessions.find((s) => s.status === 'active');
  const finished = sessions.filter((s) => s.status === 'finished');
  const viewed = viewing ? sessions.find((s) => s.id === viewing) : null;

  if (active) return <ActiveSession session={active} history={finished} />;
  if (viewed) {
    return (
      <div className="stack">
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setViewing(null)}>‹ Back to plan</button>
        <ActiveSession session={viewed} history={finished.filter((s) => s.id !== viewed.id)} />
      </div>
    );
  }
  if (!program) return <p className="empty">No program yet.</p>;

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>{program.name} · version {program.version}</p>
      {program.days.map((day) => {
        const last = finished.find((s) => s.day_id === day.id);
        return (
          <section key={day.id} className="card">
            <div className="day-card">
              <div className="muscles" aria-hidden="true">
                {day.muscle_groups.slice(0, 3).map((g) => <span key={g} className="muscle-chip"><MuscleIcon group={g} /></span>)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0 }}>{day.name}</h2>
                <div className="muted small">{day.muscle_groups.join(' · ')} · {day.exercises.length} exercises</div>
                <div className="muted small">{last ? `Last done ${formatShortDate(last.local_date)}` : 'Not done yet'}</div>
              </div>
            </div>
            <ul className="small" style={{ paddingLeft: 18, margin: '10px 0' }}>
              {day.exercises.map((e) => <li key={e.id}>{e.name} — {describePrescription(e.sets)}</li>)}
            </ul>
            <button className="btn block" onClick={() => start(program, day)}>Start {day.name}</button>
          </section>
        );
      })}

      <h2 className="section-title">Recent sessions</h2>
      <section className="card">
        {finished.length === 0 ? <p className="empty">No finished sessions yet.</p> : (
          <ul className="timeline">
            {finished.slice(0, 8).map((s) => {
              const p = sessionProgress(s);
              return (
                <li key={s.id}>
                  <span className="t-time">{formatShortDate(s.local_date)}</span>
                  <span className="t-body">
                    <span className="t-name">{s.day_name}</span> {s.synthetic ? <span className="badge demo">Demo</span> : null}
                    <br /><span className="muted small">{p.done}/{p.total} sets{p.skipped ? `, ${p.skipped} skipped` : ''}</span>
                  </span>
                  <button className="btn secondary" style={{ minWidth: 64 }} onClick={() => setViewing(s.id)}>View</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
