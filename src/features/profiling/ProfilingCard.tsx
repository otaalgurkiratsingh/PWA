/**
 * Week-1 gentle questions from the trainer (progressive profiling). One a day at most, only while
 * the app is open, always skippable, never a notification. The same question widgets are reused by
 * the food-plan screen when the person asks for a plan and something is still missing.
 */
import { useState } from 'react';
import type { FoodPreferences, LocalProfile, TrainingProfile } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { Icon } from '@/core/design/icons';
import { CoachLine } from '@/features/coach/ChatBits';
import { useTrainer } from '@/features/coach/Trainer';
import { KG_PER_LB } from '@/domain/training/session';
import { markAsked, nextProfilingQuestion, withAnswers, type ProfilingKey } from '@/domain/profiling/progressive';
import { timelineCheck } from '../../../supabase/functions/_shared/diet';

const toKg = (v: number, unit: 'kg' | 'lb') => Math.round((unit === 'lb' ? v * KG_PER_LB : v) * 10) / 10;
const fromKg = (kg: number | null, unit: 'kg' | 'lb') => (kg === null ? '' : String(Math.round((unit === 'lb' ? kg / KG_PER_LB : kg) * 10) / 10));

export const QUESTION_TEXT: Record<ProfilingKey, string> = {
  diet: 'Quick one about food: do you eat veg, egg, or non-veg? It shapes the meals and protein ideas I suggest.',
  cuisine: 'What do you mostly eat day to day?',
  body: 'What do you weigh right now, and how tall are you? It lets me work out a sensible food target. You can skip it.',
  age_sex: 'Your age, and female or male for the calorie formula? “Prefer not to say” works too.',
  timeline: 'Do you have a goal weight and a timeframe in mind? No pressure: “no target” is a fine answer.',
  sleep: 'How’s your sleep usually? It only changes my recovery tips.',
  direction: 'What direction appeals to you most? It only shapes the style of your plan.',
};

