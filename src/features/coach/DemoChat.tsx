import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/core/auth/AuthContext';
import { Icon } from '@/core/design/icons';
import { CoachLine, Typing } from './ChatBits';
import { MeetTrainer, TrainerHead, useTrainer } from './Trainer';

const STARTERS = [
  'Can you fit today’s workout into 30 minutes?',
  'Which of my usual foods could add more protein?',
  'I missed a workout this week. What should I do next?',
  'How am I doing this week?',
];

/** Scripted sample answers so the demo shows what chatting feels like. Not AI, never sent anywhere. */
function sampleReply(q: string, name: string): string {
  const t = q.toLowerCase();
  if (/30|short|quick|time/.test(t)) {
    return 'Here’s a 30-minute version of Legs: keep goblet squats and Romanian deadlifts at 3 sets each, drop leg extensions today, and rest 60–75 seconds between sets. You’ll still hit the main lifts.';
  }
  if (/protein|food|eat|meal/.test(t)) {
    return 'From your usual meals, dahi with lunch and an extra katori of dal at dinner are easy protein adds. Paneer bhurji instead of aloo paratha at breakfast helps too. Want me to keep that in mind?';
  }
  if (/miss|skip|busy/.test(t)) {
    return 'No stress, one missed day doesn’t undo your progress. Pick up with your next planned day instead of doubling up. Even a 20-minute session today keeps the habit alive.';
  }
  if (/how|doing|week|progress/.test(t)) {
    return 'You trained 3 times in the last 7 days and set a new best on bench press. Meals are logged on most days. Keep it up!';
  }
  return `I’m ${name}, your trainer. In your own account I answer from your logged meals, workouts and plan, and I suggest changes for you to approve. Try one of the questions above!`;
}

interface Turn { key: number; role: 'me' | 'coach'; text: string }

/** Demo chat: the real chat look and your chosen trainer, with sample replies. */
export function DemoChat() {
  const { exitDemo } = useAuth();
  const trainer = useTrainer();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [turns, typing]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || typing) return;
    setTurns((t) => [...t, { key: Date.now(), role: 'me', text: q }]);
    setInput('');
    setTyping(true);
    timer.current = window.setTimeout(() => {
      setTurns((t) => [...t, { key: Date.now() + 1, role: 'coach', text: sampleReply(q, trainer.name) }]);
      setTyping(false);
    }, 900);
  };

  return (
    <>
      <TrainerHead />
      <div className="notice row" role="note" style={{ gap: 10 }}>
        <span className="grow"><strong>Demo chat</strong> · Sample replies, not AI. Sign in to chat with {trainer.name} about your own journal.</span>
        <button className="btn sm secondary" onClick={exitDemo}>Sign in</button>
      </div>
      <div className="chat-log" aria-live="polite" aria-busy={typing}>
        {turns.length === 0 ? (
          <div className="stack">
            <MeetTrainer />
            <CoachLine avatar={trainer.avatar}><div className="bubble coach">Hi! I’m {trainer.name}. What would you like help with today?</div></CoachLine>
            <div className="chips wrap">{STARTERS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        ) : null}
        {turns.map((t) => t.role === 'me'
          ? <div key={t.key} className="stack-sm" style={{ alignItems: 'flex-end' }}><div className="bubble me">{t.text}</div></div>
          : (
            <CoachLine key={t.key} avatar={trainer.avatar}>
              <div className="bubble coach">{t.text}</div>
              <span className="label">Sample reply (demo)</span>
            </CoachLine>
          ))}
        {typing ? <CoachLine avatar={trainer.avatar}><Typing name={trainer.name} /></CoachLine> : null}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea className="textarea" rows={1} value={input} maxLength={500} placeholder={`Message ${trainer.name}`} aria-label={`Message ${trainer.name}`}
          onChange={(e) => setInput(e.target.value)} />
        <button className="icon-btn filled" type="submit" aria-label="Send" disabled={typing || !input.trim()}><Icon name="send" /></button>
      </form>
    </>
  );
}
