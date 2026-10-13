import { useEffect, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { track } from '@/core/analytics/analytics';
import { clearPendingInvite, pendingInvite } from './referral';
import './social.css';

const WEEK_MS = 7 * 86_400_000;
/** Earned moments: a week or more of showing up. */
export const PROMPT_MIN_STREAK = 7;

interface PromptState { lastShown: number; dismissed: number }

export function shouldPrompt(state: PromptState, streak: number, now: number): boolean {
  return streak >= PROMPT_MIN_STREAK && state.dismissed < 2 && now - state.lastShown >= WEEK_MS;
}

/**
 * The invite nudge on Today: only at an earned moment (a 7+ day streak), at most once a week, and
 * never again after two "Not now"s. A friend's pending code shows a "claim your month" card instead.
 */
export function InvitePrompt({ streak }: { streak: number }) {
  const { mode, journal } = useJournal();
  const key = `trainluma.invitePrompt.${journal.ownerId}`;
  const [claim, setClaim] = useState(() => (mode === 'account' ? pendingInvite() : null));
  const [show, setShow] = useState(false);
  const read = (): PromptState => {
    try {
      return { lastShown: 0, dismissed: 0, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<PromptState>) };
    } catch {
      return { lastShown: 0, dismissed: 2 };
    }
  };
  useEffect(() => {
    if (mode !== 'account' || claim) return;
    const s = read();
    if (!shouldPrompt(s, streak, Date.now())) return;
    try {
      localStorage.setItem(key, JSON.stringify({ ...s, lastShown: Date.now() }));
    } catch {
      return;
    }
    setShow(true); // eslint-disable-line react-hooks/set-state-in-effect -- shown once after reading storage
    track('invite_prompt_shown', { streak });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once per visit
  }, [mode, claim, streak >= PROMPT_MIN_STREAK]);

  if (claim) {
    return (
      <div className="card invite-nudge" role="region" aria-label="Friend’s invite">
        <span className="ih-gift sm" aria-hidden="true"><Icon name="gift" size={20} /></span>
        <span className="grow">
          <strong>A friend invited you 💙</strong>
          <span className="small muted" style={{ display: 'block' }}>Use their code {claim} for a free month of Plus.</span>
          <span className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn sm" onClick={() => navigate('invite', claim)}>Claim my month</button>
            <button className="btn sm ghost" onClick={() => { clearPendingInvite(); setClaim(null); }}>Not now</button>
          </span>
        </span>
      </div>
    );
  }
  if (!show) return null;
  const dismiss = () => {
    const s = read();
    try {
      localStorage.setItem(key, JSON.stringify({ ...s, dismissed: s.dismissed + 1 }));
    } catch {
      // ignore
    }
    setShow(false);
  };
  return (
    <div className="card invite-nudge" role="region" aria-label="Invite a friend">
      <span className="ih-gift sm" aria-hidden="true"><Icon name="gift" size={20} /></span>
      <span className="grow">
        <strong>{streak} days strong! Know someone who’d enjoy this?</strong>
        <span className="small muted" style={{ display: 'block' }}>Give a friend a free month of Plus, and get one yourself.</span>
        <span className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn sm" onClick={() => { setShow(false); navigate('invite'); }}>Invite a friend</button>
          <button className="btn sm ghost" onClick={dismiss}>Not now</button>
        </span>
      </span>
    </div>
  );
}
