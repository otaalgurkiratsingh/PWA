import { useMemo, useState } from 'react';
import type { MealPreset, Nutrients } from '@shared/contracts';
import { searchDishes, type Dish, type FoodDb } from '@shared/fooddb/foodDb';
import { useJournal } from '@/app/JournalContext';
import { goBack, navigate } from '@/app/router';
import { track } from '@/core/analytics/analytics';
import { Icon } from '@/core/design/icons';
import { Section, Sheet, Stepper } from '@/core/design/ui';
import { newId } from '@/core/ids';
import { buildRecipeMeal, cloneDish, computeRecipe, deltaLine, usableAsIngredient, type Ingredient, type RecipeSpec } from '@/domain/nutrition/recipeEngine';
import { useFoodDb } from './DishParts';
import { saveErrorMessage, useLibrary } from './useFood';

const fmt = (v: number | null, u = '') => (v === null ? '–' : `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}${u}`);

/** Route `recipe/new`, `recipe/from:<dishId>` ("Make it mine") or `recipe/<presetId>` (edit). */
export function RecipeBuilderScreen({ param }: { param: string | null }) {
  const { db, failed } = useFoodDb();
  const { data: lib } = useLibrary();
  if (failed) return <p className="muted">The food database couldn’t load. Try again when you’re back online.</p>;
  if (!db || !lib) return <div className="skeleton" style={{ height: 240 }} />;
  const existing = param && !param.startsWith('from:') && param !== 'new' ? lib.presets.find((p) => p.id === param && p.kind === 'recipe') ?? null : null;
  const from = param?.startsWith('from:') ? db.byId.get(param.slice(5)) ?? null : null;
  return <RecipeBuilder key={param ?? 'new'} db={db} existing={existing} from={from} />;
}

