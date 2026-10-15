/**
 * The onboarding answers as one draft object, shared by the conversational interview and the
 * 9-step form. Both fill exactly the same fields, and the draft is saved on this device after
 * every change (WIZARD_DRAFT_KEY), so either path resumes where it was.
 */
import type { Goal, LocalProfile, PainArea, TrainingProfile } from '@shared/contracts';
import { allergyList } from './FoodChoices';

export const WIZARD_DRAFT_KEY = 'onboarding_draft';

export interface WizardState {
  step: number;
  goals: Goal[];
  days: number[];
  sessions: number;
  minutes: number;
  windows: TrainingProfile['time_windows'];
  rotating: boolean;
  experience: TrainingProfile['experience'] | null;
  routine: string;
  likes: string;
  recent: string;
  location: TrainingProfile['location'] | null;
  equipment: TrainingProfile['equipment'];
  avoid: string;
  restrictions: string;
  screening: TrainingProfile['screening'];
  foods: string[];
  pattern: LocalProfile['food_prefs']['pattern'];
  meatless: number[];
  allergies: string;
  energy: string;
  protein: string;
  height: string;
  inspiration: string;
  /** Phase 3 answers. `lifestyle` null = not answered yet. */
  lifestyle: TrainingProfile['lifestyle'] | null;
  painAreas: PainArea[];
  painNote: string;
  direction: TrainingProfile['goal_direction'];
  sleep: TrainingProfile['sleep_pattern'];
  /** 'interview' = chat with the trainer (default for new onboarding); 'form' = the step-by-step form. */
  mode: 'interview' | 'form';
  /** Interview questions already answered or skipped (never asked again). */
  done: string[];
  /** The conversation so far, so it can be shown again after a reload. */
  log: { q: string; text: string; a: string; reply?: string }[];
}

export function initialWizard(p: LocalProfile): WizardState {
  const t = p.training;
  return {
    step: 1,
    goals: t?.goal_priorities ?? [p.goal],
    days: t?.days_available ?? [],
    sessions: t?.sessions_per_week ?? 3,
    minutes: t?.minutes_per_session ?? 45,
    windows: t?.time_windows ?? [],
    rotating: t?.rotating_schedule ?? false,
    experience: t?.experience ?? null,
    routine: t?.current_routine ?? '',
    likes: t?.exercise_likes ?? '',
    recent: t?.recent_performance ?? '',
    location: t?.location ?? null,
    equipment: t?.equipment ?? [],
    avoid: t?.avoid_exercises ?? '',
    restrictions: t?.restrictions ?? '',
    screening: t?.screening ?? 'not_answered',
    foods: [],
    pattern: p.food_prefs.pattern,
    meatless: p.food_prefs.meatless_weekdays,
    allergies: p.food_prefs.allergies.join(', '),
    energy: p.targets?.energy_kcal ? String(p.targets.energy_kcal) : '',
    protein: p.targets?.protein_g ? String(p.targets.protein_g) : '',
    height: p.height_cm ? String(p.height_cm) : '',
    inspiration: t?.inspiration_note ?? '',
    lifestyle: t ? t.lifestyle ?? 'standard' : null,
    painAreas: t?.pain_areas ?? [],
    painNote: t?.pain_note ?? '',
    direction: t?.goal_direction ?? null,
    sleep: t?.sleep_pattern ?? null,
    mode: 'interview',
    done: [],
    log: [],
  };
}

/** A saved draft from before Phase 3 (no `mode`) that had moved past step 1 continues as the form. */
export function resumeWizard(p: LocalProfile, saved: Partial<WizardState> | undefined | null): WizardState {
  const base = initialWizard(p);
  if (!saved) return base;
  const mode = saved.mode ?? ((saved.step ?? 1) > 1 ? 'form' : 'interview');
  return { ...base, ...saved, mode };
}

/** The profile these answers produce. Changing planning answers bumps the profile version. */
export function profileFromWizard(p: LocalProfile, w: WizardState, now: string): LocalProfile {
  const trucker = w.lifestyle === 'trucker';
  const training: TrainingProfile = {
    goal_priorities: w.goals.length ? w.goals : [p.goal],
    days_available: w.rotating ? [] : [...w.days].sort(),
    sessions_per_week: w.sessions,
    minutes_per_session: w.minutes,
    time_windows: w.windows,
    rotating_schedule: w.rotating,
    experience: w.experience ?? 'new',
    current_routine: w.routine.trim().slice(0, 400),
    exercise_likes: w.likes.trim().slice(0, 300),
    recent_performance: w.recent.trim().slice(0, 400),
    location: w.location ?? (trucker ? 'truck' : 'gym'),
    equipment: w.equipment,
    avoid_exercises: w.avoid.trim().slice(0, 300),
    restrictions: w.restrictions.trim().slice(0, 400),
    screening: w.screening,
    inspiration_note: w.inspiration.trim().slice(0, 300),
    lifestyle: trucker ? 'trucker' : 'standard',
    pain_areas: [...new Set(w.painAreas)],
    pain_note: w.painNote.trim().slice(0, 300),
    goal_direction: w.direction,
    sleep_pattern: w.sleep,
    updated_at: now,
  };
  const e = Number(w.energy);
  const pr = Number(w.protein);
  const food_prefs = { ...p.food_prefs, pattern: w.pattern, meatless_weekdays: w.pattern === 'vegetarian' ? [] : w.meatless, allergies: allergyList(w.allergies) };
  const targets = w.energy.trim() || w.protein.trim()
    ? { energy_kcal: e > 0 ? e : null, protein_g: pr > 0 ? pr : null, source: p.targets?.source ?? 'Set by you' }
    : null;
  const withoutTime = (t: TrainingProfile | null) => (t ? JSON.stringify({ ...t, updated_at: '' }) : '');
  const changed = withoutTime(training) !== withoutTime(p.training) || JSON.stringify(food_prefs) !== JSON.stringify(p.food_prefs);
  return {
    ...p,
    goal: training.goal_priorities[0]!,
    training,
    food_prefs,
    targets,
    height_cm: Number(w.height) > 0 && Number(w.height) < 260 ? Number(w.height) : null,
    profile_version: changed ? p.profile_version + 1 : p.profile_version,
  };
}
