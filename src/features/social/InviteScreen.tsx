import { useEffect, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { Section } from '@/core/design/ui';
import { track } from '@/core/analytics/analytics';
import { ShareSheet } from './CirclesScreen';
import { clearPendingInvite, pendingInvite } from './referral';
import {
  cleanCode, codePrefix, inviteMessage, myPlus, myReferral, REDEEM_COPY, redeemReferral, type PlusSummary, type RedeemStatus, type ReferralSummary,
} from './social';
import './social.css';

const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

/** "Give a month, get a month": your code, an editable share message, and redeeming a friend's code. */
export function InviteScreen({ code: codeParam }: { code?: string | null } = {}) {
  const { mode, profile, notify } = useJournal();
  const account = mode === 'account';
  const [mine, setMine] = useState<ReferralSummary | null>(null);
  const [plus, setPlus] = useState<PlusSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [friendCode, setFriendCode] = useState(() => (codeParam && cleanCode(codeParam)) || pendingInvite() || '');
  const [result, setResult] = useState<RedeemStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) return;
    let live = true;
    void myReferral(codePrefix(profile.nickname)).then((r) => live && setMine(r), () => live && setError('Couldn’t load your invite code. Check your connection and try again.'));
    void myPlus().then((p) => live && setPlus(p), () => undefined);
    return () => { live = false; };
  }, [account, profile.nickname]);

  const code = account ? mine?.code ?? null : 'TL-0000';

  const redeem = async () => {
    const c = cleanCode(friendCode);
    if (!c) { setResult('invalid_code'); return; }
    setBusy(true);
    try {
      const status = await redeemReferral(c);
      setResult(status);
      if (status === 'ok' || status === 'already_redeemed') clearPendingInvite();
      if (status === 'ok') {
        track('invite_code_redeemed', {});
        void myPlus().then(setPlus, () => undefined);
      }
    } catch {
      notify({ kind: 'error', message: 'Couldn’t check that code. Check your connection and try again.' });
    }
    setBusy(false);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('settings')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Invite friends</h1>
      </div>

      <div className="card invite-hero">
        <span className="ih-gift" aria-hidden="true"><Icon name="gift" size={28} /></span>
        <strong className="ih-title">Give a month, get a month</strong>
        <p className="small">Your friend gets a free month of TrainLuma Plus. You get one too, once they’ve logged on 7 days. Training is better together.</p>
      </div>

      {!account ? <div className="notice" role="status">Invites need a signed-in account. This is how it looks, with a sample code.</div> : null}
      {error ? <div className="notice error" role="alert">{error}</div> : null}

      <Section title="Your code">
        <div className="card stack-sm">
          {code ? (
            <>
              <div className="row between">
                <span className="invite-code num" aria-label={`Your code ${code}`}>{code}</span>
                <button className="btn sm secondary" disabled={!account} onClick={() => void navigator.clipboard?.writeText(code).then(() => notify({ kind: 'info', message: 'Code copied.' }), () => undefined)}>Copy</button>
              </div>
              <button className="btn block" disabled={!account} onClick={() => setSharing(true)}><Icon name="upload" size={18} /> Share with a friend</button>
              {mine ? (
                <div className="mo-stats" style={{ marginTop: 6 }}>
                  <span><b className="num">{mine.redeemed}</b> friend{mine.redeemed === 1 ? '' : 's'} joined</span>
                  <span><b className="num">{mine.activated}</b> reached 7 days</span>
                  <span><b className="num">{mine.months_pending}</b> waiting</span>
                </div>
              ) : null}
            </>
          ) : <div className="skeleton" style={{ height: 80 }} />}
        </div>
      </Section>

      <Section title="Got a friend’s code?">
        <div className="card stack-sm">
          <label className="field">
            Friend’s code
            <input className="input" placeholder="AB-1234" maxLength={8} autoCapitalize="characters" value={friendCode}
              onChange={(e) => { setFriendCode(e.target.value.toUpperCase()); setResult(null); }} />
          </label>
          <button className="btn secondary block" disabled={!account || busy || !friendCode.trim()} onClick={() => void redeem()}>
            {busy ? <span className="spinner" /> : 'Use code'}
          </button>
          {result ? <p className={`small${result === 'ok' ? '' : ' muted'}`} role="status">{REDEEM_COPY[result]}</p> : null}
          <span className="label">One code per person and per phone, and not your own. That keeps it fair.</span>
        </div>
      </Section>

      {plus ? (
        <Section title="Your free months">
          <div className="card stack-sm">
            <div className="mo-stats">
              <span><b className="num">{plus.queued + plus.released}</b> saved</span>
              <span><b className="num">{plus.pending}</b> on the way</span>
            </div>
            <span className="label">Plus isn’t on sale yet, so nothing is charged. Your {months(plus.queued + plus.released)} {plus.queued + plus.released === 1 ? 'is' : 'are'} kept and apply automatically when it launches.</span>
          </div>
        </Section>
      ) : null}

      {sharing && code ? (
        <ShareSheet title="Invite a friend" initial={inviteMessage(code)} onClose={() => setSharing(false)} onShared={() => track('invite_sent', {})} />
      ) : null}
    </div>
  );
}