function RecipeBuilder({ db, existing, from }: { db: FoodDb; existing: MealPreset | null; from: Dish | null }) {
  const { journal, profile, refresh, notify } = useJournal();
  const { data: lib } = useLibrary();
  const initial: Pick<RecipeSpec, 'ingredients' | 'servings_count' | 'created_from'> = existing?.recipe
    ?? (from ? cloneDish(from) : { ingredients: [], servings_count: 1, created_from: null });
  const [name, setName] = useState(existing?.name ?? (from ? `My ${from.name.toLowerCase()}` : ''));
  const [ings, setIngs] = useState<Ingredient[]>(initial.ingredients);
  const [servings, setServings] = useState(initial.servings_count);
  const [adding, setAdding] = useState<'db' | 'custom' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const original = initial.created_from ? db.byId.get(initial.created_from) ?? null : null;
  const result = useMemo(() => computeRecipe({ ingredients: ings, servings_count: servings }, db), [ings, servings, db]);
  const delta = deltaLine(result, original);

  const setGrams = (i: number, g: number) => setIngs((x) => x.map((it, k) => (k === i ? { ...it, grams: Math.max(1, Math.min(5000, Math.round(g))) } : it)));
  const label = (it: Ingredient) => it.custom_name ?? db.byId.get(it.dish_id ?? '')?.name ?? 'Ingredient';

  const save = async () => {
    setError(null);
    try {
      const food = existing ? lib?.foods.find((f) => existing.items[0]?.kind === 'food' && f.id === existing.items[0].food_version_id) ?? null : null;
      const built = buildRecipeMeal({
        name, spec: { ingredients: ings, servings_count: servings, created_from: initial.created_from ?? null }, db, ownerId: journal.ownerId,
        now: new Date().toISOString(), newId, synthetic: profile.synthetic, existing: existing ? { preset: existing, food } : null,
      });
      await journal.commit('foods', built.food);
      const prev = await journal.db.get('presets', built.preset.id);
      await journal.commit('presets', { ...built.preset, local_version: prev?.local_version ?? 0 });
      refresh();
      if (!existing) track('recipe_created', { ingredients: ings.length, servings, from_dish: initial.created_from ?? undefined, partial: result.partial });
      notify({ kind: 'info', message: `Saved “${built.preset.name}” to My recipes.` });
      goBack('food');
    } catch (e) {
      setError(e instanceof Error ? e.message : saveErrorMessage(e));
    }
  };

  const remove = async () => {
    if (!existing) return;
    await journal.remove('presets', existing);
    refresh();
    notify({ kind: 'info', message: 'Recipe deleted. Past logs keep their numbers.' });
    navigate('food');
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('food')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">{existing ? 'Edit my recipe' : from ? 'Make it mine' : 'Create your own recipe'}</h1>
      </div>

      <label className="field">Recipe name<input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. My rajma, less oil" /></label>

      <Section title="Ingredients">
        <div className="stack-sm">
          {ings.length === 0 ? <p className="small muted">Start from a dish in the food database, or add your own ingredient with its label values.</p> : null}
          {ings.map((it, i) => (
            <div key={i} className="card tight flat ingredient-row">
              <div className="row" style={{ gap: 8 }}>
                <span className="grow" style={{ minWidth: 0 }}><strong>{label(it)}</strong>{it.custom_name ? <span className="small muted"> · yours{it.custom_per_100g ? '' : ' (no values)'}</span> : null}</span>
                <button className="icon-btn plain" aria-label={`Remove ${label(it)}`} onClick={() => setIngs((x) => x.filter((_, k) => k !== i))}><Icon name="trash" size={18} /></button>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Stepper label={`${label(it)} grams`} value={`${it.grams} g`} decLabel="10 g less" incLabel="10 g more" onDec={() => setGrams(i, it.grams - 10)} onInc={() => setGrams(i, it.grams + 10)} disabledDec={it.grams <= 10} />
                <input className="input num" style={{ width: 90 }} inputMode="numeric" aria-label={`${label(it)} exact grams`} value={it.grams}
                  onChange={(e) => { const g = Number(e.target.value.replace(/[^\d]/g, '')); if (g > 0) setGrams(i, g); }} />
              </div>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setAdding('db')}><Icon name="search" size={16} /> Add from food database</button>
            <button className="btn sm secondary" onClick={() => setAdding('custom')}><Icon name="plus" size={16} /> My own ingredient</button>
          </div>
        </div>
      </Section>

      <Section title="Servings">
        <Stepper label="Servings this recipe makes" value={`${servings} serving${servings === 1 ? '' : 's'}`} onDec={() => setServings((s) => Math.max(1, s - 1))} onInc={() => setServings((s) => Math.min(50, s + 1))} disabledDec={servings <= 1} />
      </Section>

      <div className="card recipe-preview" aria-live="polite">
        <span className="eyebrow">Per serving{result.totalGrams ? ` (${Math.round(result.totalGrams / servings)} g)` : ''}</span>
        <div className="macro-grid big">
          <span><b className="num">{fmt(result.perServing.kcal)}</b> kcal</span>
          <span><b className="num">{fmt(result.perServing.protein_g, ' g')}</b> protein</span>
          <span><b className="num">{fmt(result.perServing.carbs_g, ' g')}</b> carbs</span>
          <span><b className="num">{fmt(result.perServing.fat_g, ' g')}</b> fat</span>
          <span><b className="num">{fmt(result.perServing.fiber_g, ' g')}</b> fibre</span>
        </div>
        {delta ? <p className="delta-line">{delta}</p> : null}
        {result.partial ? <p className="small muted">Partial: no values for {result.unknown.join(', ')}. Add label values for an exact number.</p> : null}
      </div>

      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <div className="stack-sm">
        <button className="btn block" disabled={!ings.length} onClick={() => void save()}>{existing ? 'Save changes' : 'Save to My recipes'}</button>
        {existing ? <button className="btn ghost block" style={{ color: 'var(--danger)' }} onClick={() => void remove()}>Delete recipe</button> : null}
      </div>

      {adding === 'db' ? <DbIngredientSheet db={db} onClose={() => setAdding(null)} onPick={(d) => { setIngs((x) => [...x, { dish_id: d.id, custom_name: null, grams: d.serving_g ?? 100 }]); setAdding(null); }} /> : null}
      {adding === 'custom' ? <CustomIngredientSheet onClose={() => setAdding(null)} onAdd={(it) => { setIngs((x) => [...x, it]); setAdding(null); }} /> : null}
    </div>
  );
}

function DbIngredientSheet({ db, onPick, onClose }: { db: FoodDb; onPick: (d: Dish) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchDishes(db, q, { limit: 60 }).map((h) => h.dish).filter(usableAsIngredient), [db, q]);
  return (
    <Sheet title="Add from food database" onClose={onClose} full>
      <div className="stack">
        <input className="input" type="search" aria-label="Search the food database" placeholder="paneer, roti, dal…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list-divided">
          {hits.map((d) => (
            <button key={d.id} className="ex-row" onClick={() => onPick(d)}>
              <span className="grow"><span className="er-name">{d.name}</span><br /><span className="er-sub">{fmt(per100k(d))} kcal per 100 g · starts at {d.serving_g ?? 100} g</span></span>
              <Icon name="plus" />
            </button>
          ))}
          {!hits.length ? <p className="small muted">Nothing matches. Add it as your own ingredient instead.</p> : null}
        </div>
      </div>
    </Sheet>
  );
}
const per100k = (d: Dish) => d.per_100g?.kcal ?? (d.per_serving && d.serving_g ? (d.per_serving.kcal! * 100) / d.serving_g : null);

function CustomIngredientSheet({ onAdd, onClose }: { onAdd: (i: Ingredient) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [v, setV] = useState({ energy_kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' });
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const g = Number(grams);
  const anyValue = Object.values(v).some((x) => x.trim() !== '');
  const per: Nutrients | null = anyValue ? { energy_kcal: num(v.energy_kcal), protein_g: num(v.protein_g), carbs_g: num(v.carbs_g), fat_g: num(v.fat_g), fiber_g: num(v.fiber_g) } : null;
  const ok = name.trim().length > 0 && g > 0 && g <= 5000 && (!per || Object.values(per).every((x) => x === null || (Number.isFinite(x) && x >= 0 && x <= 1000)));
  const f = (k: keyof typeof v, l: string) => <label className="field">{l}<input className="input num" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>;
  return (
    <Sheet title="My own ingredient" onClose={onClose} actions={<button className="btn block" disabled={!ok} onClick={() => onAdd({ dish_id: null, custom_name: name.trim().slice(0, 60), grams: g, custom_per_100g: per })}>Add ingredient</button>}>
      <div className="stack">
        <label className="field">Name<input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mustard oil" /></label>
        <label className="field">Grams in the whole recipe<input className="input num" inputMode="numeric" value={grams} onChange={(e) => setGrams(e.target.value.replace(/[^\d]/g, ''))} /></label>
        <p className="small muted">Per 100 g from the package label (optional — leave blank if you don’t know; the total then shows as partial).</p>
        <div className="metrics">{f('energy_kcal', 'Calories')}{f('protein_g', 'Protein (g)')}{f('carbs_g', 'Carbs (g)')}{f('fat_g', 'Fat (g)')}{f('fiber_g', 'Fibre (g)')}</div>
      </div>
    </Sheet>
  );
}
