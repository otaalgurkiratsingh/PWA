/**
 * The trainer interview: a scripted, deterministic conversation (no AI calls, so it costs nothing,
 * works offline and in the demo). One question at a time; every answer writes the same fields the
 * form writes. Answered or skipped questions are never asked again.
 *
 * Essentials only (the rest is asked gently during week 1): lifestyle, goal, days, minutes,
 * where/equipment, experience — plus, because safety comes first, body areas that bother the person,
 * the official pre-exercise questionnaire, and the privacy choice needed for an AI draft.
 */
import { PAIN_AREAS, type Goal, type PainArea, type TrainingProfile } from '@shared/contracts';
import { WEEKDAY_SHORT } from '@/domain/training/plan';
import { urgentSafetyMessage } from '../../../supabase/functions/_shared/prompts';
import type { WizardState } from './wizardState';

export type ChipKind = 'single' | 'multi' | 'text' | 'privacy';
export interface Chip { value: string; label: string }
export interface Question {
  id: string;
  kind: ChipKind;
  text: (ctx: { name: string; trainer: string; w: WizardState; first: boolean }) => string;
  chips: (w: WizardState) => Chip[];
  /** Multi-select: what is selected now (for aria-pressed). */
  selected?: (w: WizardState) => string[];
  /** Apply an answer. `values` holds the chip value(s) or the typed text. */
  apply: (w: WizardState, values: string[]) => Partial<WizardState>;
  /** Shown only when this returns true (e.g. the pain note after the pain chips). */
  when?: (w: WizardState) => boolean;
  /** An optional reply from the trainer after the answer (plain, warm, never medical). */
  reply?: (w: WizardState) => string | null;
  placeholder?: string;
}

export const GOAL_CHIPS: { value: Goal; label: string }[] = [
  { value: 'fat_loss', label: 'Lose fat' },
  { value: 'strength', label: 'Get stronger' },
  { value: 'muscle_gain', label: 'Build muscle' },
  { value: 'consistency', label: 'Be consistent' },
  { value: 'maintenance', label: 'General fitness' },
];

export const PAIN_LABEL: Record<PainArea, string> = {
  lower_back: 'Lower back', knees: 'Knees', shoulders: 'Shoulders', neck: 'Neck', hips: 'Hips', wrists_ankles: 'Wrists / ankles',
};

export const LOCATION_LABEL: Record<TrainingProfile['location'], string> = {
  truck: 'Truck cab / rest stop', gym: 'Gym', home: 'Home', both: 'Gym and home',
};

const EQUIP: { value: TrainingProfile['equipment'][number]; label: string }[] = [
  { value: 'dumbbell', label: 'Dumbbells' }, { value: 'band', label: 'Bands' }, { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'barbell', label: 'Barbell' }, { value: 'machine', label: 'Machines' }, { value: 'cable', label: 'Cables' },
];

const trucker = (w: WizardState) => w.lifestyle === 'trucker';

export const PAIN_DISCLAIMER = 'I’m not a physio or doctor — if pain is sharp, getting worse, or comes with numbness or tingling, please get it checked first.';

