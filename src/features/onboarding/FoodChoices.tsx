import { useMemo, useState } from 'react';
import type { FoodPreferences } from '@shared/contracts';
import { searchCatalogue, type CatalogueFood } from '@shared/catalogue/catalogue';
import { CatalogueArt } from '@/core/design/catalogueArt';
import { Icon } from '@/core/design/icons';
import { WEEKDAY_SHORT } from '@/domain/training/plan';
import { visibleFor } from '@/features/food/catalogueFood';
import { useCatalogue } from '@/features/food/useCatalogue';

export const PATTERNS: { value: FoodPreferences['pattern']; label: string }[] = [
  { value: 'unspecified', label: 'Prefer not to say' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'eggetarian', label: 'Vegetarian + eggs' },
  { value: 'pescatarian', label: 'Vegetarian + fish' },
  { value: 'everything', label: 'I eat meat' },
];

/** The person's own food choices. Nothing is assumed from background; everything is optional. */
export function FoodPrefsFields({ value, onChange }: { value: { pattern: FoodPreferences['pattern']; meatless: number[]; allergies: string }; onChange: (v: { pattern: FoodPreferences['pattern']; meatless: number[]; allergies: string }) => void }) {
  return (
    <div className="stack">
      <label className="field">What you eat (optional)
        <select className="select" value={value.pattern} onChange={(e) => onChange({ ...value, pattern: e.target.value as FoodPreferences['pattern'] })}>
          {PATTERNS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {value.pattern !== 'vegetarian' ? (
        <div className="stack-sm">
          <span className="label" style={{ fontWeight: 600 }}>Days without meat, fish or eggs (optional)</span>
          <div className="chips wrap" role="group" aria-label="Days without meat, fish or eggs">
            {WEEKDAY_SHORT.map((d, i) => (
              <button key={d} className="chip" aria-pressed={value.meatless.includes(i)} onClick={() => onChange({ ...value, meatless: value.meatless.includes(i) ? value.meatless.filter((x) => x !== i) : [...value.meatless, i].sort() })}>{d}</button>
            ))}
          </div>
        </div>
      ) : null}
      <label className="field">Allergies you’ve confirmed (optional)
        <input className="input" value={value.allergies} maxLength={300} placeholder="e.g. peanuts, sesame" onChange={(e) => onChange({ ...value, allergies: e.target.value })} />
      </label>
      <span className="label">Used only to choose what the food list shows first. The app can’t confirm what’s in a dish, so always check ingredients.</span>
    </div>
  );
}

export const allergyList = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20).map((x) => x.slice(0, 60));

/** Choose 5–15 usual foods from the catalogue (starters first, then search). */
export function UsualFoodsPicker({ selected, onChange, prefs }: { selected: string[]; onChange: (ids: string[]) => void; prefs: { pattern: string; meatless_weekdays: number[] } }) {
  const { index, failed } = useCatalogue();
  const [q, setQ] = useState('');
  const shown = useMemo<CatalogueFood[]>(() => {
    if (!index) return [];
    const pool = q.trim() ? searchCatalogue(index, q, { limit: 40 }) : index.foods.filter((f) => f.priority === 'starter');
    // Hide only by the person's own stated pattern; meat-free weekdays don't apply to "usual foods".
    return pool.filter((f) => visibleFor(f, { pattern: prefs.pattern, meatless_weekdays: [] }, -1) || selected.includes(f.id));
  }, [index, q, prefs.pattern, selected]);
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length < 15) onChange([...selected, id]);
  };
  if (failed) return <p className="small muted">The food list couldn’t load. You can add foods later from the Food tab.</p>;
  return (
    <div className="stack">
      <input className="input" type="search" placeholder="Search foods: roti, dal, chai…" aria-label="Search foods" value={q} onChange={(e) => setQ(e.target.value)} />
      <span className="label" aria-live="polite">{selected.length} chosen · pick 5 to 15 (you can skip and add later)</span>
      {!index ? <div className="skeleton" /> : (
        <div className="food-pick-grid">
          {shown.map((f) => {
            const on = selected.includes(f.id);
            return (
              <button key={f.id} className="choice food-pick" aria-pressed={on} onClick={() => toggle(f.id)} disabled={!on && selected.length >= 15}>
                <span className="fp-art"><CatalogueArt id={f.id} size={56} /></span>
                <span className="small" style={{ fontWeight: 600 }}>{f.name}</span>
                {on ? <span className="fp-check" aria-hidden="true"><Icon name="check" size={16} /></span> : null}
              </button>
            );
          })}
          {shown.length === 0 ? <p className="small muted">No foods match. You can create your own meals later.</p> : null}
        </div>
      )}
      {selected.length && index ? (
        <div className="chips wrap" aria-label="Chosen foods">
          {selected.map((id) => <button key={id} className="chip" aria-pressed="true" onClick={() => toggle(id)} aria-label={`Remove ${index.byId.get(id)?.name ?? id}`}>{index.byId.get(id)?.name ?? id} <Icon name="close" size={14} /></button>)}
        </div>
      ) : null}
    </div>
  );
}
