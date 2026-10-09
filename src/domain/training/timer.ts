import type { RestTimer } from '@shared/contracts';

/** Remaining seconds computed from an absolute end timestamp — robust to backgrounding and reloads. */
export function remainingSeconds(timer: RestTimer | null, nowMs: number): number {
  if (!timer) return 0;
  return Math.max(0, Math.ceil((timer.ends_at_ms - nowMs) / 1000));
}

export function startTimer(sessionId: string, setId: string, seconds: number, nowMs: number): RestTimer {
  return { session_id: sessionId, set_id: setId, ends_at_ms: nowMs + seconds * 1000, duration_seconds: seconds };
}

export function extendTimer(t: RestTimer, seconds: number, nowMs: number): RestTimer {
  const base = Math.max(t.ends_at_ms, nowMs);
  return { ...t, ends_at_ms: base + seconds * 1000, duration_seconds: t.duration_seconds + seconds };
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
