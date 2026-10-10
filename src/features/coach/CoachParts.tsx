import { useState, type ReactNode } from 'react';
import { useJournal } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { useAuth } from '@/core/auth/AuthContext';
import { confirmMemory } from '@/core/ai/coachData';
import type { CoachOutput } from '@/core/ai/client';
import { Icon } from '@/core/design/icons';
import { EmptyState, Toggle } from '@/core/design/ui';
import { formatShortDate } from '@/core/time/localDate';

const SCOPE_KEY = 'rozana.coachScopeSeen';

function scopeSeen(): boolean {
  try {
    return localStorage.getItem(SCOPE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The general-fitness scope, explained once (then a one-line reminder). */
export function CoachScope() {
  const [seen, setSeen] = useState(scopeSeen);
  if (seen) return <p className="label">AI Coach: general fitness help, not medical advice. You decide on every change.</p>;
  return (
    <div className="notice" role="note">
      <strong>About AI Coach</strong>
      <p className="small" style={{ margin: '6px 0' }}>
        A general-fitness assistant powered by AI, not a doctor, physiotherapist, registered dietitian or human trainer. It reads only your own
        backed-up records and the notes you confirm. It can be wrong. It suggests; nothing changes unless you accept it. For pain or health
        concerns, ask a qualified professional.
      </p>
      <button className="link" onClick={() => { try { localStorage.setItem(SCOPE_KEY, '1'); } catch { /* convenience only */ } setSeen(true); }}>Got it</button>
    </div>
  );
}

/** Everything that must be true before any AI request: account mode, AI permission, backup on. */
export function CoachGate({ children, header = null }: { children: ReactNode; header?: ReactNode }) {
  const { mode, profile, updateProfile } = useJournal();
  const { exitDemo } = useAuth();
  if (mode === 'demo') {
    return (
      <>{header}<div className="card coach">
        <EmptyState icon="sparkle" tone="coach" title="AI Coach works with your own journal" action={<button className="btn" onClick={exitDemo}>Leave demo and sign in</button>}>
          It reads only your own signed-in records, never demo data, and says which days it used and what’s missing.
        </EmptyState>
      </div></>
    );
  }
  if (!profile.consent.ai_processing) {
    return (
      <>{header}<div className="card coach stack">
        <span className="eyebrow">AI Coach</span>
        <div className="feature-title">Turn on AI help?</div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Sends your question and a short summary of your own recent records (no name or email) through TrainLuma’s backend to Google’s Gemini API.</li>
          <li>Requests are not used for training under the paid API terms, and are not stored for chaining. Google may still keep them for a limited time for abuse monitoring.</li>
          <li>Chats are saved privately for 90 days, or until you delete them.</li>
          <li>Logging never needs AI. You can turn this off any time in Settings.</li>
        </ul>
        <Toggle label="Allow AI help" checked={false} onChange={(v) => void updateProfile({ ...profile, consent: { ...profile.consent, ai_processing: v, updated_at: new Date().toISOString() } })} />
      </div></>
    );
  }
  if (!profile.consent.cloud_backup) {
    return (
      <>{header}<div className="card coach stack">
        <span className="eyebrow">AI Coach</span>
        <div className="feature-title">Back up your journal first</div>
        <p className="small">The coach reads your records from your private backup, so it only works when backup is on. Your journal stays readable only by your account.</p>
        <button className="btn" onClick={() => void updateProfile({ ...profile, consent: { ...profile.consent, cloud_backup: true, updated_at: new Date().toISOString() } })}>Turn on backup</button>
      </div></>
    );
  }
  return <>{children}</>;
}

/** Render one validated schema-2.0 reply as plain text plus clearly separate review/confirm actions. */
export function AssistantBody({ output, onQuestion, onDraftPlan, showDetails = true }: {
  output: CoachOutput;
  onQuestion?: (text: string) => void;
  onDraftPlan?: () => void;
  showDetails?: boolean;
}) {
  const { notify } = useJournal();
  const [memoryDone, setMemoryDone] = useState<Record<number, 'saved' | 'dismissed'>>({});
  const trainingSuggestion = output.suggestions.some((s) => s.kind === 'training' || s.kind === 'routine');
  return (
    <div className="stack-sm">
      {output.safety.state === 'guidance_needed' && output.safety.message && output.safety.message !== output.assistant_message
        ? <div className="notice warn" role="note">{output.safety.message}</div> : null}
      {showDetails && output.suggestions.length ? (
        <div className="review-block">
          <h3>Suggestions</h3>
          <ul>{output.suggestions.map((x, i) => <li key={i}>{x.text}{x.rationale ? <span className="label"> · {x.rationale}</span> : null}</li>)}</ul>
        </div>
      ) : null}
      {showDetails && output.limitations.length ? (
        <div className="review-block">
          <h3>What’s missing</h3>
          <ul>{output.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ) : null}
      {output.questions.length && onQuestion ? (
        <div className="chips wrap" aria-label="Answer a question">
          {output.questions.map((q) => <button key={q.id} className="chip" onClick={() => onQuestion(q.text)}>{q.text}</button>)}
        </div>
      ) : null}
      {output.candidate_memories.map((m, i) => (
        memoryDone[i] ? null : (
          <div key={i} className="card flat tight row" style={{ gap: 8 }}>
            <span className="grow small">Remember this? <strong>{m.value}</strong></span>
            <button className="btn sm secondary" onClick={() => setMemoryDone({ ...memoryDone, [i]: 'dismissed' })}>No</button>
            <button className="btn sm" onClick={() => void confirmMemory(m.value).then(() => { setMemoryDone({ ...memoryDone, [i]: 'saved' }); notify({ kind: 'info', message: 'Saved to what the coach remembers. You can edit or delete it there.' }); }, (e: Error) => notify({ kind: 'error', message: e.message }))}>Save</button>
          </div>
        )
      ))}
      {trainingSuggestion && onDraftPlan ? (
        <button className="btn tonal sm" style={{ alignSelf: 'flex-start' }} onClick={onDraftPlan}><Icon name="workout" size={16} /> Draft an updated plan to review</button>
      ) : null}
    </div>
  );
}

export function DataWindow({ from, to }: { from: string; to: string }) {
  if (!from || !to) return null;
  return <span className="label">Based on your records from {formatShortDate(from)} to {formatShortDate(to)}</span>;
}

/** Opens the chat screen; used on Today, Coach and elsewhere. */
export function AskCoachButton({ label = 'Ask Coach' }: { label?: string }) {
  return <button className="btn" onClick={() => navigate('chat', 'new')}><Icon name="sparkle" size={18} /> {label}</button>;
}
