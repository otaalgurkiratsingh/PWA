import { useCallback, useEffect, useRef, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack, navigate, replaceRoute } from '@/app/router';
import { aiUsage, deleteThreads, threadMessages, type ChatMessage, type Usage } from '@/core/ai/coachData';
import { aiErrorText, callAi, MAX_CHAT_CHARS, type AiResponse, type CoachOutput } from '@/core/ai/client';
import { Icon } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';
import { newId } from '@/core/ids';
import { AssistantBody, CoachGate, CoachScope, DataWindow } from './CoachParts';
import { requestPlanDraft } from './planDraft';

const STARTERS = [
  'Can you fit today’s workout into 30 minutes?',
  'What does my weight trend show so far?',
  'Which of my usual foods could add more protein?',
  'I missed a workout this week. What should I do next?',
];

interface Turn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  output?: CoachOutput | null;
  window?: { from: string; to: string };
  /** For a user turn that has not been answered yet. */
  state?: 'sending' | 'failed';
  opId?: string;
  error?: string;
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  return online;
}

export function ChatScreen({ threadParam }: { threadParam: string | null }) {
  const header = (
    <div className="chat-head">
      <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('coach')}><Icon name="chevronLeft" /></button>
      <h1 className="sub-title grow">AI Coach</h1>
    </div>
  );
  return (
    <div className="stack chat-page">
      <CoachGate header={header}>
        <Chat initialThread={threadParam && threadParam !== 'new' ? threadParam : null} />
      </CoachGate>
    </div>
  );
}

