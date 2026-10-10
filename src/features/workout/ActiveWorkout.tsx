import { useState } from 'react';
import type { ActualSet, LoadUnit, SessionExercise, SessionSet, WorkoutSession } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { newId } from '@/core/ids';
import { EquipmentArt, Icon } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';
import { formatShortDate } from '@/core/time/localDate';
import {
  addSessionSet, comparableKey, completeSet, currentExerciseIndex, finishSession, lastComparable, removeAddedSet,
  sessionProgress, sessionSummary, setDiscomfort, skipSet, undoSet, updateDraft,
} from '@/domain/training/session';
import { useWorkout } from './useWorkout';

const parseNum = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

function Target({ set, ex }: { set: SessionSet; ex: SessionExercise }) {
  const p = set.planned;
  const reps = p.rep_min === p.rep_max ? `${p.rep_min}` : `${p.rep_min}–${p.rep_max}`;
  return (
    <>
      <span>{reps}{ex.measurement === 'duration' ? 's' : ' reps'}</span>
      {p.target_load ? <><br /><span>{p.target_load} {p.target_unit}</span></> : null}
    </>
  );
}

function loadLabel(ex: SessionExercise, unit: LoadUnit): string {
  if (ex.load_convention === 'per_dumbbell') return `${unit} each`;
  if (ex.load_convention === 'per_side') return `${unit} / side`;
  return unit;
}

function SetRow({ ex, set, n, unit, editable, onSave, onToggle, onMore }: {
  ex: SessionExercise; set: SessionSet; n: number | null; unit: LoadUnit; editable: boolean;
  onSave: (reps: number | null, load: number | null) => void;
  onToggle: (actual: ActualSet | null) => void;
  onMore: () => void;
}) {
  const shownUnit = set.actual?.unit ?? unit;
  const [reps, setReps] = useState(String(set.actual?.reps ?? set.draft.reps ?? ''));
  const [load, setLoad] = useState(String(set.actual?.load ?? set.draft.load ?? ''));
  const [err, setErr] = useState(false);
  const done = set.status === 'completed';
  const skipped = set.status === 'skipped';
  const name = set.type === 'warmup' ? 'Warmup set' : `Set ${n}`;
  const hasLoad = ex.measurement === 'weight_reps';
  const repWord = ex.measurement === 'duration' ? 'seconds' : 'reps';

  const read = (): ActualSet | null => {
    const r = parseNum(reps);
    const l = hasLoad ? parseNum(load) : (parseNum(load) ?? 0);
    if (r === null || Number.isNaN(r) || r < 0 || !Number.isInteger(r) || l === null || Number.isNaN(l) || l < 0) return null;
    return { reps: r, load: l, unit: shownUnit, rir: set.actual?.rir ?? null, discomfort: set.actual?.discomfort ?? false };
  };

  return (
    <tr className={done ? 'done' : skipped ? 'skipped' : ''} data-testid={`set-${set.id}`}>
      <td>
        {editable ? (
          <button className={`set-no${set.type === 'warmup' ? ' warm' : ''}`} onClick={onMore} aria-label={`${name}${set.added ? ' (added)' : ''}: options`}>
            {set.type === 'warmup' ? 'Warmup' : n}
            <Icon name="more" size={14} />
          </button>
        ) : <span className={`set-no${set.type === 'warmup' ? ' warm' : ''}`}>{set.type === 'warmup' ? 'Warmup' : n}</span>}
      </td>
      <td className="target">{skipped ? 'Skipped' : <Target set={set} ex={ex} />}</td>
      {hasLoad ? (
        <td>
          <input className="num-input" inputMode="decimal" aria-label={`${name} weight in ${loadLabel(ex, shownUnit)}`} value={load} disabled={!editable || skipped}
            onChange={(e) => setLoad(e.target.value)} onBlur={() => {
              const a = read();
              if (done && a) onToggle(a); else onSave(parseNum(reps) ?? null, parseNum(load) ?? null);
            }} />
        </td>
      ) : null}
      <td>
        <input className="num-input" inputMode="numeric" pattern="[0-9]*" aria-label={`${name} ${repWord}`} value={reps} disabled={!editable || skipped}
          style={err ? { borderColor: 'var(--danger)' } : undefined}
          onChange={(e) => { setReps(e.target.value); setErr(false); }} onBlur={() => {
            const a = read();
            if (done && a) onToggle(a); else onSave(parseNum(reps) ?? null, parseNum(load) ?? null);
          }} />
      </td>
      <td>
        <button className="check-btn" aria-pressed={done} disabled={!editable || skipped}
          aria-label={done ? `Undo ${name}` : `Complete ${name}`}
          onClick={() => {
            if (done) return onToggle(null);
            const a = read();
            if (!a) return setErr(true);
            onToggle(a);
          }}>
          <Icon name="check" size={22} strokeWidth={3} />
        </button>
      </td>
    </tr>
  );
}

