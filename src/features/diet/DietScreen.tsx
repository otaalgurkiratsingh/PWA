/**
 * Food plan (T7): targets computed in code (Mifflin-St Jeor + safety floors), a day of real
 * food-database dishes, and the same draft pattern as workout plans: preview → Accept / Edit /
 * Regenerate. With AI help on, AI Coach may propose the day (checked in code like plans); otherwise,
 * or if its proposal doesn't fit, the app composes the day itself. Every number shown comes from the
 * food database or from the maths here. General guidance only, not medical or dietetic advice.
 */
import { useEffect, useMemo, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { decideDietDraft, latestOpenDietDraft } from '@/core/ai/coachData';
import { aiErrorText, callAi } from '@/core/ai/client';
import { CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { Section, Stepper } from '@/core/design/ui';
import { CoachLine } from '@/features/coach/ChatBits';
import { useTrainer } from '@/features/coach/Trainer';
import { useLibrary, saveErrorMessage } from '@/features/food/useFood';
import { ProfilingQuestion, QUESTION_TEXT } from '@/features/profiling/ProfilingCard';
import { markAsked } from '@/domain/profiling/progressive';
import { KG_PER_LB } from '@/domain/training/session';
import {
  composeDay, explainTargets, mealTotals, ON_THE_ROAD, practicalNotes, type DietDay, type DietTargets, type ShelfDish, type Slot,
} from '../../../supabase/functions/_shared/diet';
import { acceptedPlan, dayTotals, dietSetup, takeDietSeed, usualDishIds, useShelf } from './dietData';

const SLOT_LABEL: Record<Slot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
type Targets = Pick<DietTargets, 'energy_kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>;
interface Draft { day: DietDay; source: 'ai' | 'code'; id: string | null; notes: string[]; variant: number; targets: Targets }

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const servings = (n: number) => (n === 1 ? '' : ` × ${n}`);

/** One day of eating with per-meal and daily totals against the targets. */
export function DietDayView({ day, byId, targets }: { day: DietDay; byId: ReadonlyMap<string, ShelfDish>; targets: Targets }) {
  const t = dayTotals(day, byId);
  const proteinShort = t.protein_g < targets.protein_g * 0.9;
  return (
    <div className="stack">
      {day.meals.filter((m) => m.items.length).map((m) => {
        const mt = mealTotals(m, byId);
        return (
          <div key={m.slot} className="card tight" data-slot={m.slot}>
            <div className="row between"><strong>{SLOT_LABEL[m.slot]}</strong><span className="small muted num">{fmt(mt.kcal)} kcal · {Math.round(mt.protein_g)} g protein</span></div>
            <ul className="ex-list">
              {m.items.map((i) => {
                const d = byId.get(i.dish_id);
                return (
                  <li key={i.dish_id} data-dish-id={i.dish_id} className="row between" style={{ gap: 8 }}>
                    <span className="grow">{d?.name ?? i.dish_id}<span className="small muted"> · {d?.serving_label ?? ''}{servings(i.servings)}</span></span>
                    <span className="small muted num">{d ? fmt(d.kcal * i.servings) : '—'} kcal</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="card food stack-sm" data-testid="diet-totals" data-kcal={t.kcal} data-protein={t.protein_g} data-target-kcal={targets.energy_kcal}>
        <span className="eyebrow">Day total</span>
        <span><strong className="num">{fmt(t.kcal)}</strong> of {fmt(targets.energy_kcal)} kcal · <strong className="num">{Math.round(t.protein_g)}</strong> of {targets.protein_g} g protein</span>
        <span className="small">Carbs {Math.round(t.carbs_g)} g · fat {Math.round(t.fat_g)} g · fibre {Math.round(t.fiber_g)} g</span>
        {proteinShort ? <span className="small">The food database doesn’t have enough high-protein foods for your choices yet. Dahi, paneer, a whey shake or roasted chana can close the gap.</span> : null}
        <span className="label">Numbers from the TrainLuma food database (per serving, as published).</span>
      </div>
    </div>
  );
}

function DietEditor({ day, byId, onChange }: { day: DietDay; byId: ReadonlyMap<string, ShelfDish>; onChange: (d: DietDay) => void }) {
  const set = (slot: Slot, id: string, servingsNext: number | null) => onChange({
    meals: day.meals.map((m) => (m.slot !== slot ? m : {
      ...m,
      items: servingsNext === null ? m.items.filter((i) => i.dish_id !== id) : m.items.map((i) => (i.dish_id === id ? { ...i, servings: servingsNext } : i)),
    })),
  });
  return (
    <div className="stack">
      {day.meals.map((m) => (
        <div key={m.slot} className="card tight stack-sm">
          <strong>{SLOT_LABEL[m.slot]}</strong>
          {m.items.length === 0 ? <span className="small muted">Nothing planned.</span> : m.items.map((i) => {
            const d = byId.get(i.dish_id);
            return (
              <div key={i.dish_id} className="row" style={{ gap: 8 }}>
                <span className="grow small">{d?.name ?? i.dish_id}<br /><span className="muted">{d?.serving_label} · {i.servings} serving{i.servings === 1 ? '' : 's'}</span></span>
                <Stepper value={i.servings} label={`Servings of ${d?.name ?? i.dish_id}`} decLabel={`Less ${d?.name ?? ''}`} incLabel={`More ${d?.name ?? ''}`}
                  disabledDec={i.servings <= 0.5} onDec={() => set(m.slot, i.dish_id, Math.max(0.5, i.servings - 0.5))} onInc={() => set(m.slot, i.dish_id, Math.min(4, i.servings + 0.5))} />
                <button className="icon-btn plain" aria-label={`Remove ${d?.name ?? i.dish_id}`} onClick={() => set(m.slot, i.dish_id, null)}><Icon name="trash" size={18} /></button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DietScreen() {
  const { profile, updateProfile, notify, today, syncNow, mode } = useJournal();
  const trainer = useTrainer();
  const shelf = useShelf();
  const { data: lib } = useLibrary();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ day: DietDay; from: 'draft' | 'plan' } | null>(() => {
    const seed = takeDietSeed();
    return seed ? { day: seed, from: 'plan' } : null;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [changeGoal, setChangeGoal] = useState(false);
  const aiReady = mode === 'account' && profile.consent.ai_processing && profile.consent.cloud_backup && navigator.onLine;
  const setup = useMemo(() => (shelf ? dietSetup(profile, shelf) : null), [profile, shelf]);
  const usual = useMemo(() => (setup && lib ? usualDishIds(lib.presets, setup.allowed) : []), [setup, lib]);
  const trucker = profile.training?.lifestyle === 'trucker';

  // Pick up an open AI food-plan draft for the current answers (e.g. after leaving the screen).
  useEffect(() => {
    if (!aiReady) return;
    let live = true;
    latestOpenDietDraft().then((d) => {
      if (live && d && d.profile_version === profile.profile_version) {
        setDraft((cur) => cur ?? { day: { meals: d.plan.meals }, source: d.plan.source, id: d.id, notes: d.plan.notes, variant: 0, targets: d.plan.targets });
      }
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [aiReady, profile.profile_version]);

  const header = (
    <div className="row" style={{ gap: 4 }}>
      <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('today')}><Icon name="chevronLeft" /></button>
      <h1 className="sub-title grow">Food plan</h1>
    </div>
  );
  if (!shelf || !setup) return <div className="stack">{header}<div className="skeleton" style={{ minHeight: 240 }} /></div>;

  const answer = async (next: typeof profile, r: string | null, key?: Parameters<typeof markAsked>[1]) => {
    if (r) setReply(r);
    await updateProfile(key ? { ...next, profiling: markAsked(next, key, today) } : next);
  };

  const compose = (variant: number) => {
    const t = setup.targets!;
    setDraft({ day: composeDay(setup.allowed, t, { cuisine: profile.food_prefs.cuisine, usual, variant }), source: 'code', id: null, notes: [], variant, targets: t });
  };

  const generate = async (variant: number) => {
    setMessage(null);
    if (!aiReady) return compose(variant);
    setBusy('generate');
    try {
      await syncNow();
      const r = await callAi({ operation: 'diet_draft', today, profile_version: profile.profile_version }, undefined, { timezone: profile.timezone });
      if (r.status === 'ok' && r.operation === 'diet_draft' && r.draft) {
        const p = r.draft.plan;
        setDraft({ day: { meals: p.meals }, source: p.source, id: r.draft.id, notes: p.notes, variant, targets: p.targets });
      } else if (r.status === 'ok' && r.operation === 'diet_draft') {
        setMessage([r.message, ...r.questions].join(' '));
      } else {
        // The app can always build the day itself from the database.
        compose(variant);
        setMessage(`${aiErrorText(r)} The app built this day from the food database instead.`);
      }
    } catch (e) {
      compose(variant);
      setMessage(saveErrorMessage(e));
    }
    setBusy(null);
  };

  const accept = async (day: DietDay, d: Draft | null) => {
    setBusy('accept');
    try {
      let targets: Targets = d?.targets ?? profile.diet_plan?.targets ?? setup.targets!;
      let finalDay = day;
      if (d?.id) {
        const r = await decideDietDraft(d.id, 'accepted', profile.profile_version);
        if (r.status === 'stale') throw new Error('Your answers changed after this draft. Make a new one.');
        if (r.status !== 'accepted' || !r.plan) throw new Error('This draft was already decided.');
        targets = r.plan.targets;
        if (!editing) finalDay = { meals: r.plan.meals };
      }
      // Re-check on the phone too: every item must be a real public database dish.
      const bad = finalDay.meals.flatMap((m) => m.items).find((i) => !setup.byId.has(i.dish_id) || !setup.allowed.some((x) => x.id === i.dish_id));
      if (bad) throw new Error('That plan has a food that isn’t in the database for your choices.');
      const plan = acceptedPlan(finalDay, targets, d?.source ?? profile.diet_plan?.source ?? 'code', profile.profile_version);
      await updateProfile({ ...profile, diet_plan: plan, targets: { energy_kcal: targets.energy_kcal, protein_g: targets.protein_g, source: 'diet_plan' } });
      setDraft(null);
      setEditing(null);
      notify({ kind: 'info', message: 'Food plan saved. Your daily targets now match it.' });
    } catch (e) {
      notify({ kind: 'error', message: (e as Error).message });
    }
    setBusy(null);
  };

  const dismiss = async () => {
    if (draft?.id) await decideDietDraft(draft.id, 'rejected', profile.profile_version).catch(() => undefined);
    setDraft(null);
  };

  const weightGoal = profile.body.goal_weight_kg && profile.body.goal_weeks
    ? `${Math.round((profile.units === 'lb' ? profile.body.goal_weight_kg / KG_PER_LB : profile.body.goal_weight_kg) * 10) / 10} ${profile.units} in ${profile.body.goal_weeks} weeks`
    : null;
  const askDiet = profile.food_prefs.pattern === 'unspecified' && !('diet' in profile.profiling.asked);

  return (
    <div className="stack" style={{ gap: 20 }}>
      {header}
      {reply ? (
        <div className="card coach stack-sm" role="status">
          <CoachLine avatar={trainer.avatar}><div className="bubble coach">{reply}</div></CoachLine>
          <button className="btn sm secondary" style={{ alignSelf: 'flex-end' }} onClick={() => setReply(null)}>Got it</button>
        </div>
      ) : null}

      {setup.missing.length ? (
        <div className="card coach stack">
          <div className="row" style={{ gap: 12 }}><CoachAvatar avatar={trainer.avatar} size={44} ring /><strong className="grow">To work out your food targets, I need a couple of details.</strong></div>
          {setup.missing.some((m) => m === 'weight' || m === 'height') ? (
            <div className="stack-sm"><p className="small" style={{ margin: 0 }}>{QUESTION_TEXT.body}</p><ProfilingQuestion k="body" onAnswer={(n, r) => answer(n, r)} /></div>
          ) : (
            <div className="stack-sm"><p className="small" style={{ margin: 0 }}>{QUESTION_TEXT.age_sex}</p><ProfilingQuestion k="age_sex" onAnswer={(n, r) => answer(n, r)} /></div>
          )}
          <span className="label">Used only for the calorie maths, kept in your private journal. Nothing is guessed from photos.</span>
        </div>
      ) : null}

      {!setup.missing.length && askDiet ? (
        <div className="card coach stack-sm">
          <p className="small" style={{ margin: 0 }}>{QUESTION_TEXT.diet}</p>
          <ProfilingQuestion k="diet" onAnswer={(n, r) => answer(n, r, 'diet')} />
        </div>
      ) : null}

      {setup.targets ? (
        <Section title="Your daily targets">
          <div className="card stack-sm" data-testid="diet-targets">
            <div className="metrics">
              <div className="metric"><span className="m-label">Energy</span><span className="m-value">{fmt(setup.targets.energy_kcal)}<small>kcal</small></span></div>
              <div className="metric"><span className="m-label">Protein</span><span className="m-value">{setup.targets.protein_g}<small>g</small></span></div>
            </div>
            <span className="small">Carbs about {setup.targets.carbs_g} g · fat about {setup.targets.fat_g} g</span>
            {explainTargets(setup.targets, trucker).map((x) => <p key={x} className="small" style={{ margin: 0 }}>{x}</p>)}
            {setup.targets.notes.map((x) => <p key={x} className="small" style={{ margin: 0 }}><Icon name="info" size={14} /> {x}</p>)}
            <div className="row between" style={{ alignItems: 'center' }}>
              <span className="small">{weightGoal ? `Goal: ${weightGoal}` : profile.body.no_timeline ? 'No goal weight set' : 'Goal weight: optional'}</span>
              <button className="link" onClick={() => setChangeGoal(!changeGoal)}>{weightGoal ? 'Change goal' : 'Add a goal'}</button>
            </div>
            {changeGoal ? <ProfilingQuestion k="timeline" onAnswer={async (n, r) => { setChangeGoal(false); await answer(n, r, 'timeline'); }} /> : null}
          </div>
        </Section>
      ) : null}

      {setup.targets && editing ? (
        <Section title="Edit your day">
          <DietEditor day={editing.day} byId={setup.byId} onChange={(day) => setEditing({ ...editing, day })} />
          <DietDayView day={editing.day} byId={setup.byId} targets={draft?.targets ?? profile.diet_plan?.targets ?? setup.targets} />
          <div className="row">
            <button className="btn secondary grow" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn grow" disabled={busy !== null} onClick={() => void accept(editing.day, editing.from === 'draft' ? draft : null)}>Save food plan</button>
          </div>
        </Section>
      ) : setup.targets && draft ? (
        <Section title="Draft food plan">
          <p className="small" style={{ margin: 0 }}>{draft.source === 'ai' ? `Composed by ${trainer.name} from real database dishes and checked by the app.` : 'Built by the app from real database dishes.'} Nothing changes until you accept.</p>
          {draft.notes.length ? <ul className="small">{draft.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          <DietDayView day={draft.day} byId={setup.byId} targets={draft.targets} />
          <button className="btn block" disabled={busy !== null} onClick={() => void accept(draft.day, draft)}>{busy === 'accept' ? <span className="spinner" /> : <Icon name="check" />} Accept food plan</button>
          <div className="row">
            <button className="btn secondary grow" disabled={busy !== null} onClick={() => setEditing({ day: draft.day, from: 'draft' })}><Icon name="edit" size={18} /> Edit</button>
            <button className="btn secondary grow" disabled={busy !== null} onClick={() => void generate(draft.variant + 1)}>{busy === 'generate' ? <span className="spinner" /> : <Icon name="repeat" size={18} />} Regenerate</button>
          </div>
          <button className="btn ghost" disabled={busy !== null} onClick={() => void dismiss()}>Not now</button>
        </Section>
      ) : setup.targets && profile.diet_plan ? (
        <Section title="Your food plan">
          <DietDayView day={{ meals: profile.diet_plan.meals }} byId={setup.byId} targets={profile.diet_plan.targets} />
          <div className="row">
            <button className="btn secondary grow" onClick={() => setEditing({ day: { meals: profile.diet_plan!.meals }, from: 'plan' })}><Icon name="edit" size={18} /> Edit my food plan</button>
            <button className="btn secondary grow" disabled={busy !== null} onClick={() => void generate(0)}>Make a new plan</button>
          </div>
        </Section>
      ) : setup.targets ? (
        <div className="stack-sm">
          <button className="btn block" disabled={busy !== null} onClick={() => void generate(0)}>
            {busy === 'generate' ? <><span className="spinner" /> Building your day…</> : <><Icon name="sparkle" /> Draft my food plan</>}
          </button>
          <span className="label">{aiReady ? `${trainer.name} composes the day from your usual foods and the food database; it counts as one of today’s chat messages. The app checks every item and does the maths.` : 'The app builds your day from the food database, on this phone.'}</span>
        </div>
      ) : null}
      {message ? <div className="notice" role="status">{message}</div> : null}

      {trucker ? (
        <Section title="On the road">
          <div className="card stack-sm">
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{ON_THE_ROAD.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </Section>
      ) : null}
      {practicalNotes({ trucker, painAreas: profile.training?.pain_areas ?? [] }).map((x) => <p key={x} className="small" style={{ margin: 0 }}>{x}</p>)}
      <p className="label">General guidance from the TrainLuma food database, not medical or dietetic advice. Targets never go below 1,500 kcal (men) or 1,200 kcal (women), and never more than 750 kcal under your burn. Check big changes with a doctor or registered dietitian, especially with a health condition.</p>
    </div>
  );
}

