import { useCallback, useEffect, useState } from 'react';
import { LOGO } from './logoPaths';

/**
 * The TrainLuma TL mark, drawn in parts so it can assemble itself: the T bar sweeps in,
 * the stem drops, then the mint L draws up and out. Static when `animate` is false
 * (and the reduced-motion rule in app.css turns every animation off anyway).
 */
export function AnimatedMark({ size = 96, animate = true, tile = true }: { size?: number; animate?: boolean; tile?: boolean }) {
  return (
    <svg className={`tl-mark${animate ? ' play' : ''}`} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      {tile ? <rect className="tl-tile" width="512" height="512" rx="112" fill={LOGO.tile} /> : null}
      <g transform="translate(91 120.4) scale(0.5437)">
        <path className="tl-bar" d={LOGO.tBar} fill={LOGO.blue} />
        <path className="tl-stem" d={LOGO.tStem} fill={LOGO.blue} />
        <path className="tl-lv" d={LOGO.l} fill={LOGO.mint} />
      </g>
    </svg>
  );
}

const SEEN = 'trainluma.splashSeen';
const INTRO_MS = 8600;

function shouldShow(): boolean {
  try {
    // Automated browsers (tests, screenshots) and repeat opens in the same session skip the intro.
    if (navigator.webdriver) return false;
    return !sessionStorage.getItem(SEEN);
  } catch {
    return true;
  }
}

/**
 * Launch intro: the owner's TrainLuma logo animation (an 8.6-second muted clip: neon outline → fill →
 * glow → app icon with wordmark), then a soft fade into
 * the app. Tap anywhere to skip. With reduced motion, a still logo shows briefly instead. If the
 * video can't play, the vector mark assembles itself as before. Once per app launch (tab session).
 */
export function LaunchSplash() {
  const [initial] = useState<'show' | 'gone'>(() => (shouldShow() ? 'show' : 'gone'));
  const [phase, setPhase] = useState<'show' | 'leave' | 'gone'>(initial);
  const [fallback, setFallback] = useState(false);
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const leave = useCallback(() => setPhase((p) => (p === 'show' ? 'leave' : p)), []);

  useEffect(() => {
    if (initial === 'gone') return;
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      // private mode: the intro simply shows again next time
    }
    // Safety net: never hold the app longer than the clip (plus a little slack for slow starts).
    const t = window.setTimeout(leave, reduce ? 450 : INTRO_MS + 1200);
    return () => window.clearTimeout(t);
  }, [initial, reduce, leave]);

  useEffect(() => {
    if (phase !== 'leave') return;
    const t = window.setTimeout(() => setPhase('gone'), 420);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (!fallback) return;
    const t = window.setTimeout(leave, 1500);
    return () => window.clearTimeout(t);
  }, [fallback, leave]);

  if (phase === 'gone') return null;
  return (
    <button type="button" className={`launch-splash${phase === 'leave' ? ' leave' : ''}`} onClick={leave} aria-label="Skip intro">
      {reduce ? (
        <AnimatedMark size={120} animate={false} />
      ) : fallback ? (
        <>
          <span className="ls-glow" />
          <AnimatedMark size={112} />
          <span className="ls-word">Train<span>Luma</span></span>
        </>
      ) : (
        <video className="ls-video" poster="/intro/trainluma-intro-poster.jpg" autoPlay muted playsInline preload="auto" aria-hidden="true"
          onEnded={leave} onError={() => setFallback(true)}>
          <source src="/intro/trainluma-intro.webm" type="video/webm" />
          <source src="/intro/trainluma-intro.mp4" type="video/mp4" onError={() => setFallback(true)} />
        </video>
      )}
      {!reduce && !fallback ? <span className="ls-skip" aria-hidden="true">Tap to skip</span> : null}
    </button>
  );
}
