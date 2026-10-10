import { useEffect, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack, navigate } from '@/app/router';
import { decideDraft, getDraft, type DraftRow } from '@/core/ai/coachData';
import { aiErrorText, type AiPlanDraft } from '@/core/ai/client';
import { EquipmentArt, Icon } from '@/core/design/icons';
import { newId } from '@/core/ids';
import { EXERCISE_LIBRARY, exerciseId } from '@shared/fixtures/exerciseLibrary';
import { editorDraftFromAi, exerciseName, PLAN_SEED_KEY } from '@/domain/training/aiPlan';
import { WEEKDAY_LONG, commitPlan } from '@/domain/training/plan';
import { saveErrorMessage } from '@/features/food/useFood';
import { CoachGate } from './CoachParts';
import { requestPlanDraft } from './planDraft';

const EQUIP = new Map(EXERCISE_LIBRARY.map((x) => [exerciseId(x), x.equipment]));

/** Read-only preview of a validated AI draft. Nothing is activated until the person accepts. */
export function PlanPreview({ plan, rationale }: { plan: AiPlanDraft; rationale?: string }) {
  const warm = plan.warmup.reduce((s, w) => s + w.minutes, 0);
  return (
    <div className="stack">
      <div className="card train stack-sm">
        <span className="eyebrow">Draft plan</span>
        <div className="feature-title">{plan.title}</div>
        <span className="small" style={{ color: 'var(--train-ink)' }}>
          {plan.days.length} workout{plan.days.length === 1 ? '' : 's'} a week · {plan.schedule_mode === 'weekdays' ? 'on set weekdays' : 'in order, whenever you train'} · review after {plan.duration_weeks_before_review} weeks
        </span>
      </div>
      {rationale ? <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{rationale}</p> : null}
      {plan.warmup.length ? (
        <div className="review-block">
          <h3>Warm-up · about {warm} min</h3>
          <ul>{plan.warmup.map((w, i) => <li key={i}>{w.instruction} ({w.minutes} min)</li>)}</ul>
        </div>
      ) : null}
      {plan.days.map((d, i) => (
        <div key={i} className="card tight">
          <div className="day-card">
            <span className="day-badge" aria-hidden="true">{d.weekday !== null ? WEEKDAY_LONG[d.weekday]!.slice(0, 3) : i + 1}</span>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>{d.label}</div>
              <div className="label">{d.weekday !== null ? `${WEEKDAY_LONG[d.weekday]} · ` : ''}about {d.estimated_minutes} min</div>
            </div>
          </div>
          <ul className="ex-list">
            {d.exercises.map((e, k) => (
              <li key={k} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--train-ink)', display: 'inline-flex', paddingTop: 2 }}><EquipmentArt equipment={EQUIP.get(e.exercise_id) ?? 'other'} size={20} /></span>
                <span className="grow">
                  <strong style={{ color: 'var(--text)' }}>{exerciseName(e.exercise_id)}</strong> · {e.working_sets} × {e.rep_min === e.rep_max ? e.rep_min : `${e.rep_min}–${e.rep_max}`} · rest {e.rest_seconds}s
                  {e.target_load ? ` · start ${e.target_load} ${e.load_unit}` : e.load_unit !== 'bodyweight' ? ' · start with a comfortable, controlled weight' : ''}
                  {e.effort_instruction ? <><br />{e.effort_instruction}</> : null}
                  {e.substitution_exercise_ids.length ? <><br />Swap: {e.substitution_exercise_ids.map(exerciseName).join(', ')}</> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="review-block">
        <h3>How to progress</h3>
        <p className="small" style={{ margin: 0 }}>{plan.progression_rule}</p>
      </div>
      {plan.recovery_notes.length ? (
        <div className="review-block">
          <h3>Recovery</h3>
          <ul>{plan.recovery_notes.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ) : null}
      <p className="label">This is a draft from AI Coach, checked by the app against your answers and equipment. Stop any exercise that hurts. Times are estimates.</p>
    </div>
  );
}

export function DraftScreen({ draftId }: { draftId: string | null }) {
  const header = (
    <div className="row" style={{ gap: 4 }}>
      <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('coach')}><Icon name="chevronLeft" /></button>
      <h1 className="sub-title grow">Plan draft</h1>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 20 }}>
      <CoachGate header={header}>
        {header}
        {draftId ? <DraftLoader draftId={draftId} /> : <p className="muted">That draft wasn’t found.</p>}
      </CoachGate>
    </div>
  );
}

function DraftLoader({ draftId }: { draftId: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; draft: DraftRow | null }>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    getDraft(draftId).then((d) => live && setState({ kind: 'ready', draft: d }), (e: Error) => live && setState({ kind: 'error', message: e.message }));
    return () => {
      live = false;
    };
  }, [draftId]);
  if (state.kind === 'loading') return <div className="skeleton" style={{ minHeight: 240 }} />;
  if (state.kind === 'error') return <div className="notice warn" role="alert">{state.message}</div>;
  if (!state.draft) return <p className="muted">That draft wasn’t found.</p>;
  return <DraftActions draft={state.draft} />;
}

function DraftActions({ draft }: { draft: DraftRow }) {
  const { journal, profile, notify, refresh, today, syncNow } = useJournal();
  const [busy, setBusy] = useState<'accept' | 'regen' | 'reject' | null>(null);
  const [status, setStatus] = useState(draft.status);
  const stale = draft.profile_version !== profile.profile_version;

  const accept = async () => {
    setBusy('accept');
    try {
      const r = await decideDraft(draft.id, 'accepted', profile.profile_version);
      if (r.status === 'stale') { setBusy(null); return notify({ kind: 'error', message: 'Your answers changed after this draft was made. Regenerate it first.' }); }
      if (r.status !== 'accepted' || !r.plan) { setBusy(null); return notify({ kind: 'error', message: 'This draft was already decided or replaced.' }); }
      // A NEW program version; earlier workouts keep the plan they were done with.
      const current = await journal.currentProgram();
      const v = commitPlan({ draft: editorDraftFromAi(r.plan, profile.units, newId), previous: current, ownerId: journal.ownerId, newId, now: new Date().toISOString(), synthetic: profile.synthetic });
      await journal.commit('programs', v);
      refresh();
      setStatus('accepted');
      notify({ kind: 'info', message: 'Plan accepted. Past workouts keep the plan they were done with.' });
      navigate('workout');
    } catch (e) {
      setBusy(null);
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  const edit = () => {
    try {
      sessionStorage.setItem(PLAN_SEED_KEY, JSON.stringify({ draftId: draft.id, plan: editorDraftFromAi(draft.plan, profile.units, newId) }));
    } catch {
      // the editor will start from the current plan instead
    }
    navigate('plan');
  };

  const regenerate = async () => {
    setBusy('regen');
    const r = await requestPlanDraft({ profile, today, syncNow, source: draft.source === 'chat' ? 'chat' : 'onboarding' });
    setBusy(null);
    if (r.status === 'ok' && r.operation === 'onboarding_plan' && r.draft) return navigate('draft', r.draft.id);
    if (r.status === 'ok' && r.operation === 'onboarding_plan') return notify({ kind: 'info', message: r.output.assistant_message });
    notify({ kind: 'error', message: aiErrorText(r) });
  };

  const reject = async () => {
    setBusy('reject');
    try {
      await decideDraft(draft.id, 'rejected', profile.profile_version);
      setStatus('rejected');
      notify({ kind: 'info', message: 'Draft dismissed. Your plan is unchanged.' });
    } catch (e) {
      notify({ kind: 'error', message: (e as Error).message });
    }
    setBusy(null);
  };

  return (
    <>
      <PlanPreview plan={draft.plan} rationale={draft.response?.assistant_message} />
      {status !== 'draft' ? (
        <div className="notice">This draft was {status === 'accepted' ? 'accepted' : status === 'rejected' ? 'dismissed' : 'replaced by a newer draft'}.</div>
      ) : (
        <div className="stack-sm">
          {stale ? <div className="notice warn">Your answers changed after this draft was made. Regenerate it to use them.</div> : null}
          <button className="btn block" disabled={busy !== null || stale} onClick={() => void accept()}>{busy === 'accept' ? <span className="spinner" /> : <Icon name="check" />} Accept plan</button>
          <div className="row">
            <button className="btn secondary grow" disabled={busy !== null} onClick={edit}><Icon name="edit" size={18} /> Edit</button>
            <button className="btn secondary grow" disabled={busy !== null} onClick={() => void regenerate()}>{busy === 'regen' ? <span className="spinner" /> : <Icon name="repeat" size={18} />} Regenerate</button>
          </div>
          <button className="btn ghost" disabled={busy !== null} onClick={() => void reject()}>Not now</button>
          <p className="label">Accepting saves this as a new version of your plan. Edit opens it in the plan editor first. Regenerating uses one of this week’s plan drafts.</p>
        </div>
      )}
    </>
  );
}
