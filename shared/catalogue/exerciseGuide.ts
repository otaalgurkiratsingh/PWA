/**
 * The big exercise library: ~820 exercises from free-exercise-db (public domain, Unlicense) plus a
 * few common moves it lacked, with how-to steps, level and muscles. Loaded only when someone opens
 * the exercise picker. The built-in catalogue (shared/fixtures/exerciseLibrary) stays the only
 * list AI plans may use; it gets the same how-to steps here.
 */
import { z } from 'zod';
import { EXERCISE_LIBRARY, exerciseId, type LibraryExercise } from '@shared/fixtures/exerciseLibrary';
import { canonicalTokens } from './catalogue';

const Equipment = z.enum(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band', 'other']);
const Muscle = z.enum(['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'full']);
const Extra = z.object({
  level: z.enum(['beginner', 'intermediate', 'expert']).optional(),
  instructions: z.array(z.string()).default([]),
  primary_muscles: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
});
const Entry = Extra.extend({
  key: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  equipment: Equipment,
  muscle_group: Muscle,
  load_convention: z.enum(['total', 'per_dumbbell', 'per_side', 'bodyweight']),
  unilateral: z.boolean(),
  measurement: z.enum(['weight_reps', 'reps', 'duration']),
  category: z.string().optional(),
  popular: z.boolean().default(false),
});
const GuideFile = z.object({
  source: z.object({ name: z.string(), url: z.string(), licence: z.string() }),
  builtin_extras: z.record(z.string(), Extra),
  exercises: z.array(Entry),
});

export interface GuideExercise extends LibraryExercise {
  level: 'beginner' | 'intermediate' | 'expert' | null;
  instructions: string[];
  primary_muscles: string[];
  aliases: string[];
  popular: boolean;
  builtin: boolean;
  /** Lower-cased search words of the name and aliases. */
  words: string[];
}

export function parseGuide(raw: unknown): GuideExercise[] {
  const f = GuideFile.parse(raw);
  const words = (x: { name: string; aliases: string[] }) => [x.name, ...x.aliases].flatMap((s) => canonicalTokens(s));
  const builtin = EXERCISE_LIBRARY.map((b) => {
    const e = f.builtin_extras[exerciseId(b)];
    const aliases = e?.aliases ?? [];
    return { ...b, level: e?.level ?? null, instructions: e?.instructions ?? [], primary_muscles: e?.primary_muscles ?? [], aliases, popular: true, builtin: true, words: words({ name: b.name, aliases }) };
  });
  const taken = new Set(builtin.map((b) => exerciseId(b)));
  const rest = f.exercises
    .filter((x) => !taken.has(`${x.key}:${x.equipment}`))
    .map((x) => ({
      key: x.key, name: x.name, equipment: x.equipment, muscle_group: x.muscle_group, load_convention: x.load_convention, unilateral: x.unilateral,
      measurement: x.measurement, level: x.level ?? null, instructions: x.instructions, primary_muscles: x.primary_muscles, aliases: x.aliases,
      popular: x.popular, builtin: false, words: words(x),
    }));
  return [...builtin, ...rest];
}

let loading: Promise<GuideExercise[]> | null = null;
export function loadGuide(): Promise<GuideExercise[]> {
  loading ??= import('../data/exercise-library-v1.json').then((m) => parseGuide((m as { default: unknown }).default));
  return loading;
}

/** Every query word must start a word of the name or an alias; popular and built-in first. */
export function searchGuide(all: readonly GuideExercise[], q: string, filter: { muscle?: string | null; equipment?: string | null } = {}): GuideExercise[] {
  const toks = canonicalTokens(q);
  const out = all.filter((x) =>
    (!filter.muscle || x.muscle_group === filter.muscle)
    && (!filter.equipment || x.equipment === filter.equipment)
    && toks.every((t) => x.words.some((w) => w.startsWith(t))));
  const rank = (x: GuideExercise) => (x.builtin ? 0 : x.popular ? 1 : 2) + (toks.length && canonicalTokens(x.name)[0]?.startsWith(toks[0]!) ? -0.5 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
