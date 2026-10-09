import { useEffect, useRef, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { Icon } from '@/core/design/icons';
import { extendTimer, formatClock, remainingSeconds } from '@/domain/training/timer';

/** Compact rest timer above the navigation. Driven by the stored end time; the interval only repaints. */
export function RestDock() {
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
        // unsupported
      }
    }
  }, [left, timer]);
  if (!timer) return null;
  return (
    <div className="rest-dock">
      <div className="rest-inner" role="timer" aria-label="Rest timer">
        <Icon name="clock" />
        <div className="grow">
          <div className="small" style={{ opacity: 0.75 }}>{left > 0 ? 'Rest' : 'Rest done'}</div>
          <div className="clock" data-testid="rest-clock" aria-live={left === 0 ? 'assertive' : 'off'}>{formatClock(left)}</div>
        </div>
        <button className="btn" onClick={() => setTimer(extendTimer(timer, 30, Date.now()))} aria-label="Add 30 seconds">+30s</button>
        <button className="btn" onClick={() => setTimer(null)}>{left > 0 ? 'Skip' : 'Close'}</button>
      </div>
    </div>
  );
}
