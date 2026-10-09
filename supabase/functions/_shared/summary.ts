/**
 * Deterministic, minimal context for the model, computed from the caller's own documents.
 * No names, emails, or other members' data. Metrics are calculated here — never by the model.
 * Free text from the journal (meal/exercise names) is passed as quoted data only.
 */

type Doc = Record<string, unknown>;
export interface DocRow { collection: string; doc_id: string; body: Doc; deleted: boolean }

export interface CoachContext {
  period: { from: string; to: string };
  units: 'kg' | 'lb';
  goal: string | null;
  targets: { energy_kcal: number | null; protein_g: number | null } | null;
  days: { ref: string; date: string; meals_logged: number; energy_kcal: number | null; protein_g: number | null; totals_complete: boolean; marked_complete: boolean }[];
  weights: { ref: string; count: number; points: { date: string; value: number; unit: string }[] };
  workouts: { ref: string; date: string; day_name: string; working_sets: number; skipped_sets: number; discomfort_flags: number; best_sets: { exercise: string; best: string }[] }[];
  steps: { ref: string; days_recorded: number; average: number | null; source: 'manual' };
  completeness: { days_with_meals: number; days_marked_complete: number; weight_points: number; sessions: number };
  confirmed_memory: string[];
  valid_refs: string[];
}

export function addDaysIso(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 60): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function buildContext(rows: readonly DocRow[], today: string, days: number, memory: readonly string[]): CoachContext {
  const from = addDaysIso(today, -(days - 1));
  const live = rows.filter((r) => !r.deleted && !(r.body.deleted_at));
  const inRange = (d: unknown) => typeof d === 'string' && d >= from && d <= today;
  const profile = (live.find((r) => r.collection === 'settings')?.body.profile ?? {}) as Doc;
  const units = profile.units === 'lb' ? 'lb' : 'kg';
  const targetsRaw = (profile.targets ?? null) as Doc | null;

  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(addDaysIso(from, i));

  const meals = live.filter((r) => r.collection === 'meal_entries' && inRange(r.body.local_date)).map((r) => r.body);
  const complete = new Set(live.filter((r) => r.collection === 'daily_log_status' && r.body.intake_complete === true && inRange(r.body.local_date)).map((r) => r.body.local_date as string));

  const dayRows = dates.map((date) => {
    const ms = meals.filter((m) => m.local_date === date);
    let energy: number | null = null;
    let protein: number | null = null;
    let allKnown = true;
    for (const m of ms) {
      for (const it of (m.items as Doc[] | undefined) ?? []) {
        const n = (it.nutrients ?? {}) as Doc;
        const c = (it.complete ?? {}) as Doc;
        const e = num(n.energy_kcal);
        const p = num(n.protein_g);
        if (e === null || c.energy_kcal === false) allKnown = false;
        if (e !== null) energy = (energy ?? 0) + e;
        if (p !== null) protein = (protein ?? 0) + p;
      }
    }
    return {
      ref: `day:${date}`,
      date,
      meals_logged: ms.length,
      energy_kcal: energy === null ? null : Math.round(energy),
      protein_g: protein === null ? null : Math.round(protein),
      totals_complete: ms.length > 0 && allKnown,
      marked_complete: complete.has(date),
    };
  });

  const weightFrom = addDaysIso(today, -27);
  const weights = live
    .filter((r) => r.collection === 'weight_entries' && typeof r.body.local_date === 'string' && (r.body.local_date as string) >= weightFrom && (r.body.local_date as string) <= today)
    .map((r) => ({ date: r.body.local_date as string, value: num(r.body.value) ?? 0, unit: str(r.body.unit, 2) }))
    .filter((w) => w.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sessions = live.filter((r) => r.collection === 'workout_sessions' && r.body.status === 'finished' && inRange(r.body.local_date));
  const workouts = sessions.map((r) => {
    const s = r.body;
    let working = 0;
    let skipped = 0;
    let discomfort = 0;
    const best_sets: { exercise: string; best: string }[] = [];
    for (const ex of (s.exercises as Doc[] | undefined) ?? []) {
      let best: Doc | null = null;
      for (const set of (ex.sets as Doc[] | undefined) ?? []) {
        if (set.status === 'skipped') skipped++;
        const a = set.actual as Doc | null;
        if (set.status === 'completed' && a) {
          if (a.discomfort) discomfort++;
          if (set.type === 'working') {
            working++;
            if (!best || (num(a.load) ?? 0) > (num(best.load) ?? 0)) best = a;
          }
        }
      }
      if (best) best_sets.push({ exercise: str(ex.name), best: `${num(best.load) ?? 0}${str(best.unit, 2)}×${num(best.reps) ?? 0}` });
    }
    return { ref: `session:${r.doc_id}`, date: s.local_date as string, day_name: str(s.day_name), working_sets: working, skipped_sets: skipped, discomfort_flags: discomfort, best_sets };
  }).sort((a, b) => a.date.localeCompare(b.date));

  const steps = live.filter((r) => r.collection === 'daily_health' && r.body.metric === 'steps' && inRange(r.body.local_date)).map((r) => num(r.body.value) ?? 0);

  const ctx: CoachContext = {
    period: { from, to: today },
    units,
    goal: typeof profile.goal === 'string' ? profile.goal : null,
    targets: targetsRaw ? { energy_kcal: num(targetsRaw.energy_kcal), protein_g: num(targetsRaw.protein_g) } : null,
    days: dayRows,
    weights: { ref: 'metric:weight', count: weights.length, points: weights },
    workouts,
    steps: { ref: 'metric:steps', days_recorded: steps.length, average: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null, source: 'manual' },
    completeness: {
      days_with_meals: dayRows.filter((d) => d.meals_logged > 0).length,
      days_marked_complete: dayRows.filter((d) => d.marked_complete).length,
      weight_points: weights.length,
      sessions: workouts.length,
    },
    confirmed_memory: memory.slice(0, 10).map((m) => m.slice(0, 200)),
    valid_refs: [],
  };
  ctx.valid_refs = [...dayRows.map((d) => d.ref), 'metric:weight', 'metric:steps', ...workouts.map((w) => w.ref)];
  return ctx;
}

export function hasEnoughForReview(ctx: CoachContext): boolean {
  return ctx.completeness.days_with_meals + ctx.completeness.sessions + ctx.completeness.weight_points >= 2;
}
