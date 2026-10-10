import { useMemo, useState } from 'react';
import type { Equipment, ExerciseDefinition, Measurement, MuscleGroup, PlannedExercise, PrescribedSet, ProgramVersion } from '@shared/contracts';
import { EXERCISE_LIBRARY, type LibraryExercise } from '@shared/fixtures/exerciseLibrary';
import { useJournal, useQuery } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { base64Of } from '@/core/ai/photo';
import { callAi, type NotebookPhotoOutput } from '@/core/ai/client';
import { newId } from '@/core/ids';
import { EquipmentArt, Icon } from '@/core/design/icons';
import { PhotoCropper } from '@/core/design/PhotoCropper';
import { EmptyState, Segmented, Sheet, Toggle } from '@/core/design/ui';
import {
  WEEKDAY_LONG, WEEKDAY_SHORT, addDay, addExercise, addPlannedSet, commitPlan, describeChanges, draftFrom, duplicateDay, duplicateExercise,
  duplicatePlannedSet, moveDay, moveExercise, plannedFromDefinition, removeDay, removeExercise, removePlannedSet, renameDay, replaceExercise,
  setWeekday, updatePlannedSet, validatePlan, type PlanDraft,
} from '@/domain/training/plan';
import { saveErrorMessage } from '@/features/food/useFood';

const MUSCLES: { value: MuscleGroup; label: string }[] = [
  { value: 'chest', label: 'Chest' }, { value: 'back', label: 'Back' }, { value: 'legs', label: 'Legs' }, { value: 'shoulders', label: 'Shoulders' },
  { value: 'arms', label: 'Arms' }, { value: 'core', label: 'Core' }, { value: 'full', label: 'Full body' },
];
const EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: 'barbell', label: 'Barbell' }, { value: 'dumbbell', label: 'Dumbbells' }, { value: 'cable', label: 'Cable' }, { value: 'machine', label: 'Machine' },
  { value: 'bodyweight', label: 'Bodyweight' }, { value: 'kettlebell', label: 'Kettlebell' }, { value: 'band', label: 'Band' }, { value: 'other', label: 'Other' },
];
const REST = [30, 45, 60, 90, 120, 150, 180, 240];

export function defToLibrary(d: ExerciseDefinition): LibraryExercise {
  return { key: d.key, name: d.name, equipment: d.equipment, muscle_group: d.muscle_group, load_convention: d.load_convention, unilateral: d.unilateral, measurement: d.measurement };
}

