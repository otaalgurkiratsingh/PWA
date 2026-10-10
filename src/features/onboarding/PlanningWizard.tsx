/**
 * Onboarding after the basics (and the same planning questions later from Settings):
 * goal → week → experience → equipment & screening → usual foods → optional photos → privacy →
 * review & generate ONE draft plan. Progress is saved on this device after every change, so the
 * wizard resumes where it was. Nothing is sent to AI until the person asks for a draft.
 */
import { useEffect, useRef, useState } from 'react';
import type { Goal, LocalProfile, TrainingProfile } from '@shared/contracts';
import { EXERCISE_LIBRARY } from '@shared/fixtures/exerciseLibrary';
import { useJournal } from '@/app/JournalContext';
import { goBack, navigate } from '@/app/router';
import { useAuth } from '@/core/auth/AuthContext';
import { decideDraft } from '@/core/ai/coachData';
import { aiErrorText, type AiResponse, type CoachOutput, type StoredDraft } from '@/core/ai/client';
import { Icon, Mark } from '@/core/design/icons';
import { Segmented, Toggle } from '@/core/design/ui';
import { newId } from '@/core/ids';
import { listPhotos } from '@/core/photos/progressPhotos';
import { base64Of } from '@/core/ai/photo';
import { editorDraftFromAi, PLAN_SEED_KEY } from '@/domain/training/aiPlan';
import { WEEKDAY_SHORT, addDay, addExercise, commitPlan, draftFrom, plannedFromDefinition } from '@/domain/training/plan';
import { existingPresetFor, presetFromCatalogue } from '@/features/food/catalogueFood';
import { saveErrorMessage } from '@/features/food/useFood';
import { loadCatalogue } from '@shared/catalogue/catalogue';
import { PlanPreview } from '@/features/coach/DraftScreen';
import { requestPlanDraft } from '@/features/coach/planDraft';
import { PhotoGuidance, PhotoPermissions, PhotoSlots, type SessionPhoto } from '@/features/photos/PhotoSlots';
import { allergyList, FoodPrefsFields, UsualFoodsPicker } from './FoodChoices';

const GOALS: { value: Goal; label: string; sub: string }[] = [
  { value: 'consistency', label: 'Be consistent', sub: 'Show up and log regularly' },
  { value: 'fat_loss', label: 'Lose fat', sub: 'Gradually, without extremes' },
  { value: 'strength', label: 'Get stronger', sub: 'Lift a bit more over time' },
  { value: 'muscle_gain', label: 'Build muscle', sub: 'Train and eat for growth' },
  { value: 'maintenance', label: 'General fitness', sub: 'Feel fit and keep things steady' },
];
const MINUTES = [20, 30, 45, 60, 75, 90];
const WINDOWS: { value: TrainingProfile['time_windows'][number]; label: string }[] = [
  { value: 'early_morning', label: 'Early morning' }, { value: 'morning', label: 'Morning' }, { value: 'midday', label: 'Midday' },
  { value: 'evening', label: 'Evening' }, { value: 'night', label: 'Night' },
];
const EQUIP: { value: TrainingProfile['equipment'][number]; label: string }[] = [
  { value: 'dumbbell', label: 'Dumbbells' }, { value: 'barbell', label: 'Barbell' }, { value: 'machine', label: 'Machines' }, { value: 'cable', label: 'Cables' },
  { value: 'kettlebell', label: 'Kettlebell' }, { value: 'band', label: 'Bands' },
];
const CSEP_URL = 'https://store.csep.ca/pages/getactivequestionnaire';
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
  };
}

/** The profile these answers produce. Changing planning answers bumps the profile version. */
export function profileFromWizard(p: LocalProfile, w: WizardState, now: string): LocalProfile {
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
    location: w.location ?? 'gym',
    equipment: w.equipment,
    avoid_exercises: w.avoid.trim().slice(0, 300),
    restrictions: w.restrictions.trim().slice(0, 400),
    screening: w.screening,
    inspiration_note: w.inspiration.trim().slice(0, 300),
    updated_at: now,
  };
  const e = Number(w.energy);
  const pr = Number(w.protein);
  const food_prefs = { pattern: w.pattern, meatless_weekdays: w.pattern === 'vegetarian' ? [] : w.meatless, allergies: allergyList(w.allergies) };
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