export const QUESTIONS: readonly Question[] = [
  {
    id: 'lifestyle',
    kind: 'single',
    text: ({ name, trainer, first }) => `${first ? `Hi ${name}! I’m ${trainer}, your trainer. A few quick questions so your plan fits your real life. Skip anything you like.\n\n` : ''}First: what does a normal week look like for you?`,
    chips: () => [
      { value: 'trucker', label: 'I drive long-haul / I’m on the road most days' },
      { value: 'standard', label: 'A regular schedule' },
      { value: 'shift', label: 'Shift work — it changes' },
    ],
    apply: (w, [v]) => (v === 'trucker'
      // Cab-friendly defaults; the next questions still let the person change every one of them.
      ? { lifestyle: 'trucker', rotating: true, days: [], sessions: Math.min(w.sessions, 3), minutes: 30, location: w.location ?? 'truck', equipment: w.equipment.length ? w.equipment : ['dumbbell', 'band'] }
      : { lifestyle: 'standard', rotating: v === 'shift' }),
    reply: (w) => (trucker(w) ? 'Got it. We’ll build around the cab and rest stops: short sessions, no gym needed.' : null),
  },
  {
    id: 'goal',
    kind: 'single',
    text: () => 'What matters most to you right now?',
    chips: () => GOAL_CHIPS,
    apply: (_w, [v]) => ({ goals: [v as Goal] }),
  },
  {
    id: 'days',
    kind: 'single',
    when: (w) => trucker(w) || w.rotating,
    text: ({ w }) => (trucker(w) ? 'How many days a week could you fit a short workout — even 20 minutes at a rest stop?' : 'How many workouts a week feels realistic?'),
    chips: (w) => (trucker(w) ? ['1', '2', '3', '4'] : ['1', '2', '3', '4', '5', '6']).map((v) => ({ value: v, label: v === '4' && trucker(w) ? '4 or more' : v })),
    apply: (_w, [v]) => ({ sessions: Number(v), rotating: true, days: [] }),
  },
  {
    id: 'weekdays',
    kind: 'multi',
    when: (w) => !trucker(w) && !w.rotating,
    text: () => 'Which days can you usually train? Pick all that work.',
    chips: () => WEEKDAY_SHORT.map((d, i) => ({ value: String(i), label: d })),
    selected: (w) => w.days.map(String),
    apply: (_w, values) => {
      const days = [...new Set(values.map(Number))].sort();
      return { days, sessions: Math.max(1, Math.min(6, days.length)) };
    },
  },
  {
    id: 'minutes',
    kind: 'single',
    text: () => 'How long can each workout be?',
    chips: (w) => (trucker(w) ? [{ value: '20', label: '20 min' }, { value: '30', label: '30 min' }, { value: '45', label: '45 min' }] : [20, 30, 45, 60, 75, 90].map((m) => ({ value: String(m), label: `${m} min` }))),
    apply: (_w, [v]) => ({ minutes: Number(v) }),
  },
  {
    id: 'place',
    kind: 'single',
    text: () => 'Where will you train?',
    chips: (w) => {
      const order: TrainingProfile['location'][] = trucker(w) ? ['truck', 'gym', 'home', 'both'] : ['gym', 'home', 'both', 'truck'];
      return order.map((v) => ({ value: v, label: LOCATION_LABEL[v] }));
    },
    apply: (_w, [v]) => ({ location: v as TrainingProfile['location'] }),
  },
  {
    id: 'equipment',
    kind: 'multi',
    text: ({ w }) => (w.location === 'truck' || w.location === 'home'
      ? 'What do you have with you? Bodyweight always counts. A pair of adjustable dumbbells and a band go a long way.'
      : 'What equipment can you use? Bodyweight always counts.'),
    chips: () => EQUIP,
    selected: (w) => w.equipment,
    apply: (_w, values) => ({ equipment: values as TrainingProfile['equipment'] }),
  },
  {
    id: 'experience',
    kind: 'single',
    text: () => 'How much training have you done before?',
    chips: () => [
      { value: 'new', label: 'New to training' },
      { value: 'returning', label: 'Coming back after a break' },
      { value: 'regular', label: 'Training regularly' },
    ],
    apply: (_w, [v]) => ({ experience: v as TrainingProfile['experience'] }),
  },
  {
    id: 'pain',
    kind: 'multi',
    text: () => 'Anything bothering you — back, knees, shoulders, neck, hips, wrists or ankles? Pick any, or none.',
    chips: () => PAIN_AREAS.map((a) => ({ value: a, label: PAIN_LABEL[a] })),
    selected: (w) => w.painAreas,
    apply: (_w, values) => ({ painAreas: values.filter((v): v is PainArea => (PAIN_AREAS as readonly string[]).includes(v)) }),
    reply: (w) => (w.painAreas.length
      ? `Thanks for telling me. I’ll leave out moves that load your ${w.painAreas.map((a) => PAIN_LABEL[a].toLowerCase()).join(' and ')} and add gentle ones that build the muscles around ${w.painAreas.length > 1 ? 'them' : 'it'}. ${PAIN_DISCLAIMER}`
      : null),
  },
  {
    id: 'pain_note',
    kind: 'text',
    text: () => 'Anything hurting right now, or any injury I should work around? (optional)',
    chips: () => [],
    placeholder: 'e.g. lower back stiff after long drives',
    apply: (_w, [v]) => ({ painNote: (v ?? '').trim().slice(0, 300) }),
    // Urgent symptoms get the same safety reply as chat; nothing here diagnoses.
    reply: (w) => (w.painNote ? urgentSafetyMessage(w.painNote) ?? 'Noted. I’ll keep that in mind and keep things gentle around it.' : null),
  },
  {
    id: 'screening',
    kind: 'single',
    text: () => 'One safety step before any plan: please read the Canadian Society for Exercise Physiology’s Get Active Questionnaire (link below). How did it go?',
    chips: () => [
      { value: 'no_concerns', label: 'I read it and nothing applied to me' },
      { value: 'has_concerns', label: 'Something applied to me' },
      { value: 'not_answered', label: 'I’ll read it later' },
    ],
    apply: (_w, [v]) => ({ screening: v as TrainingProfile['screening'] }),
    reply: (w) => (w.screening === 'has_concerns'
      ? 'Thanks for checking. Please talk to a doctor or a qualified exercise professional before starting a new routine. I can’t give medical clearance, but you can keep logging meals and workouts, and plan with their advice later.'
      : null),
  },
  {
    id: 'privacy',
    kind: 'privacy',
    text: () => 'Last one: should I back up your journal privately and draft your plan with AI help? Your name and email are never sent to AI.',
    chips: () => [
      { value: 'backup_ai', label: 'Yes — back up and use AI help' },
      { value: 'backup', label: 'Back up only' },
      { value: 'local', label: 'Keep it on this phone only' },
    ],
    apply: () => ({}),
  },
];

/** Questions still to ask, in order (answered/skipped ones and ones that don't apply are left out). */
export function remainingQuestions(w: WizardState): Question[] {
  return QUESTIONS.filter((q) => !w.done.includes(q.id) && (!q.when || q.when(w)));
}

/** "A few more questions — about 2 min" style progress. */
export function progressText(w: WizardState): string {
  const n = remainingQuestions(w).length;
  if (n === 0) return 'All done';
  if (w.done.length === 0) return 'A few more questions — about 2 min';
  const min = Math.max(1, Math.round((n * 12) / 60));
  return `${n} more question${n === 1 ? '' : 's'} — about ${min} min`;
}

/** Record an answer (or a skip) and keep the transcript. */
export function answer(w: WizardState, q: Question, values: string[] | null, ctx: { name: string; trainer: string }): WizardState {
  const text = q.text({ ...ctx, w, first: w.done.length === 0 });
  const patch = values ? q.apply(w, values) : {};
  const label = values === null ? 'Skip for now'
    : q.kind === 'text' ? (values[0]?.trim() || 'Nothing to add')
      : values.length === 0 ? 'None of these'
        : values.map((v) => q.chips(w).find((c) => c.value === v)?.label ?? v).join(', ');
  const next = { ...w, ...patch };
  const reply = values ? q.reply?.(next) ?? undefined : undefined;
  return { ...next, done: [...w.done, q.id], log: [...w.log, { q: q.id, text, a: label, ...(reply ? { reply } : {}) }].slice(-30) };
}
