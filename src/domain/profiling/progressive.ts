/**
 * Progressive profiling (week 1): instead of an interrogation wall at signup, the trainer asks at
 * most ONE gentle question per local day, only while the app is open (never a notification), for
 * the first 7 days after onboarding. Every question is skippable; the plan works without answers
 * (safe defaults). Asked/answered/skipped state lives in `profile.profiling`.
 */
import type { LocalProfile } from '@shared/contracts';

export type ProfilingKey = 'diet' | 'cuisine' | 'body' | 'age_sex' | 'timeline' | 'sleep' | 'direction';
export const PROFILING_ORDER: readonly ProfilingKey[] = ['diet', 'cuisine', 'body', 'age_sex', 'timeline', 'sleep', 'direction'];
export const PROFILING_DAYS = 7;

const dayIndex = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / 864e5);

export function isAnswered(p: LocalProfile, k: ProfilingKey): boolean {
  switch (k) {
    case 'diet': return p.food_prefs.pattern !== 'unspecified';
    case 'cuisine': return p.food_prefs.cuisine !== 'unspecified';
    case 'body': return p.body.weight_kg !== null && p.height_cm !== null;
    case 'age_sex': return p.body.age_years !== null && p.body.sex !== null;
    case 'timeline': return p.body.goal_weight_kg !== null || p.body.no_timeline;
    case 'sleep': return p.training?.sleep_pattern != null;
    case 'direction': return p.training?.goal_direction != null;
  }
}

/** Today's one question, or null (not started, past day 7, already asked today, or nothing left). */
export function nextProfilingQuestion(p: LocalProfile, today: string): ProfilingKey | null {
  const start = p.profiling.started_on;
  if (!start) return null;
  const age = dayIndex(today) - dayIndex(start);
  if (age < 0 || age >= PROFILING_DAYS) return null;
  if (Object.values(p.profiling.asked).includes(today)) return null;
  for (const k of PROFILING_ORDER) {
    if ((k === 'sleep' || k === 'direction') && !p.training) continue;
    if (k in p.profiling.asked || p.profiling.skipped.includes(k) || isAnswered(p, k)) continue;
    return k;
  }
  return null;
}

/** Record that today's question was answered (or skipped): no more questions until tomorrow. */
export function markAsked(p: LocalProfile, k: ProfilingKey, today: string, skipped = false): LocalProfile['profiling'] {
  return {
    ...p.profiling,
    asked: { ...p.profiling.asked, [k]: today },
    skipped: skipped ? [...new Set([...p.profiling.skipped, k])] : p.profiling.skipped,
  };
}

/** Changes to training or food choices bump the profile version (pending drafts must be regenerated). */
export function withAnswers(p: LocalProfile, patch: Partial<Pick<LocalProfile, 'food_prefs' | 'body' | 'height_cm' | 'training'>>): LocalProfile {
  const planning = (patch.training && JSON.stringify(patch.training) !== JSON.stringify(p.training))
    || (patch.food_prefs && JSON.stringify(patch.food_prefs) !== JSON.stringify(p.food_prefs));
  return { ...p, ...patch, profile_version: planning ? p.profile_version + 1 : p.profile_version };
}
