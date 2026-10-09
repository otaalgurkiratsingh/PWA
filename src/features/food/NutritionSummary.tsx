import { useState } from 'react';
import type { MealEntry, Targets } from '@shared/contracts';
import { totalsOfEntries, type NutrientTotal } from '@/domain/nutrition/calc';
import { Icon } from '@/core/design/icons';

function value(t: NutrientTotal, unit: string) {
  if (t.value === null) return <span className="muted">Not logged</span>;
  return (
    <>
      {t.complete ? '' : '≥ '}
      {Math.round(t.value).toLocaleString('en-US')}
      <small> {unit}</small>
    </>
  );
}

function Bar({ label, total, unit, target }: { label: string; total: NutrientTotal; unit: string; target: number | null }) {
  const pct = target && total.value !== null ? Math.min(100, (total.value / target) * 100) : 0;
  return (
    <div className="bar-meter food">
      <div className="bm-top">
        <span className="label" style={{ fontWeight: 600 }}>{label}</span>
        <span className="label">{target ? `of ${target.toLocaleString('en-US')} ${unit}` : ''}</span>
      </div>
      <div className="bm-value num">{value(total, unit)}</div>
      {target ? (
        <div className="bm-track" role="progressbar" aria-label={`${label} compared with your target`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(total.value ?? 0)}>
          <div className="bm-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** Energy and protein first; other macros on demand. Partial and unknown values are never shown as zero. */
export function NutritionSummary({ entries, targets, dayComplete, compact = false }: {
  entries: MealEntry[];
  targets: Targets | null;
  dayComplete: boolean;
  compact?: boolean;
}) {
  const [more, setMore] = useState(false);
  const t = totalsOfEntries(entries);
  const unknownSome = entries.length > 0 && (!t.energy_kcal.complete || !t.protein_g.complete);
  const estimated = entries.some((e) => e.items.some((i) => i.estimated));
  const note = entries.length === 0
    ? 'Nothing logged yet today.'
    : dayComplete
      ? 'You marked today as fully logged.'
      : 'Based on logged meals — some meals may be missing.';
  return (
    <div className="stack-sm">
      <div className="metrics" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Bar label="Energy" total={t.energy_kcal} unit="kcal" target={targets?.energy_kcal ?? null} />
        <Bar label="Protein" total={t.protein_g} unit="g" target={targets?.protein_g ?? null} />
      </div>
      <div className="row between wrap">
        <span className="small muted">
          {note}
          {unknownSome ? ' Some items have no nutrition yet.' : ''}
          {estimated && entries.length ? ' Values are estimates.' : ''}
        </span>
        {!compact ? (
          <button className="link" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'Less' : 'More'} <Icon name={more ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        ) : null}
      </div>
      {more && !compact ? (
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {([['Carbs', t.carbs_g], ['Fat', t.fat_g], ['Fibre', t.fiber_g]] as const).map(([l, v]) => (
            <div key={l} className="metric" style={{ minHeight: 0 }}>
              <span className="m-label">{l}</span>
              <span className="m-value" style={{ fontSize: '1.125rem' }}>{value(v, 'g')}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
