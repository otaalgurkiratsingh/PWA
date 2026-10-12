import './insights.css';

/** Small inline streak pill for the Today card. Never shames a gap. */
export function StreakBadge({ current, frozen, broken }: { current: number; frozen: number; broken: boolean }) {
  if (current <= 0) {
    return (
      <span className="ins-streak fresh">
        {broken ? 'Life happens. Start a new one today' : 'Log something today to start a streak'}
        <span aria-hidden="true">{broken ? '💪' : '✨'}</span>
      </span>
    );
  }
  return (
    <span className="ins-streaks">
      <span className="ins-streak">
        <span aria-hidden="true">🔥</span>
        {current}-day streak
      </span>
      {frozen > 0 ? (
        <span className="ins-streak frozen">
          <span aria-hidden="true">❄️</span>
          freeze used
          <span className="sr-only"> (a streak freeze covered one day this week)</span>
        </span>
      ) : null}
    </span>
  );
}
