import { useEffect, useState } from 'react';
import { useAuth } from '@/core/auth/AuthContext';
import { authMessage } from '@/core/auth/messages';
import { FoodArt } from '@/core/design/foodArt';
import { EquipmentArt, Icon, Mark } from '@/core/design/icons';
import { applyTheme, resolvedTheme } from '@/core/design/theme';

function Illustration() {
  return (
    <div aria-hidden="true" style={{ position: 'relative', height: 168, margin: '8px 0 4px' }}>
      <div style={{ position: 'absolute', left: '6%', top: 18, width: 132, height: 132, borderRadius: '50%', background: 'var(--food)', display: 'grid', placeItems: 'center' }}>
        <FoodArt icon="dal" size={112} />
      </div>
      <div style={{ position: 'absolute', left: '42%', top: 0, width: 96, height: 96, borderRadius: 32, background: 'var(--train)', color: 'var(--train-ink)', display: 'grid', placeItems: 'center' }}>
        <EquipmentArt equipment="dumbbell" size={58} />
      </div>
      <div style={{ position: 'absolute', right: '6%', top: 70, width: 92, height: 92, borderRadius: '50%', background: 'var(--coach)', color: 'var(--coach-ink)', display: 'grid', placeItems: 'center' }}>
        <FoodArt icon="roti" size={80} />
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  const { configured, sendCode, verifyCode, enterDemo } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [notSetUp, setNotSetUp] = useState(false);
  const [dark, setDark] = useState(resolvedTheme() === 'dark');

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const send = async () => {
    setError(null);
    setInfo(null);
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError('Enter a valid email address.');
    if (!configured) return setNotSetUp(true);
    setBusy(true);
    try {
      await sendCode(e);
      setInfo(`We sent a code to ${e}.`);
      setStep('code');
      setResendIn(60);
    } catch (err) {
      const msg = authMessage(err);
      if (msg.startsWith('If this email')) {
        // Don't reveal whether the address is invited.
        setInfo(msg);
        setStep('code');
        setResendIn(60);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    const c = code.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(c)) return setError('Enter the code from the email (numbers only).');
    setBusy(true);
    try {
      await verifyCode(email.trim().toLowerCase(), c);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="welcome">
      <div className="row between">
        <span className="brand"><Mark /> TrainLuma</span>
        <button className="icon-btn plain" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => { applyTheme(dark ? 'light' : 'dark'); setDark(!dark); }}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
      </div>

      <div className="hero">
        <Illustration />
        <h1>Your routine, made simpler</h1>
        <p className="muted">Meals and workouts in one calm, private journal.</p>
      </div>

      {step === 'email' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label className="field">
            Email
            <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="you@example.com" />
          </label>
          {error ? <div className="notice error" role="alert">{error}</div> : null}
          {notSetUp ? (
            <div className="notice" role="status">
              Sign-in is still being set up for TrainLuma. Nothing was sent. You can explore a demo with made-up data in the meantime.
            </div>
          ) : null}
          <button className="btn block" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : 'Continue'}</button>
          <p className="label" style={{ textAlign: 'center' }}>Invite-only. We’ll email you a one-time code — no password.</p>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <div className="small">{info}</div>
          <label className="field">
            Code
            <input className="input otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={12} value={code}
              onChange={(e) => { setCode(e.target.value); setError(null); }} aria-describedby="code-help" />
          </label>
          <span id="code-help" className="label">Codes expire after a short time. Check spam if it hasn’t arrived.</span>
          {error ? <div className="notice error" role="alert">{error}</div> : null}
          <button className="btn block" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : 'Sign in'}</button>
          <div className="row between">
            <button type="button" className="link" onClick={() => { setStep('email'); setCode(''); setError(null); }}>Use a different email</button>
            <button type="button" className="link" disabled={resendIn > 0 || busy} onClick={() => void send()}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      <button className="btn ghost block" style={{ marginTop: 12 }} onClick={enterDemo}>Explore the demo (made-up data)</button>
    </main>
  );
}

export function AccessScreen({ kind, membership, email, message }: { kind: 'not_member' | 'error'; membership?: string; email?: string | null; message?: string }) {
  const { signOut, recheck } = useAuth();
  return (
    <main className="welcome">
      <span className="brand"><Mark /> TrainLuma</span>
      <div className="hero">
        <h1>{kind === 'error' ? 'We couldn’t check your account' : membership === 'deleting' ? 'This account is being deleted' : 'This account isn’t active'}</h1>
        <p className="muted">
          {kind === 'error'
            ? message
            : membership === 'revoked'
              ? 'Access for this account has been turned off by the owner.'
              : membership === 'deleting'
                ? 'Your data is being removed. Contact the owner if this is a mistake.'
                : `${email ?? 'This email'} hasn’t been added to TrainLuma yet. Ask the owner to invite you.`}
        </p>
      </div>
      <div className="stack">
        {kind === 'error' ? <button className="btn" onClick={recheck}>Try again</button> : null}
        <button className="btn secondary" onClick={() => void signOut()}>Sign out</button>
      </div>
    </main>
  );
}
