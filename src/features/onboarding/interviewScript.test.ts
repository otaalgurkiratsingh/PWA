import { describe, expect, it } from 'vitest';
import { DEMO_PROFILES } from '@shared/fixtures/demo';
import { answer, progressText, QUESTIONS, remainingQuestions } from './interviewScript';
import { initialWizard, profileFromWizard, resumeWizard } from './wizardState';

const p = { ...DEMO_PROFILES[0]!, synthetic: false };
const ctx = { name: 'Harjit', trainer: 'Luma' };
const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;

describe('trainer interview script', () => {
  it('starts with a greeting from the named trainer and a time estimate', () => {
    const w = initialWizard(p);
    expect(remainingQuestions(w)[0]!.text({ ...ctx, w, first: true })).toMatch(/^Hi Harjit! I’m Luma, your trainer/);
    expect(progressText(w)).toBe('A few more questions — about 2 min');
  });

  it('the trucker answer sets cab-friendly defaults and asks how many days instead of weekdays', () => {
    let w = answer(initialWizard(p), q('lifestyle'), ['trucker'], ctx);
    expect(w).toMatchObject({ lifestyle: 'trucker', rotating: true, minutes: 30, location: 'truck', equipment: ['dumbbell', 'band'] });
    expect(remainingQuestions(w).map((x) => x.id)).toContain('days');
    expect(remainingQuestions(w).map((x) => x.id)).not.toContain('weekdays');
    w = answer(w, q('days'), ['2'], ctx);
    const t = profileFromWizard(p, w, '2026-10-15T00:00:00Z').training!;
    expect(t).toMatchObject({ lifestyle: 'trucker', location: 'truck', sessions_per_week: 2, rotating_schedule: true });
  });

  it('answered or skipped questions are never asked again; every question can be skipped', () => {
    let w = initialWizard(p);
    while (remainingQuestions(w).length) w = answer(w, remainingQuestions(w)[0]!, null, ctx);
    expect(w.done.length).toBeGreaterThan(5);
    expect(new Set(w.done).size).toBe(w.done.length);
    expect(progressText(w)).toBe('All done');
    expect(w.log.every((l) => l.a === 'Skip for now')).toBe(true);
  });

  it('pain areas get the not-a-physio note; an urgent pain note gets the safety reply', () => {
    const w = answer(initialWizard(p), q('pain'), ['lower_back', 'knees'], ctx);
    expect(w.painAreas).toEqual(['lower_back', 'knees']);
    expect(w.log.at(-1)!.reply).toMatch(/I’m not a physio or doctor/);
    const n = answer(w, q('pain_note'), ['numbness in my arm while driving'], ctx);
    expect(n.log.at(-1)!.reply).toMatch(/urgent attention/);
  });

  it('a form draft saved before the interview existed resumes as the form', () => {
    expect(resumeWizard(p, { step: 3 }).mode).toBe('form');
    expect(resumeWizard(p, { step: 1 }).mode).toBe('interview');
    expect(resumeWizard(p, null).mode).toBe('interview');
  });
});
