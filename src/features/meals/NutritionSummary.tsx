import type { MealEntry, Targets } from '@shared/contracts';
import { formatTotal, totalsOfEntries, type NutrientTotal } from '@/domain/nutrition/calc';

function Meter({ label, total, unit, target }: { label: string; total: NutrientTotal; unit: string; target: number | null }) {
  const pct = target && total.value !== null ? Math.min(100, (total.value / target) * 100) : 0;
  const valueText = formatTotal(total, unit);
  return (
    <div className={`meter${total.complete ? '' : ' partial'}`}>
      <div className="label-row">
        <span>{label}</span>
        <span className="muted">{target ? `Target ${target.toLocaleString('en-US')} ${unit}` : 'No target set'}</span>
      </div>
      <div className="value">{valueText}</div>
      {target ? (
        <div
          className="track"
          role="progressbar"
          aria-label={`${label} logged versus target`}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={Math.round(total.value ?? 0)}
          aria-valuetext={`${valueText} of ${target} ${unit}${total.complete ? '' : ', partial'}`}
        >
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function NutritionSummary({ entries, targets, dayComplete }: { entries: MealEntry[]; targets: Targets | null; dayComplete: boolean | null }) {
  const totals = totalsOfEntries(entries);
  const anyEstimated = entries.some((e) => e.items.some((i) => i.estimated));
  const anySynthetic = entries.some((e) => e.synthetic || e.items.some((i) => i.source_kinds.includes('synthetic_demo')));
  const anyUnknown = !totals.energy_kcal.complete || !totals.protein_g.complete;
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 4 }}>
        {entries.length === 0 ? <span className="badge">Nothing logged yet</span> : null}
        {anyEstimated ? <span className="badge est">Estimate</span> : null}
        {anySynthetic ? <span className="badge demo">Demo values</span> : null}
        {anyUnknown ? <span className="badge unknown">Some items unknown</span> : null}
        {dayComplete ? <span className="badge ok">Day marked complete</span> : entries.length ? <span className="badge">Partial day</span> : null}
      </div>
      <Meter label="Energy logged" total={totals.energy_kcal} unit="kcal" target={targets?.energy_kcal ?? null} />
      <Meter label="Protein logged" total={totals.protein_g} unit="g" target={targets?.protein_g ?? null} />
      <p className="muted small" style={{ margin: '4px 0 0' }}>
        {dayComplete
          ? 'You marked today complete.'
          : 'Totals cover only what is logged. Unlogged food is unknown, not zero.'}
        {anyUnknown ? ' “≥” means some items have unknown values.' : ''}
        {targets ? ` Target source: ${targets.source}.` : ''}
      </p>
    </div>
  );
}
