/**
 * Weekly adaptation (T6): from data the person already logged, propose exactly ONE change a week.
 * Deterministic code, no AI. Nothing changes until the person taps Accept (a new plan version, so
 * past workouts keep their plan) or saves it in the editor; "Not now" dismisses it for that week.
 * Tone follows D32: never "missed", never shaming.
 */
import type { DietPlan, LoadUnit, MealEntry, ProgramVersion, WorkoutSession } from '@shared/contracts';
import { addDays } from '@/domain/metrics/metrics';
import { totalsOfEntries } from '@/domain/nutrition/calc';
import { draftFrom, type PlanDraft } from '@/domain/training/plan';
import { sessionSummary } from '@/domain/training/session';
import type { DietDay, ShelfDish } from '../../../supabase/functions/_shared/diet';

export type ProposalKind = 'busy_version' | 'add_set' | 'protein_breakfast';

export interface Proposal {
  kind: ProposalKind;
  /** Monday of the current week (decisions are stored per week). */
  week: string;
  title: string;
  detail: string;
  /** The changed plan to commit as a new version (training proposals). */
  plan?: PlanDraft;
  /** The changed food-plan day (diet proposals). */
  diet?: DietDay;
}

export interface AdaptationInput {
  today: string;
  units: LoadUnit;
  program: ProgramVersion | null;
  /** When the first version of the current program was created (ISO). */
  programSince: string | null;
  sessions: readonly WorkoutSession[];
  meals: readonly MealEntry[];
  sessionsPerWeek: number | null;
  proteinTarget: number | null;
  dietPlan: DietPlan | null;
  /** The person's allowed food-database dishes (for a higher-protein breakfast swap). */
  allowedDishes?: readonly ShelfDish[];
  decisions: Record<string, string>;
}

/** Monday of the week containing `date` (local dates, YYYY-MM-DD). */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

const PRESS = new Set(['chest', 'shoulders']);