const STEP_TITLES = ['', 'Your goal', 'Your week', 'Your experience', 'Your equipment', 'Your usual foods', 'Optional photos', 'Your privacy', 'Review and plan'];

export function PlanningWizard({ mode }: { mode: 'onboarding' | 'edit' }) {
  const { journal, profile, updateProfile, notify, today, syncNow, refresh } = useJournal();
  const { signOut } = useAuth();
  const [w, setW] = useState<WizardState | null>(null);
  const [session, setSession] = useState<SessionPhoto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ draft: StoredDraft | null; output: CoachOutput | null; error: string | null } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastStep = mode === 'onboarding' ? 8 : 4;

  // Resume a saved draft of the answers (device only), else start from the profile.
  useEffect(() => {
    let live = true;
    journal.getMeta<WizardState>(WIZARD_DRAFT_KEY).then((saved) => {
      if (!live) return;
      setW(mode === 'onboarding' && saved ? { ...initialWizard(profile), ...saved } : initialWizard(profile));
    }, () => live && setW(initialWizard(profile)));
    return () => {
      live = false;
    };
    // Only on open: later profile changes come from this wizard itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, mode]);

  useEffect(() => {
    if (!w || mode !== 'onboarding') return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void journal.setMeta(WIZARD_DRAFT_KEY, w).catch(() => undefined), 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [w, journal, mode]);

  if (!w) return <main className="welcome" aria-busy="true"><div className="skeleton" style={{ marginTop: 64 }} /></main>;
  const set = (patch: Partial<WizardState>) => setW({ ...w, ...patch });
  const step = Math.min(w.step, lastStep);

  const canNext = (() => {
    if (step === 1) return w.goals.length > 0;
    if (step === 2) return w.sessions > 0 && (w.rotating || w.days.length >= Math.min(w.sessions, 7));
    if (step === 3) return w.experience !== null;
    if (step === 4) return w.location !== null;
    return true;
  })();

  const saveAnswers = async (finish: boolean) => {
    const now = new Date().toISOString();
    const next = profileFromWizard(profile, w, now);
    await updateProfile({ ...next, onboarded_at: finish ? (profile.onboarded_at ?? now) : profile.onboarded_at });
    return next;
  };

  /** Create the chosen usual foods as the person's own meals (once each; never 293 copies). */
  const createFoods = async () => {
    if (!w.foods.length) return;
    const index = await loadCatalogue();
    const lib = await journal.library();
    const now = new Date().toISOString();
    for (const id of w.foods) {
      const food = index.byId.get(id);
      if (!food || existingPresetFor(index, lib.presets, id)) continue;
      const built = presetFromCatalogue({ food, seedVersion: index.seed_version, ownerId: journal.ownerId, now, newId, choice: { grams_per_unit: null, default_quantity: 1, favorite: true } });
      await journal.commit('foods', built.food);
      await journal.commit('presets', built.preset);
    }
  };

  const done = async (then?: () => void) => {
    await saveAnswers(true);
    await journal.setMeta(WIZARD_DRAFT_KEY, null).catch(() => undefined);
    refresh();
    then?.();
  };

  const generate = async () => {
    setBusy('generate');
    setResult(null);
    try {
      const saved = await saveAnswers(false);
      await createFoods();
      let photoIds: string[] = [];
      if (saved.consent.ai_images && saved.consent.photo_storage) {
        const stored = await listPhotos().catch(() => []);
        const latest = new Map<string, string>();
        for (const p of stored) if (!latest.has(p.slot)) latest.set(p.slot, p.id);
        photoIds = [...latest.values()].slice(0, 5);
      }
      // Unsaved photos are sent once, only with AI-image permission; they're never stored.
      const inline = saved.consent.ai_images ? session.slice(0, 5).map((p) => ({ slot: p.slot, image_base64: base64Of(p.dataUrl) })) : [];
      const res: AiResponse = await requestPlanDraft({ profile: saved, today, syncNow, source: 'onboarding', photoIds, inlinePhotos: inline });
      if (res.status === 'ok' && res.operation === 'onboarding_plan') setResult({ draft: res.draft, output: res.output, error: null });
      else setResult({ draft: null, output: null, error: aiErrorText(res) });
    } catch (e) {
      setResult({ draft: null, output: null, error: saveErrorMessage(e) });
    }
    setBusy(null);
  };

  const acceptDraft = async (d: StoredDraft) => {
    setBusy('accept');
    try {
      const r = await decideDraft(d.id, 'accepted', profile.profile_version);
      if (r.status !== 'accepted' || !r.plan) throw new Error(r.status === 'stale' ? 'Your answers changed after this draft. Generate it again.' : 'This draft was already decided.');
      const current = await journal.currentProgram();
      await journal.commit('programs', commitPlan({ draft: editorDraftFromAi(r.plan, profile.units, newId), previous: current, ownerId: journal.ownerId, newId, now: new Date().toISOString(), synthetic: false }));
      await done(() => navigate('workout'));
      notify({ kind: 'info', message: 'Plan accepted. You can change any part of it in Edit plan.' });
    } catch (e) {
      notify({ kind: 'error', message: (e as Error).message });
    }
    setBusy(null);
  };

  const editDraft = async (d: StoredDraft) => {
    try {
      sessionStorage.setItem(PLAN_SEED_KEY, JSON.stringify({ draftId: d.id, plan: editorDraftFromAi(d.plan, profile.units, newId) }));
    } catch {
      // the editor starts empty instead
    }
    await done(() => navigate('plan'));
  };

  const simplePlan = async () => {
    setBusy('simple');
    try {
      const wanted = [['Full body A', ['squat:barbell', 'bench_press:barbell', 'row:cable', 'plank:bodyweight']], ['Full body B', ['romanian_deadlift:barbell', 'overhead_press:dumbbell', 'lat_pulldown:cable', 'split_squat:dumbbell']]] as const;
      const home = [['Full body A', ['goblet_squat:dumbbell', 'push_up:bodyweight', 'one_arm_row:dumbbell', 'plank:bodyweight']], ['Full body B', ['romanian_deadlift:dumbbell', 'overhead_press:dumbbell', 'reverse_lunge:bodyweight', 'dead_bug:bodyweight']]] as const;
      let d = draftFrom(null);
      for (const [name, ids] of w.location === 'home' ? home : wanted) {
        d = addDay(d, name, newId);
        const day = d.days[d.days.length - 1]!;
        for (const id of ids) {
          const def = EXERCISE_LIBRARY.find((x) => `${x.key}:${x.equipment}` === id);
          if (def) d = addExercise(d, day.id, plannedFromDefinition(def, profile.units, newId));
        }
      }
      await journal.commit('programs', commitPlan({ draft: { ...d, name: 'My plan' }, previous: await journal.currentProgram(), ownerId: journal.ownerId, newId, now: new Date().toISOString(), synthetic: false }));
      await createFoods();
      await done(() => navigate('workout'));
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
    setBusy(null);
  };

  const finishWithout = async (then?: () => void) => {
    setBusy('finish');
    try {
      await createFoods();
      await done(then);
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
    setBusy(null);
  };

  const aiReady = profile.consent.ai_processing && profile.consent.cloud_backup;
  const online = navigator.onLine;

  const body = (() => {
    switch (step) {
      case 1:
        return (
          <>
            <h1>{STEP_TITLES[1]}</h1>
            <p className="muted">Tap the goals that matter, most important first. You can change this any time.</p>
            <div className="stack-sm">
              {GOALS.map((g) => {
                const rank = w.goals.indexOf(g.value);
                return (
                  <button key={g.value} className="choice" aria-pressed={rank >= 0} onClick={() => set({ goals: rank >= 0 ? w.goals.filter((x) => x !== g.value) : [...w.goals, g.value] })}>
                    <span className="rank-badge" aria-hidden="true">{rank >= 0 ? rank + 1 : ''}</span>
                    <span className="grow"><strong>{g.label}</strong><br /><span className="small muted">{g.sub}</span></span>
                  </button>
                );
              })}
            </div>
            {w.goals.length > 1 ? <p className="label">Most important: {GOALS.find((g) => g.value === w.goals[0])?.label}</p> : null}
          </>
        );
      case 2:
        return (
          <>
            <h1>{STEP_TITLES[2]}</h1>
            <Toggle label="My schedule changes (shift work)" description="The plan will follow the order of days instead of fixed weekdays." checked={w.rotating} onChange={(v) => set({ rotating: v })} />
            {!w.rotating ? (
              <div className="stack-sm">
                <span className="label" style={{ fontWeight: 600 }}>Days you can usually train</span>
                <div className="chips wrap" role="group" aria-label="Days you can train">
                  {WEEKDAY_SHORT.map((d, i) => (
                    <button key={d} className="chip" aria-pressed={w.days.includes(i)} onClick={() => set({ days: w.days.includes(i) ? w.days.filter((x) => x !== i) : [...w.days, i] })}>{d}</button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="stack-sm">
              <span className="label" style={{ fontWeight: 600 }}>Workouts per week</span>
              <Segmented label="Workouts per week" full value={String(w.sessions)} onChange={(v) => set({ sessions: Number(v) })} options={['1', '2', '3', '4', '5', '6'].map((v) => ({ value: v, label: v }))} />
              {!w.rotating && w.days.length < w.sessions ? <span className="label">Pick at least {w.sessions} day{w.sessions === 1 ? '' : 's'} above, or choose fewer workouts.</span> : null}
            </div>
            <div className="stack-sm">
              <span className="label" style={{ fontWeight: 600 }}>Minutes per workout</span>
              <Segmented label="Minutes per workout" full value={String(w.minutes)} onChange={(v) => set({ minutes: Number(v) })} options={MINUTES.map((m) => ({ value: String(m), label: String(m) }))} />
            </div>
            <div className="stack-sm">
              <span className="label" style={{ fontWeight: 600 }}>Usual time (optional)</span>
              <div className="chips wrap" role="group" aria-label="Usual time">
                {WINDOWS.map((x) => <button key={x.value} className="chip" aria-pressed={w.windows.includes(x.value)} onClick={() => set({ windows: w.windows.includes(x.value) ? w.windows.filter((y) => y !== x.value) : [...w.windows, x.value] })}>{x.label}</button>)}
              </div>
            </div>
          </>
        );
      case 3:
        return (
          <>
            <h1>{STEP_TITLES[3]}</h1>
            <div className="stack-sm">
              {([['new', 'New to training', 'Little or no regular strength training'], ['returning', 'Coming back', 'Trained before, had a break'], ['regular', 'Training regularly', 'Most weeks for the last few months']] as const).map(([v, t, s]) => (
                <button key={v} className="choice" aria-pressed={w.experience === v} onClick={() => set({ experience: v })}>
                  <span className="grow"><strong>{t}</strong><br /><span className="small muted">{s}</span></span>
                </button>
              ))}
            </div>
            <label className="field">What you do now (optional)<textarea className="textarea" maxLength={400} value={w.routine} placeholder="e.g. walks, a push/pull/legs split from my notebook" onChange={(e) => set({ routine: e.target.value })} /></label>
            <label className="field">Exercises you enjoy (optional)<input className="input" maxLength={300} value={w.likes} onChange={(e) => set({ likes: e.target.value })} /></label>
            <label className="field">Recent actual lifts (optional)<input className="input" maxLength={400} value={w.recent} placeholder="e.g. goblet squat 16 kg × 10" onChange={(e) => set({ recent: e.target.value })} /></label>
            <span className="label">Without recent lifts, starting weights stay blank: you pick a comfortable, controlled weight.</span>
          </>
        );
      case 4:
        return (
          <>
            <h1>{STEP_TITLES[4]}</h1>
            <Segmented label="Where you train" full value={w.location ?? ''} onChange={(v) => set({ location: v as WizardState['location'] })} options={[{ value: 'gym', label: 'Gym' }, { value: 'home', label: 'Home' }, { value: 'both', label: 'Both' }]} />
            <div className="stack-sm">
              <span className="label" style={{ fontWeight: 600 }}>Equipment you can use (bodyweight is always included)</span>
              <div className="chips wrap" role="group" aria-label="Equipment">
                {EQUIP.map((x) => <button key={x.value} className="chip" aria-pressed={w.equipment.includes(x.value)} onClick={() => set({ equipment: w.equipment.includes(x.value) ? w.equipment.filter((y) => y !== x.value) : [...w.equipment, x.value] })}>{x.label}</button>)}
              </div>
            </div>
            <label className="field">Exercises to avoid (optional)<input className="input" maxLength={300} value={w.avoid} placeholder="e.g. deadlift, lunges" onChange={(e) => set({ avoid: e.target.value })} /></label>
            <label className="field">Limitations a professional has given you (optional)<textarea className="textarea" maxLength={400} value={w.restrictions} placeholder="e.g. physio: no overhead pressing for 6 weeks" onChange={(e) => set({ restrictions: e.target.value })} /></label>
            <div className="card flat stack-sm">
              <strong>Before you start</strong>
              <p className="small" style={{ margin: 0 }}>Please read the Canadian Society for Exercise Physiology’s <a href={CSEP_URL} target="_blank" rel="noreferrer noopener">Get Active Questionnaire</a> (official site). Then tell us how it went. TrainLuma doesn’t reproduce or score it.</p>
              <div className="stack-sm" role="radiogroup" aria-label="Questionnaire result">
                {([['no_concerns', 'I read it and nothing applied to me'], ['has_concerns', 'Something applied to me'], ['not_answered', 'I haven’t read it yet']] as const).map(([v, t]) => (
                  <button key={v} role="radio" aria-checked={w.screening === v} className="choice" onClick={() => set({ screening: v })}><span className="grow">{t}</span></button>
                ))}
              </div>
              {w.screening === 'has_concerns' ? <div className="notice warn">Please check with a doctor or qualified exercise professional before starting a new routine. TrainLuma can’t give medical clearance. You can still use the journal, and plan later with their advice.</div> : null}
            </div>
          </>
        );
      case 5:
        return (
          <>
            <h1>{STEP_TITLES[5]}</h1>
            <p className="muted">Pick the foods you eat most. They become one-tap meals. Nutrition stays “not set” until you add a label or your recipe.</p>
            <FoodPrefsFields value={{ pattern: w.pattern, meatless: w.meatless, allergies: w.allergies }} onChange={(v) => set({ pattern: v.pattern, meatless: v.meatless, allergies: v.allergies })} />
            <UsualFoodsPicker selected={w.foods} onChange={(foods) => set({ foods })} prefs={{ pattern: w.pattern, meatless_weekdays: w.meatless }} />
            <details className="more">
              <summary><Icon name="info" size={16} /> Targets and height (optional)</summary>
              <div className="stack-sm" style={{ paddingTop: 8 }}>
                <p className="small muted">Only if you already have them from your own plan or a professional.</p>
                <div className="metrics">
                  <label className="field">Energy (kcal/day)<input className="input num" inputMode="numeric" value={w.energy} onChange={(e) => set({ energy: e.target.value })} placeholder="None" /></label>
                  <label className="field">Protein (g/day)<input className="input num" inputMode="numeric" value={w.protein} onChange={(e) => set({ protein: e.target.value })} placeholder="None" /></label>
                </div>
                <label className="field">Height (cm)<input className="input num" inputMode="decimal" value={w.height} onChange={(e) => set({ height: e.target.value })} placeholder="Skip" /></label>
              </div>
            </details>
          </>
        );
      case 6:
        return (
          <>
            <h1>Optional progress photos</h1>
            <PhotoGuidance />
            {!online ? <div className="notice warn">You’re offline. You can add photos later in Settings.</div> : (
              <>
                <PhotoPermissions />
                <PhotoSlots session={session} onSessionChange={setSession} />
              </>
            )}
            <label className="field">What do you like about your goal? (optional)
              <textarea className="textarea" maxLength={300} value={w.inspiration} placeholder="e.g. strong shoulders, more energy, being able to hike" onChange={(e) => set({ inspiration: e.target.value })} />
            </label>
          </>
        );
      case 7:
        return (
          <>
            <h1>{STEP_TITLES[7]}</h1>
            <div className="stack-sm">
              <button className="choice" aria-pressed={profile.consent.cloud_backup} onClick={() => void updateProfile({ ...profile, consent: { ...profile.consent, cloud_backup: true, updated_at: new Date().toISOString() } })}>
                <Icon name="cloud" /> <span className="grow"><strong>Back up to my private cloud</strong><br /><span className="small muted">Readable only by your account. Recommended, and needed for AI Coach.</span></span>
              </button>
              <button className="choice" aria-pressed={!profile.consent.cloud_backup} onClick={() => void updateProfile({ ...profile, consent: { ...profile.consent, cloud_backup: false, updated_at: new Date().toISOString() } })}>
                <Icon name="phone" /> <span className="grow"><strong>Keep it on this phone only</strong><br /><span className="small muted">Nothing is uploaded. Export regularly to keep a copy.</span></span>
              </button>
            </div>
            <div className="card flat">
              <Toggle label="AI help (optional)" checked={profile.consent.ai_processing}
                onChange={(v) => void updateProfile({ ...profile, consent: { ...profile.consent, ai_processing: v, updated_at: new Date().toISOString() } })}
                description="AI Coach chat and a draft plan from your answers. Sends your answers and a short summary of your records through TrainLuma’s backend to Google’s Gemini API, never your name or email. Off by default." />
            </div>
          </>
        );
      default:
        return (
          <>
            <h1>{mode === 'edit' ? 'Planning answers' : STEP_TITLES[8]}</h1>
            <Summary w={w} onEdit={(s) => set({ step: s })} />
            {result?.draft ? (
              <div className="stack">
                <PlanPreview plan={result.draft.plan} rationale={result.output?.assistant_message} />
                <button className="btn block" disabled={busy !== null} onClick={() => void acceptDraft(result.draft!)}>{busy === 'accept' ? <span className="spinner" /> : <Icon name="check" />} Accept plan</button>
                <div className="row">
                  <button className="btn secondary grow" disabled={busy !== null} onClick={() => void editDraft(result.draft!)}><Icon name="edit" size={18} /> Edit</button>
                  <button className="btn secondary grow" disabled={busy !== null} onClick={() => void generate()}><Icon name="repeat" size={18} /> Regenerate</button>
                </div>
                <p className="label">Nothing is active until you accept. Regenerating uses one of this week’s plan drafts.</p>
              </div>
            ) : result?.output ? (
              <div className="notice" role="status">
                <p style={{ margin: 0 }}>{result.output.assistant_message}</p>
                {result.output.questions.length ? <ul>{result.output.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ul> : null}
              </div>
            ) : result?.error ? (
              <div className="notice warn" role="alert">{result.error} Your answers are saved.</div>
            ) : null}
            {!result?.draft ? (
              <div className="stack-sm">
                {mode === 'onboarding' ? (
                  <>
                    <button className="btn block" disabled={busy !== null || !aiReady || !online} onClick={() => void generate()}>
                      {busy === 'generate' ? <><span className="spinner" /> Drafting your plan…</> : <><Icon name="sparkle" /> Generate my draft plan</>}
                    </button>
                    {!aiReady ? <span className="label">Turn on backup and AI help (previous step) to get a draft plan, or build your own.</span> : !online ? <span className="label">You’re offline. Build your own plan now, or generate one later from Coach.</span> : null}
                    <button className="btn secondary block" disabled={busy !== null} onClick={() => void finishWithout(() => navigate('plan'))}>Build my own plan</button>
                    <button className="btn secondary block" disabled={busy !== null} onClick={() => void simplePlan()}>Start from a simple 2-day plan</button>
                    <button className="btn ghost block" disabled={busy !== null} onClick={() => void finishWithout()}>Skip for now</button>
                  </>
                ) : (
                  <button className="btn block" disabled={busy !== null} onClick={() => void saveAnswers(false).then(() => { notify({ kind: 'info', message: 'Answers saved. New plan drafts will use them.' }); goBack('settings'); }, (e) => notify({ kind: 'error', message: saveErrorMessage(e) }))}>Save answers</button>
                )}
              </div>
            ) : null}
          </>
        );
    }
  })();

  const total = lastStep;
  return (
    <main className={mode === 'onboarding' ? 'welcome' : 'stack'}>
      {mode === 'onboarding' ? (
        <div className="row between">
          <span className="brand"><Mark /> TrainLuma</span>
          <button className="link" onClick={() => void signOut()}>Sign out</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('settings')}><Icon name="chevronLeft" /></button>
          <h1 className="sub-title grow">Planning answers</h1>
        </div>
      )}
      <div className="onboard-progress" aria-label={`Step ${step + (mode === 'onboarding' ? 1 : 0)} of ${total + (mode === 'onboarding' ? 1 : 0)}`} style={{ marginTop: 16 }}>
        {Array.from({ length: total + (mode === 'onboarding' ? 1 : 0) }, (_, i) => <span key={i} className={i <= step - (mode === 'onboarding' ? 0 : 1) ? 'on' : ''} />)}
      </div>
      <div className="stack" style={{ flex: 1, paddingTop: 28 }}>{body}</div>
      {step < lastStep || (mode === 'edit' && step < 8) ? (
        <div className="row" style={{ paddingTop: 16 }}>
          {step > 1 ? <button className="btn secondary" onClick={() => set({ step: step - 1 })}>Back</button> : null}
          {step === 5 || step === 6 ? <button className="btn ghost" onClick={() => set({ step: step + 1 })}>Skip</button> : null}
          <span className="grow" />
          <button className="btn" disabled={!canNext} onClick={() => set({ step: step === lastStep && mode === 'edit' ? 8 : step + 1 })}>{step === lastStep && mode === 'edit' ? 'Review' : 'Save and continue'}</button>
        </div>
      ) : (
        <div className="row" style={{ paddingTop: 16 }}>
          <button className="btn secondary" onClick={() => set({ step: mode === 'edit' ? 4 : 7 })}>Back</button>
        </div>
      )}
    </main>
  );
}

function Summary({ w, onEdit }: { w: WizardState; onEdit: (step: number) => void }) {
  const goal = (g: Goal) => GOALS.find((x) => x.value === g)?.label ?? g;
  const rows: [string, string, number][] = [
    ['Goal', w.goals.map(goal).join(' → ') || 'Not set', 1],
    ['Week', `${w.sessions} × ${w.minutes} min · ${w.rotating ? 'changing schedule' : w.days.sort().map((d) => WEEKDAY_SHORT[d]).join(', ') || 'no days picked'}`, 2],
    ['Experience', w.experience === 'new' ? 'New to training' : w.experience === 'returning' ? 'Coming back' : w.experience === 'regular' ? 'Training regularly' : 'Not set', 3],
    ['Equipment', `${w.location ?? '—'} · ${['bodyweight', ...w.equipment].join(', ')}${w.avoid ? ` · avoid: ${w.avoid}` : ''}`, 4],
    ['Screening', w.screening === 'no_concerns' ? 'Read, nothing applied' : w.screening === 'has_concerns' ? 'Something applied: check with a professional' : 'Not read yet', 4],
    ['Usual foods', w.foods.length ? `${w.foods.length} chosen` : 'None yet', 5],
  ];
  return (
    <div className="card tight list-divided">
      {rows.map(([k, v, s]) => (
        <div key={k} className="row" style={{ padding: '10px 0', gap: 8 }}>
          <span className="grow"><span className="label">{k}</span><br /><span className="small" style={{ overflowWrap: 'anywhere' }}>{v}</span></span>
          <button className="link" aria-label={`Edit ${k}`} onClick={() => onEdit(s)}>Edit</button>
        </div>
      ))}
    </div>
  );
}
