import { useEffect, useMemo, useState } from 'react';
import { loadIngredients, searchIngredients, type Ingredient } from '@shared/catalogue/ingredients';
import { Icon } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';
import { newId } from '@/core/ids';
import type { IngredientForm } from './mealBuilder';

const str = (v: number | null) => (v === null ? '' : String(Math.round(v * 100) / 100));

/** An ingredient from the list, ready to weigh: standard values per 100 g already filled in. */
export function ingredientForm(i: Ingredient): IngredientForm {
  return {
    key: newId(), food_version_id: null, name: i.name, state: i.state, grams: '',
    per100: { energy_kcal: str(i.per_100g.energy_kcal), protein_g: str(i.per_100g.protein_g), carbs_g: str(i.per_100g.carbs_g), fat_g: str(i.per_100g.fat_g), fiber_g: str(i.per_100g.fiber_g) },
    source_kind: i.source.startsWith('cnf') ? 'cnf' : 'usda_fdc', source_ref: i.record,
  };
}

export function IngredientPicker({ onPick, onClose }: { onPick: (i: Ingredient) => void; onClose: () => void }) {
  const [all, setAll] = useState<Ingredient[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    loadIngredients().then((x) => live && setAll(x), () => live && setFailed(true));
    return () => { live = false; };
  }, []);
  const shown = useMemo(() => (all ? searchIngredients(all, q) : []), [all, q]);
  return (
    <Sheet title="Add an ingredient" onClose={onClose} full>
      <div className="stack">
        <input className="input" type="search" aria-label="Search ingredients" placeholder="atta, ghee, onion, paneer…" value={q} onChange={(e) => setQ(e.target.value)} />
        {failed ? <p className="small muted">The ingredient list couldn’t load. Add the ingredient by hand instead.</p> : !all ? <div className="skeleton" /> : (
          <div className="list-divided">
            {shown.map((i) => (
              <button key={i.id} className="ex-row" onClick={() => onPick(i)} aria-label={`${i.name}, ${Math.round(i.per_100g.energy_kcal ?? 0)} kcal per 100 g`}>
                <span className="grow">
                  <span className="er-name">{i.name}</span><br />
                  <span className="er-sub">{Math.round(i.per_100g.energy_kcal ?? 0)} kcal · {Math.round(i.per_100g.protein_g ?? 0)} g protein per 100 g · {i.state === 'dry' ? 'dry' : i.state === 'raw' ? 'raw' : 'as sold'}</span>
                </span>
                <Icon name="plus" size={20} />
              </button>
            ))}
            {q && !shown.length ? <p className="small muted" style={{ padding: '8px 0' }}>No match. Use “Add ingredient” to type its label values.</p> : null}
          </div>
        )}
        <p className="label">Standard values per 100 g from the Canadian Nutrient File (Health Canada, 2026; paneer from USDA). Weigh each ingredient for your batch.</p>
      </div>
    </Sheet>
  );
}
