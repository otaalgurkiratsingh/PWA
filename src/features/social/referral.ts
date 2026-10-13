import { useEffect } from 'react';
import { useJournal } from '@/app/JournalContext';
import { track } from '@/core/analytics/analytics';
import { localDateIn } from '@/core/time/localDate';
import { checkActivation, cleanCode } from './social';

const PENDING = 'trainluma.pendingInvite';

/** Remember a friend's code from an invite link (#/invite/AB-1234) opened before signing in. */
export function rememberInviteFromHash(hash: string = typeof location === 'undefined' ? '' : location.hash) {
  const m = /^#\/invite\/([^/?#]+)/.exec(hash);
  const code = m ? cleanCode(decodeURIComponent(m[1]!)) : null;
  if (!code) return;
  try {
    localStorage.setItem(PENDING, code);
  } catch {
    // the code stays in the link; the person can type it
  }
}

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING);
  } catch {
    return null;
  }
}
export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    // ignore
  }
}

/**
 * Once a day, signed-in members whose sign-up used a friend's code ask the server whether they've
 * logged 7 days yet; at 7 the friend's month is released (exactly once, server-side).
 */
export function useReferralUpkeep() {
  const { mode, journal, profile } = useJournal();
  useEffect(() => {
    if (mode !== 'account') return;
    const day = localDateIn(profile.timezone);
    const key = `trainluma.referralCheck.${journal.ownerId}`;
    try {
      const last = localStorage.getItem(key) ?? '';
      if (last === day || last === 'done') return;
      localStorage.setItem(key, day);
    } catch {
      return;
    }
    void checkActivation().then(
      (r) => {
        if (!r.activated) return;
        try {
          localStorage.setItem(key, 'done');
        } catch {
          // ignore
        }
        track('referral_activated', {});
      },
      () => undefined,
    );
  }, [mode, journal.ownerId, profile.timezone]);
}

if (typeof location !== 'undefined') rememberInviteFromHash();
