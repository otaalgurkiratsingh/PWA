import { ATTRIBUTION, sourceLine } from '@shared/fooddb/foodDb';
import { goBack } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { Section } from '@/core/design/ui';
import { useFoodDb } from './DishParts';

/**
 * Internal verification list (T2): dishes that are NOT in search — Tier 2 (macros incomplete) and
 * quarantined items awaiting the owner's approval. Read-only; nothing here can be logged.
 */
export function DataReviewScreen() {
  const { db } = useFoodDb();
  if (!db) return <div className="skeleton" style={{ height: 200 }} />;
  const quarantined = db.pending.filter((d) => d.needs_review);
  const tier2 = db.pending.filter((d) => !d.needs_review);
  const missing = (d: (typeof tier2)[number]) => (['carbs_g', 'fat_g', 'fiber_g'] as const).filter((k) => d.per_serving?.[k] === null || d.per_serving?.[k] === undefined).join(', ');
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('settings')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Data verification</h1>
      </div>
      <p className="small muted">{db.publicDishes.length} dishes are live in search. These {db.pending.length} are hidden until their data is complete or approved. They never appear in search.</p>
      <Section title={`Pending approval (${quarantined.length})`}>
        <div className="card tight list-divided">
          {quarantined.map((d) => <div key={d.id} className="review-row"><strong>{d.name}</strong><span className="small muted">Quarantined: published value under review. {sourceLine(d)}</span></div>)}
        </div>
      </Section>
      <Section title={`Verifying (${tier2.length})`}>
        <div className="card tight list-divided">
          {tier2.map((d) => <div key={d.id} className="review-row"><strong>{d.name}</strong><span className="small muted">Missing: {missing(d) || 'values'} · {d.serving_label}</span></div>)}
        </div>
      </Section>
      <p className="label">{ATTRIBUTION}</p>
    </div>
  );
}