function ExercisePicker({ onPick, onClose, title }: { onPick: (d: LibraryExercise) => void; onClose: () => void; title: string }) {
  const { journal, profile, notify, refresh } = useJournal();
  const custom = useQuery((j) => j.library().then((l) => l.exercises), []);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', equipment: 'dumbbell' as Equipment, muscle: 'chest' as MuscleGroup, measurement: 'weight_reps' as Measurement, unilateral: false });
  const all = useMemo(() => [...(custom ?? []).map(defToLibrary), ...EXERCISE_LIBRARY], [custom]);
  const shown = all.filter((x) => `${x.name} ${x.muscle_group} ${x.equipment}`.toLowerCase().includes(q.trim().toLowerCase()));

  const createCustom = async () => {
    if (!form.name.trim()) return;
    const nowIso = new Date().toISOString();
    const measurement: Measurement = form.equipment === 'bodyweight' && form.measurement === 'weight_reps' ? 'reps' : form.measurement;
    const def: ExerciseDefinition = {
      id: newId(), owner_id: journal.ownerId, local_version: 0, created_at: nowIso, updated_at: nowIso, deleted_at: null, synthetic: profile.synthetic,
      key: `custom:${newId().slice(0, 8)}`, name: form.name.trim().slice(0, 60), equipment: form.equipment, muscle_group: form.muscle,
      load_convention: form.equipment === 'bodyweight' ? 'bodyweight' : form.equipment === 'dumbbell' ? 'per_dumbbell' : 'total',
      unilateral: form.unilateral, measurement,
    };
    try {
      await journal.commit('exercises', def);
      refresh();
      onPick(defToLibrary(def));
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  return (
    <Sheet title={creating ? 'Create my own exercise' : title} onClose={onClose}>
      {creating ? (
        <div className="stack">
          <label className="field">Name<input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Landmine press" /></label>
          <label className="field">Equipment
            <select className="select" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value as Equipment })}>{EQUIPMENT.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
          </label>
          <label className="field">Muscle group
            <select className="select" value={form.muscle} onChange={(e) => setForm({ ...form, muscle: e.target.value as MuscleGroup })}>{MUSCLES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
          </label>
          <label className="field">What you record
            <select className="select" value={form.measurement} onChange={(e) => setForm({ ...form, measurement: e.target.value as Measurement })}>
              <option value="weight_reps">Weight and reps</option>
              <option value="reps">Reps only</option>
              <option value="duration">Time (seconds)</option>
            </select>
          </label>
          <Toggle label="One side at a time" description="e.g. split squats, one-arm rows" checked={form.unilateral} onChange={(v) => setForm({ ...form, unilateral: v })} />
          {form.equipment === 'dumbbell' ? <p className="label">Dumbbell weights are recorded per dumbbell.</p> : null}
          <div className="row">
            <button className="btn secondary grow" onClick={() => setCreating(false)}>Back</button>
            <button className="btn grow" disabled={!form.name.trim()} onClick={createCustom}>Add exercise</button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <input className="input" type="search" placeholder="Search exercises" aria-label="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="choice" onClick={() => { setForm({ ...form, name: q }); setCreating(true); }}>
            <Icon name="plus" /> <span className="grow"><strong>Create my own exercise</strong>{q ? <><br /><span className="small muted">“{q}”</span></> : null}</span>
          </button>
          <div className="list-divided">
            {shown.map((x, i) => (
              <button key={`${x.key}-${x.equipment}-${i}`} className="ex-row" onClick={() => onPick(x)}>
                <span className="ex-art"><EquipmentArt equipment={x.equipment} /></span>
                <span className="grow"><span className="er-name">{x.name}</span><br /><span className="er-sub">{MUSCLES.find((m) => m.value === x.muscle_group)?.label} · {EQUIPMENT.find((m) => m.value === x.equipment)?.label}{x.key.startsWith('custom:') ? ' · yours' : ''}</span></span>
                <Icon name="plus" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function SetEditor({ ex, onChange, onAdd, onDuplicate, onRemove, unit }: {
  ex: PlannedExercise; unit: string;
  onChange: (i: number, p: Partial<PrescribedSet>) => void; onAdd: () => void; onDuplicate: (i: number) => void; onRemove: (i: number) => void;
}) {
  const repWord = ex.measurement === 'duration' ? 'Seconds' : 'Reps';
  let n = 0;
  return (
    <div className="stack-sm" style={{ marginTop: 4 }}>
      {ex.sets.map((s, i) => {
        if (s.type === 'working') n++;
        const name = s.type === 'warmup' ? 'Warmup' : `Set ${n}`;
        return (
          <div key={i} className="card tight flat stack-sm">
            <div className="row between" style={{ gap: 4 }}>
              <Segmented label={`${name} type`} value={s.type} onChange={(v) => onChange(i, { type: v })} options={[{ value: 'warmup', label: 'Warmup' }, { value: 'working', label: 'Working' }]} />
              <div className="row" style={{ gap: 0 }}>
                <button className="icon-btn plain" aria-label={`Duplicate ${name}`} onClick={() => onDuplicate(i)}><Icon name="copy" size={18} /></button>
                <button className="icon-btn plain" aria-label={`Remove ${name}`} onClick={() => onRemove(i)} disabled={ex.sets.length <= 1}><Icon name="trash" size={18} /></button>
              </div>
            </div>
            <div className="set-edit-grid" style={{ gridTemplateColumns: ex.measurement === 'weight_reps' ? '1.7fr 1fr 1fr' : '1.7fr 1fr' }}>
              <div className="field">
                <span>{repWord}</span>
                <div className="row" style={{ gap: 4 }}>
                  <input className="num-input" inputMode="numeric" aria-label={`${name} ${repWord.toLowerCase()} minimum`} value={s.rep_min} onChange={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) onChange(i, { rep_min: v }); }} />
                  <span aria-hidden="true">–</span>
                  <input className="num-input" inputMode="numeric" aria-label={`${name} ${repWord.toLowerCase()} maximum`} value={s.rep_max} onChange={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) onChange(i, { rep_max: v }); }} />
                </div>
              </div>
              {ex.measurement === 'weight_reps' ? (
                <label className="field">{unit}<input className="num-input" inputMode="decimal" aria-label={`${name} target weight (optional)`} placeholder="—" value={s.target_load ?? ''} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); onChange(i, { target_load: e.target.value.trim() === '' || !(v > 0) ? null : v, target_unit: unit as PrescribedSet['target_unit'] }); }} /></label>
              ) : null}
              <label className="field">Rest
                <select className="num-input" aria-label={`${name} rest`} value={s.rest_seconds} onChange={(e) => onChange(i, { rest_seconds: Number(e.target.value) })}>
                  {[...new Set([...REST, s.rest_seconds])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r < 60 ? `${r}s` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`}</option>)}
                </select>
              </label>
            </div>
          </div>
        );
      })}
      <button className="btn secondary sm" onClick={onAdd}><Icon name="plus" size={18} /> Add set</button>
    </div>
  );
}

function NotebookImport({ onClose, onImport }: { onClose: () => void; onImport: (r: NotebookPhotoOutput) => void }) {
  const { mode, profile } = useJournal();
  const [state, setState] = useState<{ kind: 'photo' } | { kind: 'loading' } | { kind: 'result'; r: NotebookPhotoOutput; picked: boolean[] } | { kind: 'error'; message: string }>({ kind: 'photo' });
  if (mode !== 'account' || !profile.consent.ai_processing) {
    return (
      <Sheet title="Import from notebook" onClose={onClose}>
        <p className="muted">{mode === 'demo' ? 'Reading notebook photos works after signing in with your own account.' : 'Turn on AI help in Settings to read a notebook photo. You can always add exercises by hand.'}</p>
      </Sheet>
    );
  }
  return (
    <Sheet title="Import from notebook" onClose={onClose}>
      {state.kind === 'photo' ? (
        <PhotoCropper hint="Frame the page with your plan. You’ll check every exercise before anything is added." onDone={async (p) => {
          setState({ kind: 'loading' });
          const res = await callAi({ operation: 'photo_suggest', kind: 'notebook', image_base64: base64Of(p.analysis), presets: [] });
          if (res.status === 'ok' && res.operation === 'photo_suggest' && res.kind === 'notebook') setState({ kind: 'result', r: res.result, picked: res.result.exercises.map(() => true) });
          else setState({ kind: 'error', message: 'message' in res ? res.message : 'Couldn’t read that page.' });
        }} />
      ) : state.kind === 'loading' ? (
        <div className="row muted"><span className="spinner" /> Reading your notes…</div>
      ) : state.kind === 'error' ? (
        <div className="notice warn" role="alert">{state.message}</div>
      ) : !state.r.is_workout_notes || state.r.exercises.length === 0 ? (
        <div className="notice">No exercises found. Try a clearer, closer photo of the page.</div>
      ) : (
        <div className="stack">
          <p className="label">Untick anything that was read wrongly. You can edit everything afterwards.</p>
          {state.r.exercises.map((x, i) => (
            <button key={i} className="choice" role="checkbox" aria-checked={state.picked[i]} onClick={() => setState({ ...state, picked: state.picked.map((v, k) => (k === i ? !v : v)) })}>
              <span className="grow"><strong>{x.name}</strong><br /><span className="small muted">{x.sets} × {x.reps_min === x.reps_max ? x.reps_min : `${x.reps_min}–${x.reps_max}`}{x.load ? ` @ ${x.load} ${x.unit ?? ''}` : ''}</span></span>
              <Icon name={state.picked[i] ? 'check' : 'plus'} />
            </button>
          ))}
          {state.r.questions.length ? <div className="notice">{state.r.questions.join(' ')}</div> : null}
          <button className="btn" onClick={() => onImport({ ...state.r, exercises: state.r.exercises.filter((_, i) => state.picked[i]) })}>Add as a new day</button>
        </div>
      )}
    </Sheet>
  );
}

export function PlanEditor() {
  const current = useQuery((j) => j.currentProgram(), []);
  if (current === undefined) return <div className="skeleton" style={{ minHeight: 320 }} />;
  return <PlanEditorForm key={current?.id ?? 'none'} current={current} />;
}

function PlanEditorForm({ current }: { current: ProgramVersion | null }) {
  const { journal, profile, notify, refresh } = useJournal();
  const active = useQuery((j) => j.activeSession(), []);
  const customDefs = useQuery((j) => j.library().then((l) => l.exercises), []);
  const [draft, setDraft] = useState<PlanDraft>(() => draftFrom(current));
  const [dayId, setDayId] = useState<string | null>(() => current?.days[0]?.id ?? null);
  const [openEx, setOpenEx] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'replace'; exId: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notebook, setNotebook] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const base = draftFrom(current);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  const day = draft.days.find((d) => d.id === dayId) ?? draft.days[0] ?? null;
  const unit = profile.units;
  const changes = describeChanges(current ? base : null, draft);

  const save = async () => {
    const errs = validatePlan(draft);
    setErrors(errs);
    if (errs.length) return setPreview(false);
    try {
      const v: ProgramVersion = commitPlan({ draft, previous: current, ownerId: journal.ownerId, newId, now: new Date().toISOString(), synthetic: profile.synthetic });
      await journal.commit('programs', v);
      refresh();
      notify({ kind: 'info', message: 'Plan saved. Past workouts keep their own plan.' });
      goBack('workout');
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  const importDay = (r: NotebookPhotoOutput) => {
    let d = addDay(draft, 'Imported day', newId);
    const newDay = d.days[d.days.length - 1]!;
    const lib = [...(customDefs ?? []).map(defToLibrary), ...EXERCISE_LIBRARY];
    for (const x of r.exercises) {
      const match = lib.find((l) => l.name.toLowerCase() === x.name.toLowerCase()) ?? lib.find((l) => x.name.toLowerCase().includes(l.name.toLowerCase()));
      const def: LibraryExercise = match ?? { key: `custom:${newId().slice(0, 8)}`, name: x.name.slice(0, 60), equipment: 'other', muscle_group: 'full', load_convention: 'total', unilateral: false, measurement: 'weight_reps' };
      const sets: PrescribedSet[] = Array.from({ length: x.sets }, () => ({
        type: 'working', rep_min: x.reps_min, rep_max: Math.max(x.reps_min, x.reps_max), target_load: x.load && x.load > 0 ? x.load : null,
        target_unit: (x.unit ?? unit) as PrescribedSet['target_unit'], rest_seconds: 90, rir_target: null,
      }));
      d = addExercise(d, newDay.id, plannedFromDefinition(def, unit, newId, sets));
    }
    setDraft(d);
    setDayId(newDay.id);
    setNotebook(false);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <button className="btn ghost" onClick={() => goBack('workout')}><Icon name="chevronLeft" size={18} /> {dirty ? 'Discard' : 'Back'}</button>
        <button className="btn" disabled={!dirty} onClick={() => { setErrors(validatePlan(draft)); setPreview(true); }}>Save plan</button>
      </div>

      <label className="field">Plan name<input className="input" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <div className="stack-sm">
        <span className="label" style={{ fontWeight: 600 }}>How you follow it</span>
        <Segmented label="Schedule" full value={draft.schedule} onChange={(schedule) => setDraft({ ...draft, schedule })}
          options={[{ value: 'rotation', label: 'In order' }, { value: 'weekdays', label: 'On set weekdays' }]} />
        <span className="label">{draft.schedule === 'rotation' ? 'Today suggests the day after your last workout.' : 'Today suggests the day assigned to this weekday.'}</span>
      </div>

      <div className="stack-sm">
        <div className="chips" role="tablist" aria-label="Workout days">
          {draft.days.map((d) => (
            <button key={d.id} role="tab" className="chip" aria-selected={d.id === day?.id} aria-pressed={d.id === day?.id} onClick={() => setDayId(d.id)}>
              {d.name || 'Untitled'}{draft.schedule === 'weekdays' && d.weekday !== null ? ` · ${WEEKDAY_SHORT[d.weekday]}` : ''}
            </button>
          ))}
          <button className="chip" onClick={() => { const d = addDay(draft, `Day ${draft.days.length + 1}`, newId); setDraft(d); setDayId(d.days[d.days.length - 1]!.id); }}>
            <Icon name="plus" size={16} /> Add day
          </button>
        </div>
      </div>

      {!day ? (
        <div className="card">
          <EmptyState icon="workout" title="Start your plan" action={
            <div className="stack-sm">
              <button className="btn" onClick={() => { const d = addDay(draft, 'Day 1', newId); setDraft(d); setDayId(d.days[0]!.id); }}>Add your first day</button>
              <button className="btn secondary" onClick={() => setNotebook(true)}><Icon name="notebook" size={18} /> Import from notebook photo</button>
            </div>
          }>Add days, then the exercises and sets you do on each.</EmptyState>
        </div>
      ) : (
        <div className="card stack">
          <label className="field">Day name<input className="input" value={day.name} maxLength={60} onChange={(e) => setDraft(renameDay(draft, day.id, e.target.value))} /></label>
          {draft.schedule === 'weekdays' ? (
            <label className="field">Weekday
              <select className="select" value={day.weekday ?? ''} onChange={(e) => setDraft(setWeekday(draft, day.id, e.target.value === '' ? null : Number(e.target.value)))}>
                <option value="">No fixed day</option>
                {WEEKDAY_LONG.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </select>
            </label>
          ) : null}
          <div className="toolbar" role="toolbar" aria-label={`${day.name} actions`}>
            <button className="tool" onClick={() => setDraft(moveDay(draft, day.id, -1))} disabled={draft.days[0]?.id === day.id} aria-label={`Move ${day.name} earlier`}><Icon name="chevronLeft" size={20} /><span>Earlier</span></button>
            <button className="tool" onClick={() => setDraft(moveDay(draft, day.id, 1))} disabled={draft.days.at(-1)?.id === day.id} aria-label={`Move ${day.name} later`}><Icon name="chevronRight" size={20} /><span>Later</span></button>
            <button className="tool" onClick={() => { const d = duplicateDay(draft, day.id, newId); setDraft(d); setDayId(d.days[d.days.findIndex((x) => x.id === day.id) + 1]!.id); }} aria-label={`Duplicate ${day.name}`}><Icon name="copy" size={20} /><span>Duplicate</span></button>
            <button className="tool danger" onClick={() => setConfirmRemove(true)} aria-label={`Remove ${day.name}`}><Icon name="trash" size={20} /><span>Remove</span></button>
          </div>

          <div className="list-divided">
            {day.exercises.length === 0 ? <p className="small muted" style={{ padding: '8px 0' }}>No exercises yet.</p> : null}
            {day.exercises.map((ex, i) => (
              <div key={ex.id}>
                <div className="row">
                  <button className="ex-row grow" onClick={() => setOpenEx(openEx === ex.id ? null : ex.id)} aria-expanded={openEx === ex.id}>
                    <span className="ex-art"><EquipmentArt equipment={ex.variant} /></span>
                    <span className="grow">
                      <span className="er-name">{ex.name}</span><br />
                      <span className="er-sub">{ex.sets.length} sets · {ex.sets.filter((s) => s.type === 'working')[0] ? `${ex.sets.find((s) => s.type === 'working')!.rep_min}–${ex.sets.find((s) => s.type === 'working')!.rep_max}${ex.measurement === 'duration' ? 's' : ' reps'}` : 'warmups only'}</span>
                    </span>
                    <Icon name={openEx === ex.id ? 'chevronUp' : 'chevronDown'} />
                  </button>
                </div>
                {openEx === ex.id ? (
                  <div className="stack-sm" style={{ paddingBottom: 12 }}>
                    <div className="toolbar" role="toolbar" aria-label={`${ex.name} actions`}>
                      <button className="tool" disabled={i === 0} onClick={() => setDraft(moveExercise(draft, day.id, ex.id, -1))} aria-label={`Move ${ex.name} up`}><Icon name="chevronUp" size={20} /><span>Up</span></button>
                      <button className="tool" disabled={i === day.exercises.length - 1} onClick={() => setDraft(moveExercise(draft, day.id, ex.id, 1))} aria-label={`Move ${ex.name} down`}><Icon name="chevronDown" size={20} /><span>Down</span></button>
                      <button className="tool" onClick={() => setDraft(duplicateExercise(draft, day.id, ex.id, newId))} aria-label={`Duplicate ${ex.name}`}><Icon name="copy" size={20} /><span>Copy</span></button>
                      <button className="tool" onClick={() => setPicker({ mode: 'replace', exId: ex.id })} aria-label={`Replace ${ex.name}`}><Icon name="repeat" size={20} /><span>Replace</span></button>
                      <button className="tool danger" onClick={() => { setDraft(removeExercise(draft, day.id, ex.id)); setOpenEx(null); }} aria-label={`Remove ${ex.name}`}><Icon name="trash" size={20} /><span>Remove</span></button>
                    </div>
                    <SetEditor ex={ex} unit={unit}
                      onChange={(k, p) => setDraft(updatePlannedSet(draft, day.id, ex.id, k, p))}
                      onAdd={() => setDraft(addPlannedSet(draft, day.id, ex.id))}
                      onDuplicate={(k) => setDraft(duplicatePlannedSet(draft, day.id, ex.id, k))}
                      onRemove={(k) => setDraft(removePlannedSet(draft, day.id, ex.id, k))} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="row wrap">
            <button className="btn grow" onClick={() => setPicker({ mode: 'add' })}><Icon name="plus" size={18} /> Add exercise</button>
            <button className="btn secondary" onClick={() => setNotebook(true)} aria-label="Import a day from a notebook photo"><Icon name="notebook" size={18} /></button>
          </div>
        </div>
      )}

      {errors.length ? <div className="notice error" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div> : null}

      {picker ? (
        <ExercisePicker title={picker.mode === 'add' ? 'Add exercise' : 'Replace exercise'} onClose={() => setPicker(null)} onPick={(def) => {
          if (!day) return;
          if (picker.mode === 'add') {
            const ex = plannedFromDefinition(def, unit, newId);
            setDraft(addExercise(draft, day.id, ex));
            setOpenEx(ex.id);
          } else setDraft(replaceExercise(draft, day.id, picker.exId, def, unit));
          setPicker(null);
        }} />
      ) : null}
      {preview ? (
        <Sheet title="Save plan?" onClose={() => setPreview(false)} actions={
          <>
            <button className="btn secondary grow" onClick={() => setPreview(false)}>Keep editing</button>
            <button className="btn grow" disabled={errors.length > 0} onClick={save}>Save plan</button>
          </>
        }>
          <div className="stack">
            {errors.length ? <div className="notice error" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div> : null}
            <ul style={{ margin: 0, paddingLeft: 18 }}>{(changes.length ? changes : ['Small edits']).map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="small muted">
              {draft.days.length} day{draft.days.length === 1 ? '' : 's'} · {draft.days.reduce((a, d) => a + d.exercises.length, 0)} exercises.
              {' '}Past workouts keep the plan they were done with.
              {active ? ` Your workout in progress (${active.day_name}) keeps its current sets; changes apply from your next workout.` : ''}
            </p>
          </div>
        </Sheet>
      ) : null}
      {confirmRemove && day ? (
        <Sheet title={`Remove ${day.name}?`} onClose={() => setConfirmRemove(false)} actions={
          <>
            <button className="btn secondary grow" onClick={() => setConfirmRemove(false)}>Keep</button>
            <button className="btn danger grow" onClick={() => { const d = removeDay(draft, day.id); setDraft(d); setDayId(d.days[0]?.id ?? null); setConfirmRemove(false); }}>Remove day</button>
          </>
        }>
          <p className="muted">Workouts you already did on this day stay in your history.</p>
        </Sheet>
      ) : null}
      {notebook ? <NotebookImport onClose={() => setNotebook(false)} onImport={importDay} /> : null}
    </div>
  );
}