export function weeklyProposal(i: AdaptationInput): Proposal | null {
  const week = weekStart(i.today);
  if (i.decisions[week]) return null; // already decided this week
  const from = addDays(i.today, -7);
  const to = addDays(i.today, -1);
  const inWindow = (d: string) => d >= from && d <= to;

  // ---- training (adherence first, then progression) ----
  if (i.program) {
    const planned = i.sessionsPerWeek ?? (i.program.schedule === 'weekdays' ? i.program.days.filter((d) => d.weekday !== null).length : i.program.days.length);
    const finished = i.sessions.filter((s) => s.status === 'finished');
    const recent = finished.filter((s) => inWindow(s.local_date));
    const established = i.programSince !== null && i.programSince.slice(0, 10) <= from;

    if (established && planned >= 3 && i.program.days.length >= 3 && recent.length <= planned - 2) {
      const d = draftFrom(i.program);
      return {
        kind: 'busy_version', week,
        title: 'Busy week? Want a 2-day version for weeks like this?',
        detail: `${recent.length} of ${planned} workouts this week. Life gets full; a shorter plan keeps the habit going. Your current plan stays saved as an earlier version.`,
        plan: { ...d, name: `${d.name.replace(/ \(2-day\)$/, '')} (2-day)`.slice(0, 60), schedule: 'rotation', days: d.days.slice(0, 2).map((x) => ({ ...x, weekday: null })) },
      };
    }

    if (planned >= 1 && recent.length >= planned) {
      const sets = recent.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => x.type === 'working' && x.status === 'completed' && x.actual)));
      const discomfort = sets.some((x) => x.actual!.discomfort);
      const rirs = sets.map((x) => x.actual!.rir).filter((r): r is number => r !== null);
      const avgRir = rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null;
      const topOfRange = sets.length ? sets.filter((x) => x.actual!.reps >= x.planned.rep_max).length / sets.length : 0;
      const prs = recent.filter((s) => sessionSummary(s, finished, i.units).comparisons.some((c) => c.change === 'heavier' || c.change === 'more_reps')).length;
      const recovering = !discomfort && sets.length > 0 && ((avgRir !== null && avgRir >= 2) || (avgRir === null && topOfRange >= 0.8) || prs >= 2);
      if (recovering) {
        const d = draftFrom(i.program);
        const pressing = d.days.some((day) => day.exercises.some((e) => PRESS.has(e.muscle_group)));
        const days = d.days.map((day) => ({
          ...day,
          exercises: day.exercises.map((e, idx) => {
            const target = pressing ? PRESS.has(e.muscle_group) : idx === 0;
            const working = e.sets.filter((s) => s.type === 'working');
            if (!target || !working.length || working.length >= 5) return e;
            return { ...e, sets: [...e.sets, { ...working[working.length - 1]! }] };
          }),
        }));
        return {
          kind: 'add_set', week,
          title: `You’re recovering well — add a set to ${pressing ? 'pressing movements' : 'your first exercise each day'}?`,
          detail: `All ${planned} workout${planned === 1 ? '' : 's'} done this week${avgRir !== null ? ` with about ${Math.round(avgRir)} reps to spare` : ''}${prs ? `, and ${prs} session${prs === 1 ? '' : 's'} with a new best` : ''}. One extra set is a small, steady step.`,
          plan: { ...d, days },
        };
      }
    }
  }

  // ---- food (protein vs target on days with complete logs) ----
  if (i.dietPlan && i.proteinTarget && i.allowedDishes?.length) {
    const byDay = new Map<string, MealEntry[]>();
    for (const m of i.meals) if (inWindow(m.local_date) && m.deleted_at === null) byDay.set(m.local_date, [...(byDay.get(m.local_date) ?? []), m]);
    const days = [...byDay.values()].map((entries) => totalsOfEntries(entries).protein_g.value).filter((v): v is number => v !== null);
    const under = days.filter((v) => v < i.proteinTarget! * 0.9).length;
    if (days.length >= 5 && under >= 5) {
      const swap = higherProteinBreakfast(i.dietPlan, i.allowedDishes);
      if (swap) {
        return {
          kind: 'protein_breakfast', week,
          title: `Protein has been under target ${under} of 7 days — swap in a higher-protein breakfast?`,
          detail: `Adds ${swap.name} to breakfast in your food plan. Your calorie target stays the same.`,
          diet: swap.day,
        };
      }
    }
  }
  return null;
}

function higherProteinBreakfast(plan: DietPlan, allowed: readonly ShelfDish[]): { day: DietDay; name: string } | null {
  const breakfast = plan.meals.find((m) => m.slot === 'breakfast');
  const inBreakfast = new Set(breakfast?.items.map((x) => x.dish_id) ?? []);
  const pick = allowed
    .filter((d) => ['breakfast', 'dairy', 'breads'].includes(d.category) && !inBreakfast.has(d.id))
    .sort((a, b) => b.protein_g / b.kcal - a.protein_g / a.kcal || a.id.localeCompare(b.id))[0];
  if (!pick) return null;
  const byId = new Map(allowed.map((d) => [d.id, d]));
  const items = [...(breakfast?.items ?? [])];
  // Trade the lowest-protein breakfast serving for the new item, keeping calories about level.
  const low = items.filter((x) => x.servings >= 1).sort((a, b) => {
    const da = byId.get(a.dish_id);
    const db = byId.get(b.dish_id);
    return (da ? da.protein_g / da.kcal : 0) - (db ? db.protein_g / db.kcal : 0);
  })[0];
  const next = items.map((x) => (x === low ? { ...x, servings: x.servings - 0.5 } : x)).filter((x) => x.servings >= 0.5);
  next.push({ dish_id: pick.id, servings: 1 });
  const meals = breakfast ? plan.meals.map((m) => (m.slot === 'breakfast' ? { ...m, items: next.slice(0, 6) } : m)) : [{ slot: 'breakfast' as const, items: next }, ...plan.meals];
  return { day: { meals }, name: pick.name };
}
