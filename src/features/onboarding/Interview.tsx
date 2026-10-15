/**
 * Onboarding as a conversation with the person's trainer (scripted, no AI calls). It fills the same
 * draft as the form, one question at a time, and ends at the same review screen + "Generate my
 * draft plan". "Prefer a form?" and "Just set me up with a standard plan" are always visible.
 */
import { useEffect, useRef, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { CoachLine } from '@/features/coach/ChatBits';
import { useTrainer } from '@/features/coach/Trainer';
import { answer, progressText, remainingQuestions, type Question } from './interviewScript';
import type { WizardState } from './wizardState';

const CSEP_URL = 'https://store.csep.ca/pages/getactivequestionnaire';

export function Interview({ w, onChange, onForm, onStandard, onFinish, busy }: {
  w: WizardState;
  onChange: (w: WizardState) => void;
  /** "Prefer a form?" — the same answers, as the step-by-step form. */
  onForm: () => void;
  /** "Just set me up with a standard plan" — never trapped in the interview. */
  onStandard: () => void;
  /** Interview finished: continue to the review screen. */
  onFinish: () => void;
  busy: boolean;
}) {
  const { profile, updateProfile } = useJournal();
  const trainer = useTrainer();
  const name = profile.nickname.split(' ')[0] ?? profile.nickname;
  const remaining = remainingQuestions(w);
  const q: Question | undefined = remaining[0];
  const [picked, setPicked] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const ctx = { name, trainer: trainer.name };

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [w.log.length]);

  const selected = q?.kind === 'multi' ? picked ?? q.selected?.(w) ?? [] : [];
  const reply = (values: string[] | null) => {
    if (!q) return;
    setPicked(null);
    setText('');
    onChange(answer(w, q, values, ctx));
  };
  const privacy = async (v: string) => {
    const now = new Date().toISOString();
    await updateProfile({ ...profile, consent: { ...profile.consent, cloud_backup: v !== 'local', ai_processing: v === 'backup_ai', updated_at: now } });
    reply([v]);
  };

  return (
    <div className="stack interview" style={{ gap: 16 }}>
      <div className="row between" style={{ alignItems: 'center' }}>
        <span className="row" style={{ gap: 10 }}>
          <CoachAvatar avatar={trainer.avatar} size={40} ring />
          <span><strong>{trainer.name}</strong><br /><span className="label" aria-live="polite">{progressText(w)}</span></span>
        </span>
        <button className="link" onClick={onForm}>Prefer a form?</button>
      </div>

      <div className="chat-log" aria-label={`Conversation with ${trainer.name}`}>
        {w.log.map((m, i) => (
          <div key={`${m.q}-${i}`} className="stack-sm">
            <CoachLine avatar={trainer.avatar}><div className="bubble coach">{m.text}</div></CoachLine>
            <div className="bubble me">{m.a}</div>
            {m.reply ? <CoachLine avatar={trainer.avatar}><div className="bubble coach">{m.reply}</div></CoachLine> : null}
          </div>
        ))}
        {q ? (
          <CoachLine avatar={trainer.avatar}>
            <div className="bubble coach" data-testid="interview-question">{q.text({ ...ctx, w, first: w.done.length === 0 })}</div>
            {q.id === 'screening' ? <a className="small" href={CSEP_URL} target="_blank" rel="noreferrer noopener">Open the Get Active Questionnaire (official site)</a> : null}
          </CoachLine>
        ) : (
          <CoachLine avatar={trainer.avatar}>
            <div className="bubble coach">Thanks, {name}! That’s everything I need for now. Check your answers, then I’ll draft a plan for you to review. I’ll ask the rest gently over your first week, one question a day at most.</div>
          </CoachLine>
        )}
        <div ref={end} />
      </div>

      {q ? (
        <div className="stack-sm" role="group" aria-label="Your answer">
          {q.kind === 'text' ? (
            <div className="stack-sm">
              <textarea className="textarea" aria-label="Anything hurting right now?" maxLength={300} value={text} placeholder={q.placeholder} onChange={(e) => setText(e.target.value)} />
              <div className="row">
                <button className="btn sm" disabled={!text.trim()} onClick={() => reply([text])}>Send</button>
                <button className="btn sm secondary" onClick={() => reply([''])}>Nothing to add</button>
              </div>
            </div>
          ) : (
            <div className="chips wrap">
              {q.chips(w).map((c) => (
                <button key={c.value} className="chip" disabled={busy}
                  aria-pressed={q.kind === 'multi' ? selected.includes(c.value) : undefined}
                  onClick={() => {
                    if (q.kind === 'multi') setPicked(selected.includes(c.value) ? selected.filter((x) => x !== c.value) : [...selected, c.value]);
                    else if (q.kind === 'privacy') void privacy(c.value);
                    else reply([c.value]);
                  }}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {q.kind === 'multi' ? (
            <div className="row">
              <button className="btn sm" disabled={q.id === 'weekdays' && selected.length === 0} onClick={() => reply(selected)}>Done</button>
              {q.id === 'pain' ? <button className="btn sm secondary" onClick={() => reply([])}>None of these</button> : null}
            </div>
          ) : null}
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => reply(null)}>Skip for now</button>
        </div>
      ) : (
        <button className="btn block" onClick={onFinish}><Icon name="check" /> Review my answers</button>
      )}

      <button className="btn ghost block" disabled={busy} onClick={onStandard}>{busy ? <span className="spinner" /> : null} Just set me up with a standard plan</button>
      <p className="label" style={{ margin: 0 }}>No AI is used for these questions. Your answers stay on this phone until you choose backup.</p>
    </div>
  );
}
