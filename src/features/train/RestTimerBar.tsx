import { useEffect, useRef, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { extendTimer, formatClock, remainingSeconds } from '@/domain/training/timer';

/** Rest timer driven by an absolute end timestamp; the interval only repaints the display. */
export function RestTimerBar() {
  const { timer, setTimer } = useJournal();
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef<number | null>(null);

  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [timer]);

  const left = remainingSeconds(timer, now);
  useEffect(() => {
    if (timer && left === 0 && buzzed.current !== timer.ends_at_ms) {
      buzzed.current = timer.ends_at_ms;
      try {
        navigator.vibrate?.(200);
      } catch {
        // vibration unsupported
      }
    }
  }, [left, timer]);

  if (!timer) return null;
  return (
    <div className="rest-bar">
      <div className="rest-inner" role="timer" aria-label="Rest timer">
        <div style={{ flex: 1 }}>
          <div className="small" style={{ opacity: 0.8 }}>{left > 0 ? 'Rest' : 'Rest done'}</div>
          <div className="clock" aria-live={left === 0 ? 'assertive' : 'off'} data-testid="rest-clock">{formatClock(left)}</div>
        </div>
        <button className="btn secondary" onClick={() => setTimer(extendTimer(timer, 30, Date.now()))} aria-label="Add 30 seconds">+30s</button>
        <button className="btn secondary" onClick={() => setTimer(null)}>{left > 0 ? 'Skip' : 'Close'}</button>
      </div>
    </div>
  );
}