/** The answer controls for one question. The parent saves the answered profile (plus an optional trainer reply). */
export function ProfilingQuestion({ k, onAnswer }: { k: ProfilingKey; onAnswer: (next: LocalProfile, reply: string | null) => Promise<void> }) {
  const { profile } = useJournal();
  const unit = profile.units;
  const [weight, setWeight] = useState(fromKg(profile.body.weight_kg, unit));
  const [height, setHeight] = useState(profile.height_cm ? String(profile.height_cm) : '');
  const [age, setAge] = useState(profile.body.age_years ? String(profile.body.age_years) : '');
  const [sex, setSex] = useState<LocalProfile['body']['sex']>(profile.body.sex);
  const [goal, setGoal] = useState(fromKg(profile.body.goal_weight_kg, unit));
  const [weeks, setWeeks] = useState(profile.body.goal_weeks ? String(profile.body.goal_weeks) : '');
  const [busy, setBusy] = useState(false);

  const save = async (next: LocalProfile, reply: string | null = null) => {
    setBusy(true);
    await onAnswer(next, reply).finally(() => setBusy(false));
  };
  const setTraining = (patch: Partial<TrainingProfile>) => (profile.training ? withAnswers(profile, { training: { ...profile.training, ...patch } }) : profile);
  const setFood = (patch: Partial<FoodPreferences>) => withAnswers(profile, { food_prefs: { ...profile.food_prefs, ...patch } });
  const chips = (opts: { label: string; run: () => void }[], label: string) => (
    <div className="chips wrap" role="group" aria-label={label}>
      {opts.map((o) => <button key={o.label} className="chip" disabled={busy} onClick={o.run}>{o.label}</button>)}
    </div>
  );

  switch (k) {
    case 'diet':
      return chips([
        { label: 'Veg', run: () => void save(setFood({ pattern: 'vegetarian', meatless_weekdays: [] })) },
        { label: 'Veg + eggs', run: () => void save(setFood({ pattern: 'eggetarian' })) },
        { label: 'Non-veg', run: () => void save(setFood({ pattern: 'everything' })) },
        { label: 'Prefer not to say', run: () => void save(profile) },
      ], 'What you eat');
    case 'cuisine':
      return chips([
        { label: 'Punjabi / North Indian home food', run: () => void save(setFood({ cuisine: 'punjabi_home' })) },
        { label: 'Mixed Indian + Canadian', run: () => void save(setFood({ cuisine: 'mixed' })) },
        { label: 'Mostly Western', run: () => void save(setFood({ cuisine: 'western' })) },
        { label: 'Prefer not to say', run: () => void save(profile) },
      ], 'What you mostly eat');
    case 'sleep': {
      const shiftFirst = profile.training?.lifestyle === 'trucker';
      const opts = [
        { label: 'Regular', run: () => void save(setTraining({ sleep_pattern: 'regular' })) },
        { label: 'All over the place', run: () => void save(setTraining({ sleep_pattern: 'irregular' }), 'Thanks. On short-sleep days, keep the workout but drop a set; recovery counts as much as the session.') },
        { label: shiftFirst ? 'Shift-driven (common on the road)' : 'Shift-driven', run: () => void save(setTraining({ sleep_pattern: 'shift' }), 'Thanks. Train after your longest sleep when you can, and keep sessions short on rough nights.') },
      ];
      return chips(shiftFirst ? [opts[2]!, opts[0]!, opts[1]!] : opts, 'Your sleep');
    }
    case 'direction':
      return chips([
        { label: 'Lean', run: () => void save(setTraining({ goal_direction: 'lean' })) },
        { label: 'Athletic', run: () => void save(setTraining({ goal_direction: 'athletic' })) },
        { label: 'Strong', run: () => void save(setTraining({ goal_direction: 'strong' })) },
        { label: 'Not sure', run: () => void save(profile) },
      ], 'Direction');
    case 'body': {
      const w = Number(weight);
      const h = Number(height);
      const ok = w > 0 && h >= 100 && h <= 250;
      return (
        <div className="stack-sm">
          <div className="metrics">
            <label className="field">Weight ({unit})<input className="input num" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
            <label className="field">Height (cm)<input className="input num" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!ok || busy}
            onClick={() => void save({ ...profile, height_cm: Math.round(h), body: { ...profile.body, weight_kg: Math.min(350, Math.max(30, toKg(w, unit))) } })}>Save</button>
        </div>
      );
    }
    case 'age_sex': {
      const a = Number(age);
      const ok = Number.isInteger(a) && a >= 18 && a <= 100 && sex !== null;
      return (
        <div className="stack-sm">
          <label className="field">Age<input className="input num" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></label>
          <div className="chips wrap" role="group" aria-label="For the calorie formula">
            {([['female', 'Female'], ['male', 'Male'], ['unspecified', 'Prefer not to say']] as const).map(([v, l]) => (
              <button key={v} className="chip" aria-pressed={sex === v} onClick={() => setSex(v)}>{l}</button>
            ))}
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!ok || busy} onClick={() => void save({ ...profile, body: { ...profile.body, age_years: a, sex } })}>Save</button>
        </div>
      );
    }
    case 'timeline': {
      const g = Number(goal);
      const wk = Number(weeks);
      const ok = g > 0 && Number.isInteger(wk) && wk >= 1 && wk <= 104;
      const submit = () => {
        const goalKg = Math.min(350, Math.max(30, toKg(g, unit)));
        let body = { ...profile.body, goal_weight_kg: goalKg, goal_weeks: wk, no_timeline: false };
        let reply: string | null = null;
        // The kind reality check is shown ONCE, ever; after that it is never repeated.
        if (profile.body.weight_kg && !profile.body.timeline_checked) {
          const c = timelineCheck(profile.body.weight_kg, goalKg, wk);
          if (c.unsafe) {
            reply = c.message;
            body = { ...body, timeline_checked: true };
          }
        }
        void save({ ...profile, body }, reply);
      };
      return (
        <div className="stack-sm">
          <div className="metrics">
            <label className="field">Goal weight ({unit})<input className="input num" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
            <label className="field">In how many weeks?<input className="input num" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} /></label>
          </div>
          <div className="row">
            <button className="btn sm" disabled={!ok || busy} onClick={submit}>Save</button>
            <button className="btn sm secondary" disabled={busy} onClick={() => void save({ ...profile, body: { ...profile.body, no_timeline: true } })}>No target</button>
          </div>
        </div>
      );
    }
  }
}

/** Today's gentle question (account members, week 1 only). */
export function ProfilingCard() {
  const { profile, today, updateProfile, mode } = useJournal();
  const trainer = useTrainer();
  const [reply, setReply] = useState<string | null>(null);
  const k = mode === 'account' ? nextProfilingQuestion(profile, today) : null;
  if (reply) {
    return (
      <div className="card coach stack-sm" role="region" aria-label={`A note from ${trainer.name}`}>
        <CoachLine avatar={trainer.avatar}><div className="bubble coach">{reply}</div></CoachLine>
        <button className="btn sm secondary" style={{ alignSelf: 'flex-end' }} onClick={() => setReply(null)}>Got it</button>
      </div>
    );
  }
  if (!k) return null;
  const skip = () => void updateProfile({ ...profile, profiling: markAsked(profile, k, today, true) });
  return (
    <div className="card coach stack-sm" role="region" aria-label={`A question from ${trainer.name}`}>
      <span className="eyebrow">{trainer.name} asks</span>
      <CoachLine avatar={trainer.avatar}><div className="bubble coach">{QUESTION_TEXT[k]}</div></CoachLine>
      <ProfilingQuestion k={k} onAnswer={async (saved, r) => {
        if (r) setReply(r);
        await updateProfile({ ...saved, profiling: markAsked(saved, k, today) });
      }} />
      <div className="row between">
        <span className="label">One question a day this week, at most.</span>
        <button className="link" onClick={skip}><Icon name="close" size={14} /> Skip for now</button>
      </div>
    </div>
  );
}
