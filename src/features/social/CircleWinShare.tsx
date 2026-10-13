import { useEffect, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { track } from '@/core/analytics/analytics';
import type { PersonalBest } from '@/features/insights/recap';
import { circleError, myCircles, postToCircle, type Circle } from './social';

export const prText = (prs: readonly PersonalBest[]) =>
  `New best${prs.length > 1 ? 's' : ''}: ${prs.slice(0, 2).map((p) => `${p.name} ${p.load} ${p.unit}`).join(', ')}${prs.length > 2 ? ` +${prs.length - 2} more` : ''} 🎉`.slice(0, 140);

/** After a workout with new bests: a tap to celebrate it with a circle. Never posts by itself. */
export function CircleWinShare({ prs }: { prs: readonly PersonalBest[] }) {
  const { mode, journal } = useJournal();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [posted, setPosted] = useState<Record<string, string>>({});
  useEffect(() => {
    if (mode !== 'account' || !prs.length) return;
    let live = true;
    void myCircles().then((c) => live && setCircles(c.filter((x) => x.members.find((m) => m.user_id === journal.ownerId)?.share_prs !== false)), () => undefined);
    return () => { live = false; };
  }, [mode, prs.length, journal.ownerId]);
  if (!prs.length) return null;
  const text = prText(prs);
  return (
    <div className="notice stack-sm" role="status">
      <strong>{text}</strong>
      {circles.map((c) => (
        <button key={c.id} className="btn sm secondary" disabled={!!posted[c.id]} onClick={() => void postToCircle(c.id, 'pr', text).then(
          () => { setPosted((p) => ({ ...p, [c.id]: 'Shared 🎉' })); track('circle_post', { kind: 'pr' }); },
          (e) => setPosted((p) => ({ ...p, [c.id]: circleError(e) })),
        )}>{posted[c.id] ?? `Share with ${c.name}`}</button>
      ))}
    </div>
  );
}
