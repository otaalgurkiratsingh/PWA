import { useState } from 'react';
import type { ActualSet, LoadUnit, SessionExercise, SessionSet } from '@shared/contracts';
import { CheckIcon } from '@/core/design/icons';
import { formatLoad } from '@/domain/training/session';

interface Props {
  exercise: SessionExercise;
  set: SessionSet;
  workingNumber: number | null;
  unit: LoadUnit;
  editable: boolean;
  onComplete: (actual: ActualSet) => void;
  onUndo: () => void;
  onSkip: () => void;
  onDraft: (reps: number | null, load: number | null) => void;
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function SetRow({ exercise, set, workingNumber, unit, editable, onComplete, onUndo, onSkip, onDraft }: Props) {
  const shownUnit: LoadUnit = set.actual?.unit ?? unit;
  const [reps, setReps] = useState(String(set.actual?.reps ?? set.draft.reps ?? ''));
  const [load, setLoad] = useState(String(set.actual?.load ?? set.draft.load ?? ''));
  const [rir, setRir] = useState<string>(set.actual?.rir != null ? String(set.actual.rir) : '');
  const [discomfort, setDiscomfort] = useState(set.actual?.discomfort ?? false);
  const [err, setErr] = useState<string | null>(null);
  const label = set.type === 'warmup' ? 'Warm-up set' : `Set ${workingNumber}`;
  const isBodyweight = exercise.load_convention === 'bodyweight';
  const loadLabel = isBodyweight ? `Added ${shownUnit}` : exercise.load_convention === 'per_dumbbell' ? `${shownUnit} each` : exercise.load_convention === 'per_side' ? `${shownUnit}/side` : shownUnit;

  const p = set.planned;
  const planReps = p.rep_min === p.rep_max ? `${p.rep_min}` : `${p.rep_min}–${p.rep_max}`;
  const planText = `Planned: ${planReps} reps${p.target_load ? ` @ ${formatLoad(p.target_load, p.target_unit)}` : ''}${p.rir_target !== null ? ` · RIR ${p.rir_target}` : ''}${exercise.unilateral ? ' · each side' : ''}`;

  const done = set.status === 'completed';
  const skipped = set.status === 'skipped';

  const submit = () => {
    if (done) return onUndo();
    const r = parseNum(reps);
    const l = parseNum(load) ?? (isBodyweight ? 0 : null);
    if (r === null || Number.isNaN(r) || r < 0 || !Number.isInteger(r)) return setErr('Enter whole reps');
    if (l === null || Number.isNaN(l) || l < 0) return setErr(`Enter load in ${shownUnit}`);
    setErr(null);
    onComplete({ reps: r, load: l, unit: shownUnit, rir: rir === '' ? null : Number(rir), discomfort });
  };

  const saveDraft = () => {
    const r = parseNum(reps);
    const l = parseNum(load);
    onDraft(r === null || Number.isNaN(r) ? null : Math.max(0, Math.round(r)), l === null || Number.isNaN(l) ? null : Math.max(0, l));
  };

  return (
    <div className={`set-row${done ? ' completed' : ''}${skipped ? ' skipped' : ''}`} data-testid={`set-${set.id}`}>
      <span className={`set-badge${set.type === 'warmup' ? ' warmup' : ''}`} aria-hidden="true">{set.type === 'warmup' ? 'W' : workingNumber}</span>
      <label className="field set-reps">
        Reps
        <input className="input" inputMode="numeric" pattern="[0-9]*" value={reps} disabled={!editable || done || skipped}
          onChange={(e) => setReps(e.target.value)} onBlur={saveDraft} aria-label={`${label} reps`} />
      </label>
      <label className="field set-load">
        {loadLabel}
        <input className="input" inputMode="decimal" value={load} disabled={!editable || done || skipped}
          onChange={(e) => setLoad(e.target.value)} onBlur={saveDraft} aria-label={`${label} load in ${loadLabel}`} />
      </label>
      <button className="done-btn" aria-pressed={done} disabled={!editable || skipped} onClick={submit}
        aria-label={done ? `Undo ${label} completion` : `Complete ${label}`}>
        <CheckIcon />
      </button>
      <div className="set-plan">
        <span className="sr-only">{label}. </span>{planText}
        {err ? <span role="alert" style={{ color: 'var(--danger)', marginLeft: 8 }}>{err}</span> : null}
      </div>
      {editable && set.type === 'working' && !skipped ? (
        <div className="set-extra">
          <label>
            RIR
            <select value={rir} onChange={(e) => setRir(e.target.value)} disabled={done} aria-label={`${label} reps in reserve (optional)`}>
              <option value="">–</option>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={discomfort} disabled={done} onChange={(e) => setDiscomfort(e.target.checked)} />
            Discomfort
          </label>
          {!done ? <button className="link-btn" onClick={onSkip}>Skip set</button> : null}
        </div>
      ) : null}
      {skipped ? (
        <div className="set-extra">
          <span className="badge">Skipped</span>
          {editable ? <button className="link-btn" onClick={onUndo}>Undo skip</button> : null}
        </div>
      ) : null}
    </div>
  );
}