function ExerciseCard({ session, ex, history, expanded, onToggle, unit, editable }: {
  session: WorkoutSession; ex: SessionExercise; history: WorkoutSession[]; expanded: boolean; onToggle: () => void; unit: LoadUnit; editable: boolean;
}) {
  const { mutate, startRest } = useWorkout();
  const { timer, setTimer, notify } = useJournal();
  const [more, setMore] = useState<SessionSet | null>(null);
  const [hurt, setHurt] = useState(false);
  const done = ex.sets.filter((s) => s.status === 'completed').length;
  const allDone = ex.sets.every((s) => s.status !== 'pending');
  const prev = lastComparable(history, comparableKey(ex));
  const prevSession = prev ? history.find((h) => h.exercises.includes(prev)) : undefined;
  const prevText = prev?.sets.filter((s) => s.type === 'working' && s.actual).map((s) => (ex.measurement === 'weight_reps' ? `${s.actual!.load}×${s.actual!.reps}` : `${s.actual!.reps}${ex.measurement === 'duration' ? 's' : ''}`)).join(', ');
  let working = 0;
  const now = () => new Date().toISOString();

  return (
    <section className="card ex-card" aria-label={ex.name}>
      <button className="ex-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="ex-art"><EquipmentArt equipment={ex.variant} /></span>
        <span className="grow">
          <span className="er-name" style={{ fontWeight: 700, fontSize: '1.0625rem' }}>{ex.name}</span>
          <br />
          <span className="label">{done} of {ex.sets.length} sets{ex.unilateral ? ' · each side' : ''}{ex.load_convention === 'per_dumbbell' ? ' · weight per dumbbell' : ''}</span>
        </span>
        {allDone ? <span className="tag train"><Icon name="check" size={14} /> {done === ex.sets.length ? 'Done' : 'Ended'}</span> : null}
        <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
      </button>
      {expanded ? (
        <div className="ex-body">
          <p className="label" style={{ marginBottom: 8 }}>
            {prevText ? `Last time${prevSession ? ` (${formatShortDate(prevSession.local_date)})` : ''}: ${prevText}${ex.measurement === 'weight_reps' ? ` ${prev!.sets.find((s) => s.actual)?.actual?.unit ?? ''}` : ''}` : 'First time with this exercise.'}
          </p>
          <table className={`set-table${ex.measurement === 'weight_reps' ? '' : ' no-load'}`}>
            <colgroup>
              <col className="c-set" />
              <col className="c-target" />
              {ex.measurement === 'weight_reps' ? <col /> : null}
              <col />
              <col className="c-done" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Set</th>
                <th scope="col">Target</th>
                {ex.measurement === 'weight_reps' ? <th scope="col">{loadLabel(ex, unit)}</th> : null}
                <th scope="col">{ex.measurement === 'duration' ? 'Secs' : 'Reps'}</th>
                <th scope="col"><span className="sr-only">Done</span></th>
              </tr>
            </thead>
            <tbody>
              {ex.sets.map((set) => {
                const n = set.type === 'working' ? ++working : null;
                return (
                  <SetRow key={`${set.id}:${set.status}`} ex={ex} set={set} n={n} unit={unit} editable={editable}
                    onSave={(reps, load) => {
                      if (reps !== set.draft.reps || load !== set.draft.load) void mutate(session.id, (s) => updateDraft(s, set.id, { reps, load }));
                    }}
                    onToggle={async (actual) => {
                      if (!actual) {
                        await mutate(session.id, (s) => undoSet(s, set.id));
                        if (timer?.set_id === set.id) await setTimer(null);
                        return;
                      }
                      const wasDone = set.status === 'completed';
                      const saved = await mutate(session.id, (s) => completeSet(s, set.id, actual, now()));
                      if (saved && !wasDone) await startRest(session.id, set.id, set.planned.rest_seconds);
                    }}
                    onMore={() => setMore(set)} />
                );
              })}
            </tbody>
          </table>
          {editable ? <p className="label" style={{ marginTop: 4 }}>Tap a set number for effort, skip or “something hurt”.</p> : null}
          {editable ? (
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="btn secondary sm" onClick={() => void mutate(session.id, (s) => addSessionSet(s, ex.planned_exercise_id, newId))}><Icon name="plus" size={18} /> Add set</button>
              <button className="btn ghost sm" onClick={() => setHurt(true)}><Icon name="hurt" size={18} /> Something hurts</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {more ? (
        <Sheet title={more.type === 'warmup' ? 'Warmup set' : 'Set options'} onClose={() => setMore(null)}>
          <div className="stack">
            {more.status === 'completed' ? (
              <>
                <div>
                  <div style={{ fontWeight: 600 }}>How many more reps could you have done?</div>
                  <p className="small muted">Optional. It helps you and the coach judge effort.</p>
                  <div className="chips" style={{ marginTop: 8 }}>
                    {[0, 1, 2, 3, 4].map((r) => (
                      <button key={r} className="chip" aria-pressed={more.actual?.rir === r} onClick={async () => {
                        await mutate(session.id, (s) => completeSet(s, more.id, { ...more.actual!, rir: more.actual?.rir === r ? null : r }, more.completed_at ?? now()));
                        setMore(null);
                      }}>{r === 4 ? '4+' : r}</button>
                    ))}
                  </div>
                </div>
                <button className="choice" aria-pressed={more.actual?.discomfort ?? false} onClick={async () => {
                  await mutate(session.id, (s) => setDiscomfort(s, more.id, !more.actual?.discomfort));
                  setMore(null);
                }}>
                  <Icon name="hurt" /> <span className="grow">{more.actual?.discomfort ? 'Marked: something hurt during this set' : 'Something hurt during this set'}</span>
                </button>
              </>
            ) : null}
            {more.status === 'pending' ? (
              <button className="btn secondary" onClick={async () => { await mutate(session.id, (s) => skipSet(s, more.id)); setMore(null); }}>Skip this set</button>
            ) : null}
            {more.status === 'skipped' ? (
              <button className="btn secondary" onClick={async () => { await mutate(session.id, (s) => undoSet(s, more.id)); setMore(null); }}>Undo skip</button>
            ) : null}
            {more.added && more.status !== 'completed' ? (
              <button className="btn danger" onClick={async () => { await mutate(session.id, (s) => removeAddedSet(s, more.id)); setMore(null); }}>Remove this extra set</button>
            ) : null}
          </div>
        </Sheet>
      ) : null}
      {hurt ? (
        <Sheet title="Something hurts" onClose={() => setHurt(false)}>
          <div className="stack">
            <p>Pain is a signal to stop, not to push through. You can skip the rest of this exercise and note it for later.</p>
            <p className="small muted">If pain is sharp, doesn’t settle, or comes with chest pain, dizziness or numbness, stop and get medical help.</p>
            <button className="btn" onClick={async () => {
              await mutate(session.id, (s) => {
                let next = s;
                const exNow = s.exercises.find((x) => x.planned_exercise_id === ex.planned_exercise_id)!;
                const lastDone = [...exNow.sets].reverse().find((x) => x.status === 'completed');
                if (lastDone) next = setDiscomfort(next, lastDone.id, true);
                for (const st of exNow.sets) if (st.status === 'pending') next = skipSet(next, st.id);
                return next;
              });
              setHurt(false);
              notify({ kind: 'info', message: `Skipped the rest of ${ex.name} and noted it` });
            }}>Skip the rest of {ex.name}</button>
            <button className="btn secondary" onClick={() => setHurt(false)}>Close</button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

export function FinishSummary({ session, history, onClose, onReopen }: { session: WorkoutSession; history: WorkoutSession[]; onClose: () => void; onReopen?: () => void }) {
  const { profile } = useJournal();
  const s = sessionSummary(session, history, profile.units);
  const word = { heavier: 'heavier than last time', more_reps: 'more reps than last time', same: 'same as last time', lower: 'lighter than last time', first_time: 'first time', not_comparable: '' } as const;
  return (
    <Sheet title={`${session.day_name} done`} onClose={onClose} actions={
      <>
        {onReopen ? <button className="btn secondary grow" onClick={onReopen}>Reopen</button> : null}
        <button className="btn grow" onClick={onClose}>Done</button>
      </>
    }>
      <div className="stack">
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="metric" style={{ minHeight: 0 }}><span className="m-label">Time</span><span className="m-value">{s.durationMinutes ?? '—'}<small>min</small></span></div>
          <div className="metric" style={{ minHeight: 0 }}><span className="m-label">Exercises</span><span className="m-value">{s.exercisesDone}<small>/{s.exercisesTotal}</small></span></div>
          <div className="metric" style={{ minHeight: 0 }}><span className="m-label">Working sets</span><span className="m-value">{s.workingSets}</span></div>
        </div>
        {s.comparisons.length ? (
          <ul className="list-divided" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {s.comparisons.map((c) => (
              <li key={c.name} className="row between" style={{ padding: '10px 0' }}>
                <span><strong>{c.name}</strong><br /><span className="label">{c.best ? `Best: ${c.best.load ? `${c.best.load} ${c.best.unit} × ` : ''}${c.best.reps}` : ''}</span></span>
                <span className={`tag${c.change === 'heavier' || c.change === 'more_reps' ? ' train' : ''}`}>{word[c.change]}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No completed working sets.</p>}
        {s.skipped ? <p className="small muted">{s.skipped} set{s.skipped === 1 ? '' : 's'} skipped — kept as skipped, not as zero.</p> : null}
        {s.discomfortFlags ? <p className="small muted">You noted discomfort {s.discomfortFlags === 1 ? 'once' : `${s.discomfortFlags} times`}. Take it easy on those movements and get advice if it continues.</p> : null}
      </div>
    </Sheet>
  );
}

export function ActiveWorkout({ session, history, onFinished }: { session: WorkoutSession; history: WorkoutSession[]; onFinished: (s: WorkoutSession) => void }) {
  const { profile, setTimer } = useJournal();
  const { mutate } = useWorkout();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const prog = sessionProgress(session);
  const current = session.exercises[currentExerciseIndex(session)]?.planned_exercise_id;
  const openId = expanded ?? current;
  const pending = prog.total - prog.done - prog.skipped;

  return (
    <div className="stack">
      <div className="workout-top">
        <div className="row between">
          <div className="grow">
            <h1 style={{ fontSize: '1.5rem', fontWeight: 750 }}>{session.day_name}</h1>
            <div className="label">{prog.done} of {prog.total} sets · saved after every set</div>
          </div>
          <button className="btn" onClick={() => setConfirm(true)}>Finish</button>
        </div>
        <div className="progress-track" style={{ marginTop: 10 }} role="progressbar" aria-label="Workout progress" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
          <div className="progress-fill" style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} />
        </div>
      </div>
      {session.exercises.map((ex) => (
        <ExerciseCard key={ex.planned_exercise_id} session={session} ex={ex} history={history} unit={profile.units} editable={session.status === 'active'}
          expanded={openId === ex.planned_exercise_id}
          onToggle={() => setExpanded(openId === ex.planned_exercise_id ? '' : ex.planned_exercise_id)} />
      ))}
      <button className="btn block" onClick={() => setConfirm(true)}>Finish workout</button>
      {confirm ? (
        <Sheet title="Finish workout?" onClose={() => setConfirm(false)} actions={
          <>
            <button className="btn secondary grow" onClick={() => setConfirm(false)}>Keep going</button>
            <button className="btn grow" onClick={async () => {
              setConfirm(false);
              const done = await mutate(session.id, (s) => finishSession(s, new Date().toISOString()));
              await setTimer(null);
              if (done) onFinished(done);
            }}>Finish</button>
          </>
        }>
          <p>{prog.done} of {prog.total} sets done.{pending > 0 ? ` ${pending} not done will stay as not done.` : ''}</p>
        </Sheet>
      ) : null}
    </div>
  );
}