function Chat({ initialThread }: { initialThread: string | null }) {
  const { today, notify, profile, syncNow } = useJournal();
  const online = useOnline();
  const [threadId, setThreadId] = useState<string | null>(initialThread);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(Boolean(initialThread));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.state === 'sending');

  const loadUsage = useCallback(() => { void aiUsage().then(setUsage, () => undefined); }, []);

  useEffect(() => {
    let live = true;
    loadUsage();
    if (initialThread) {
      threadMessages(initialThread).then(
        (msgs: ChatMessage[]) => {
          if (!live) return;
          setTurns(msgs.map((m) => ({ key: m.id, role: m.role, text: m.content, output: m.output })));
          setLoading(false);
          if (!msgs.length) setLoadError('This chat was deleted or has expired.');
        },
        (e: Error) => { if (live) { setLoadError(e.message); setLoading(false); } },
      );
    }
    return () => {
      live = false;
      pending.current?.abort();
    };
  }, [initialThread, loadUsage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, busy]);

  const remaining = usage ? Math.max(0, usage.limits.question_per_day - usage.questions_today) : null;

  const run = async (text: string, opId: string, key: string) => {
    const ctrl = new AbortController();
    pending.current = ctrl;
    setTurns((t) => t.map((x) => (x.key === key ? { ...x, state: 'sending', error: undefined } : x)));
    const r: AiResponse = await callAi({ operation: 'coach_question', today, thread_id: threadId, message: text }, opId, { signal: ctrl.signal, timezone: profile.timezone });
    pending.current = null;
    if (r.status === 'ok' && r.operation === 'coach_question') {
      const reply = r.reply;
      if (!threadId) {
        setThreadId(reply.thread_id);
        replaceRoute('chat', reply.thread_id);
      }
      setTurns((t) => [
        ...t.map((x) => (x.key === key ? { ...x, state: undefined, opId: undefined } : x)),
        { key: `a-${opId}`, role: 'assistant', text: reply.output.assistant_message, output: reply.output, window: reply.data_window },
      ]);
      loadUsage();
      return;
    }
    if (r.status === 'safety') {
      setTurns((t) => [...t.map((x) => (x.key === key ? { ...x, state: undefined } : x)), { key: `s-${opId}`, role: 'assistant', text: r.message, output: null }]);
      return;
    }
    if (r.status === 'error' && r.error === 'thread_not_found') {
      setThreadId(null);
      replaceRoute('chat', 'new');
    }
    setTurns((t) => t.map((x) => (x.key === key ? { ...x, state: 'failed', error: aiErrorText(r) } : x)));
    loadUsage();
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy || !online) return;
    if (text.length > MAX_CHAT_CHARS) return notify({ kind: 'error', message: `Please keep messages under ${MAX_CHAT_CHARS.toLocaleString('en-US')} characters.` });
    const opId = newId();
    const key = `u-${opId}`;
    setTurns((t) => [...t, { key, role: 'user', text, state: 'sending', opId }]);
    setInput('');
    void run(text, opId, key);
  };

  /** Retry reuses the same request id: a finished answer is replayed, never paid for twice. */
  const retry = (t: Turn) => { if (t.opId && !busy) void run(t.text, t.opId, t.key); };
  const editFailed = (t: Turn) => {
    setTurns((all) => all.filter((x) => x.key !== t.key));
    setInput(t.text);
  };

  const newChat = () => {
    pending.current?.abort();
    setTurns([]);
    setThreadId(null);
    setLoadError(null);
    replaceRoute('chat', 'new');
    loadUsage();
  };

  const remove = async () => {
    try {
      if (threadId) await deleteThreads(threadId);
      setConfirmDelete(false);
      notify({ kind: 'info', message: 'Chat deleted. What the coach remembers is kept separately.' });
      newChat();
    } catch (e) {
      notify({ kind: 'error', message: (e as Error).message });
    }
  };

  const draftPlan = async () => {
    const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.text ?? '';
    setDrafting(true);
    const r = await requestPlanDraft({ profile, today, syncNow, source: 'chat', instruction: lastUser.slice(0, 500) });
    setDrafting(false);
    if (r.status === 'ok' && r.operation === 'onboarding_plan' && r.draft) return navigate('draft', r.draft.id);
    if (r.status === 'ok' && r.operation === 'onboarding_plan') {
      return setTurns((t) => [...t, { key: `p-${Date.now()}`, role: 'assistant', text: r.output.assistant_message, output: r.output }]);
    }
    notify({ kind: 'error', message: aiErrorText(r) });
  };

  return (
    <>
      <div className="chat-head">
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('coach')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">AI Coach</h1>
        <button className="icon-btn plain" aria-label="New chat" onClick={newChat}><Icon name="plus" /></button>
        <button className="icon-btn plain" aria-label="Delete chat" disabled={!threadId} onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>
      </div>

      {!online ? <div className="notice warn" role="status">You’re offline. The coach needs a connection; your journal still works. Nothing is sent later automatically.</div> : null}
      {loadError ? <div className="notice warn" role="alert">{loadError} <button className="link" onClick={newChat}>Start a new chat</button></div> : null}

      <div className="chat-log" aria-live="polite" aria-busy={busy}>
        {loading ? <div className="skeleton" /> : null}
        {!loading && turns.length === 0 ? (
          <div className="stack">
            <CoachScope />
            <p className="small muted">Ask about your plan, your week or your usual foods. Try one of these:</p>
            <div className="chips wrap">
              {STARTERS.map((s) => <button key={s} className="chip" disabled={!online || busy} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : null}
        {turns.map((t) => (
          t.role === 'user' ? (
            <div key={t.key} className="stack-sm" style={{ alignItems: 'flex-end' }}>
              <div className="bubble me">{t.text}</div>
              {t.state === 'failed' ? (
                <div className="chat-fail" role="alert">
                  <span className="small">{t.error || 'Not answered.'}</span>
                  <span className="row" style={{ gap: 12 }}>
                    <button className="link" onClick={() => retry(t)} disabled={busy || !online}>Retry</button>
                    <button className="link" onClick={() => editFailed(t)}>Edit</button>
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <div key={t.key} className="stack-sm" style={{ alignItems: 'flex-start' }}>
              <div className="bubble coach">{t.text}</div>
              {t.output ? <AssistantBody output={t.output} onQuestion={(q) => setInput(q)} onDraftPlan={drafting ? undefined : () => void draftPlan()} /> : null}
              {t.window ? <DataWindow from={t.window.from} to={t.window.to} /> : null}
            </div>
          )
        ))}
        {busy ? (
          <div className="stack-sm" style={{ alignItems: 'flex-start' }}>
            <div className="bubble coach typing" role="status"><span className="spinner" /> Coach is thinking…</div>
            <button className="link" onClick={() => pending.current?.abort()}>Stop waiting</button>
          </div>
        ) : null}
        {drafting ? <div className="bubble coach typing" role="status"><span className="spinner" /> Drafting a plan for you to review…</div> : null}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          className="textarea"
          rows={1}
          value={input}
          maxLength={MAX_CHAT_CHARS}
          placeholder={remaining === 0 ? 'Daily limit reached. It resets tomorrow.' : 'Message AI Coach'}
          aria-label="Message AI Coach"
          disabled={remaining === 0}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(input); } }}
        />
        <button className="icon-btn filled" type="submit" aria-label="Send" disabled={busy || !online || input.trim().length === 0 || remaining === 0}>
          {busy ? <span className="spinner" /> : <Icon name="send" />}
        </button>
      </form>
      <p className="label composer-note">
        {remaining !== null ? `${remaining} of ${usage!.limits.question_per_day} messages left today. ` : ''}
        {input.length > MAX_CHAT_CHARS - 500 ? `${(MAX_CHAT_CHARS - input.length).toLocaleString('en-US')} characters left. ` : ''}
        Text only. Not for medical questions or symptoms.
      </p>

      {confirmDelete ? (
        <Sheet title="Delete this chat?" onClose={() => setConfirmDelete(false)} actions={
          <>
            <button className="btn secondary grow" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button className="btn danger grow" onClick={() => void remove()}>Delete</button>
          </>
        }>
          <p className="muted">It’s removed from your account now and won’t be used in future answers. Things you saved to “What the coach remembers” stay until you delete them there. Copies in backups expire on the provider’s schedule.</p>
        </Sheet>
      ) : null}
    </>
  );
}
