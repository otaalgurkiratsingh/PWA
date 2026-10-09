import { useState } from 'react';
import type { MealPreset } from '@shared/contracts';
import { FoodIcon } from '@/core/design/icons';
import { Sheet } from '@/app/Sheet';
import { describeQuantity } from './mealActions';
import { useMealLogging } from './useMeals';

export function MealTiles({ presets }: { presets: MealPreset[] }) {
  const { logPreset, ready } = useMealLogging();
  const [adjust, setAdjust] = useState<MealPreset | null>(null);
  const [mult, setMult] = useState(1);
  const [flash, setFlash] = useState<string | null>(null);

  const quick = async (p: MealPreset) => {
    setFlash(p.id);
    await logPreset(p, 1);
    window.setTimeout(() => setFlash(null), 300);
  };

  const step = adjust ? adjust.quantity_step / (adjust.items[0]?.default_quantity ?? 1) : 1;

  return (
    <>
      <div className="tile-grid">
        {presets.map((p) => (
          <div key={p.id} className={`tile${flash === p.id ? ' flash' : ''}`}>
            <button className="tile-main" onClick={() => quick(p)} disabled={!ready} aria-label={`Log ${p.name}, ${describeQuantity(p, 1)}`}>
              <span className="tile-art"><FoodIcon name={p.icon} /></span>
              <span className="tile-name">{p.name}</span>
              <span className="tile-meta">{describeQuantity(p, 1)} · tap to log</span>
            </button>
            <div className="tile-foot">
              <button onClick={() => { setAdjust(p); setMult(1); }} aria-label={`Choose amount for ${p.name}`}>
                Amount…
              </button>
            </div>
          </div>
        ))}
      </div>
      {adjust ? (
        <Sheet title={`How much ${adjust.name}?`} onClose={() => setAdjust(null)}>
          <div className="stepper">
            <button className="icon-btn" aria-label="Less" onClick={() => setMult((m) => Math.max(step, Math.round((m - step) * 100) / 100))}>−</button>
            <output aria-live="polite">{describeQuantity(adjust, mult)}</output>
            <button className="icon-btn" aria-label="More" onClick={() => setMult((m) => Math.min(10, Math.round((m + step) * 100) / 100))}>+</button>
          </div>
          <p className="muted small" style={{ textAlign: 'center' }}>
            Uses your calibrated portion: {adjust.items.map((i) => `1 ${i.unit_label} = ${i.grams_per_unit} g`).join(', ')}.
          </p>
          <button className="btn block" onClick={async () => { const p = adjust; setAdjust(null); await logPreset(p, mult); }}>
            Log {describeQuantity(adjust, mult)}
          </button>
        </Sheet>
      ) : null}
    </>
  );
}

export function QuickTiles({ presets }: { presets: MealPreset[] }) {
  const { logPreset, ready } = useMealLogging();
  return (
    <div className="quick-tiles">
      {presets.map((p) => (
        <button key={p.id} className="quick-tile" onClick={() => logPreset(p, 1)} disabled={!ready} aria-label={`Log ${p.name}, ${describeQuantity(p, 1)}`}>
          <span className="tile-art"><FoodIcon name={p.icon} size={24} /></span>
          <span>
            {p.name}
            <br />
            <span className="muted small">{describeQuantity(p, 1)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
