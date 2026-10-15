/**
 * This week's ONE suggested change (T6), on Today and in Coach → Weekly review. Accept saves a new
 * plan version (past workouts keep theirs) or updates the food plan; Edit opens the editor with the
 * change filled in (saving there is the approval); Not now dismisses it for this week.
 */
import { useJournal, useQuery } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { newId } from '@/core/ids';
import { addDays } from '@/domain/metrics/metrics';
import { weeklyProposal, type Proposal } from '@/domain/adaptation/weekly';
import { PLAN_SEED_KEY } from '@/domain/training/aiPlan';
import { commitPlan } from '@/domain/training/plan';
import { saveErrorMessage } from '@/features/food/useFood';
import { shelfFor } from '../../../supabase/functions/_shared/diet';
import { DIET_SEED_KEY, useShelf } from '@/features/diet/dietData';

export function useWeeklyProposal(): Proposal | null {
  const { profile, today } = useJournal();
  const shelf = useShelf();
  const data = useQuery(async (j) => {
    const programs = await j.db.getAll('programs');
    const program = await j.currentProgram();
    const since = program ? programs.filter((p) => p.program_id === program.program_id && !p.deleted_at).map((p) => p.created_at).sort()[0] ?? null : null;
    return { program, since, sessions: await j.sessions(), meals: await j.mealsBetween(addDays(today, -7), addDays(today, -1)) };
  }, [today]);
  if (!data) return null;
  return weeklyProposal({
    today, units: profile.units, program: data.program, programSince: data.since, sessions: data.sessions, meals: data.meals,
    sessionsPerWeek: profile.training?.sessions_per_week ?? null, proteinTarget: profile.targets?.protein_g ?? null, dietPlan: profile.diet_plan,
    allowedDishes: shelf ? shelfFor(shelf.dishes, profile.food_prefs) : undefined, decisions: profile.adaptation.decisions,
  });
}

export function AdaptationCard() {
  const { profile, updateProfile, journal, notify, refresh } = useJournal();
  const p = useWeeklyProposal();
  if (!p) return null;
  const decide = (d: 'accepted' | 'edited' | 'dismissed') =>
    updateProfile({ ...profile, adaptation: { decisions: { ...profile.adaptation.decisions, [p.week]: d } } });

  const accept = async () => {
    try {
      if (p.plan) {
        const current = await journal.currentProgram();
        await journal.commit('programs', commitPlan({ draft: p.plan, previous: current, ownerId: journal.ownerId, newId, now: new Date().toISOString(), synthetic: profile.synthetic }));
        await decide('accepted');
        refresh();
        notify({ kind: 'info', message: 'Plan updated. Past workouts keep the plan they were done with.' });
      } else if (p.diet && profile.diet_plan) {
        await updateProfile({ ...profile, diet_plan: { ...profile.diet_plan, meals: p.diet.meals, accepted_at: new Date().toISOString() }, adaptation: { decisions: { ...profile.adaptation.decisions, [p.week]: 'accepted' } } });
        notify({ kind: 'info', message: 'Food plan updated.' });
      }
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  const edit = async () => {
    try {
      if (p.plan) sessionStorage.setItem(PLAN_SEED_KEY, JSON.stringify({ draftId: '', plan: p.plan }));
      else if (p.diet) sessionStorage.setItem(DIET_SEED_KEY, JSON.stringify(p.diet));
    } catch {
      // the editor opens with the current plan instead
    }
    await decide('edited');
    navigate(p.plan ? 'plan' : 'diet');
  };

  return (
    <div className="card coach stack-sm" role="region" aria-label="This week’s suggestion" data-testid="adaptation">
      <span className="eyebrow">This week’s suggestion</span>
      <strong>{p.title}</strong>
      <p className="small" style={{ margin: 0 }}>{p.detail}</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => void accept()}><Icon name="check" size={16} /> Accept</button>
        <button className="btn sm secondary" onClick={() => void edit()}><Icon name="edit" size={16} /> Edit</button>
        <button className="btn sm ghost" onClick={() => void decide('dismissed')}>Not now</button>
      </div>
      <p className="label" style={{ margin: 0 }}>Worked out from your own logs by the app. Nothing changes unless you accept.</p>
    </div>
  );
}
