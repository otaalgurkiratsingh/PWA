import { useEffect, useId, useState } from 'react';

/**
 * The TrainLuma TL mark, drawn in parts so it can assemble itself: the T bar sweeps in,
 * the stem drops, then the mint L draws up and out. Static when `animate` is false
 * (and the reduced-motion rule in app.css turns every animation off anyway).
 */
export function AnimatedMark({ size = 96, animate = true, tile = true }: { size?: number; animate?: boolean; tile?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`tl-mark${animate ? ' play' : ''}`} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0057FF" /><stop offset="1" stopColor="#0A1FB8" /></linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#B9F8E4" /><stop offset="1" stopColor="#22DCD4" /></linearGradient>
      </defs>
      {tile ? <rect className="tl-tile" width="512" height="512" rx="120" fill={`url(#${id}bg)`} /> : null}
      <rect className="tl-bar" x="100" y="128" width="266" height="77" rx="38.5" fill="#FFFFFF" />
      <rect className="tl-stem" x="185" y="150" width="71" height="235" rx="35.5" fill="#FFFFFF" />
      <rect className="tl-lv" x="271" y="223" width="65" height="159" rx="32.5" fill={`url(#${id}l)`} />
      <rect className="tl-lh" x="271" y="318" width="162" height="64" rx="32" fill={`url(#${id}l)`} />
    </svg>
  );
}

const SEEN = 'trainluma.splashSeen';

/**
 * Launch splash: the logo assembles over the brand gradient, the wordmark rises, then it fades away.
 * Purely visual (aria-hidden, pointer-events: none), so it never blocks a tap or a screen reader.
 * Shown once per app launch (tab session).
 */
export function LaunchSplash() {
  const [initial] = useState<'show' | 'gone'>(() => {
    try {
      return sessionStorage.getItem(SEEN) ? 'gone' : 'show';
    } catch {
      return 'show';
    }
  });
  const [phase, setPhase] = useState<'show' | 'leave' | 'gone'>(initial);
  useEffect(() => {
    if (initial === 'gone') return;
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      // private mode: the splash simply shows again next time
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const leave = window.setTimeout(() => setPhase('leave'), reduce ? 250 : 1250);
    const gone = window.setTimeout(() => setPhase('gone'), reduce ? 400 : 1650);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, [initial]);
  if (phase === 'gone') return null;
  return (
    <div className={`launch-splash${phase === 'leave' ? ' leave' : ''}`} aria-hidden="true">
      <div className="ls-glow" />
      <AnimatedMark size={112} />
      <div className="ls-word">Train<span>Luma</span></div>
      <div className="ls-tag">Eat well · Train smart · Glow up</div>
    </div>
  );
}
