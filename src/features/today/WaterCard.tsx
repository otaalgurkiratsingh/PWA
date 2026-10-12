import { useJournal, useQuery } from '@/app/JournalContext';
import { Icon } from '@/core/design/icons';
import { saveErrorMessage } from '@/features/food/useFood';

const GLASS_ML = 250;
const GOAL_ML = 2000;

/** One-tap water: a glass is 250 ml; the day's total is a manual daily health entry. */
export function WaterCard() {
  const { journal, profile, today, refresh, notify } = useJournal();
  const row = useQuery((j) => j.db.get('daily_health', `water_ml:${today}`), [today]);
  const ml = row?.value ?? 0;
  const glasses = Math.round(ml / GLASS_ML);
  const set = async (next: number) => {
    const nowIso = new Date().toISOString();
    try {
      await journal.commit('daily_health', { id: `water_ml:${today}`, owner_id: journal.ownerId, metric: 'water_ml', local_date: today, timezone: profile.timezone, value: Math.max(0, Math.min(10000, next)), source: 'manual', recorded_at: nowIso, synthetic: profile.synthetic });
      refresh();
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  const litres = (v: number) => `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} L`;
  return (
    <div className="card water" role="region" aria-label="Water today">
      <div className="row" style={{ gap: 12 }}>
        <span className="grow">
          <span className="eyebrow">Water</span>
          <span className="water-total"><b className="num">{litres(ml)}</b> of {litres(GOAL_ML)}</span>
        </span>
        <button className="icon-btn" aria-label="Remove a glass" disabled={ml <= 0} onClick={() => void set(ml - GLASS_ML)}><Icon name="minus" /></button>
        <button className="icon-btn filled" aria-label="Add a glass of water (250 ml)" onClick={() => void set(ml + GLASS_ML)}><Icon name="plus" /></button>
      </div>
      <div className="glasses" aria-hidden="true">
        {Array.from({ length: GOAL_ML / GLASS_ML }, (_, i) => <span key={i} className={`glass${i < glasses ? ' full' : ''}`} />)}
      </div>
    </div>
  );
}
