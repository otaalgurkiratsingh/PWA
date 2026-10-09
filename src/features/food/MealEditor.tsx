import { useMemo, useState } from 'react';
import type { FoodVersion, MealPreset, PreparationState, SourceKind } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { newId } from '@/core/ids';
import { ART_CHOICES, FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { PhotoCropper } from '@/core/design/PhotoCropper';
import { Section, Segmented, Sheet, Toggle } from '@/core/design/ui';
import { batchNutrients, formatTotal, portionNutrients } from '@/domain/nutrition/calc';
import { buildMeal, emptyMealForm, emptyNutrients, formFromPreset, nutrientsFrom, UNIT_OPTIONS, validateMealForm, type IngredientForm, type MealForm, type NutrientForm } from './mealBuilder';
import { MEAL_DRAFT_KEY } from './PhotoSheet';
import { saveBuiltMeal, saveErrorMessage, useLibrary } from './useFood';

const STATES: { value: PreparationState; label: string }[] = [
  { value: 'raw', label: 'Raw' }, { value: 'dry', label: 'Dry' }, { value: 'cooked', label: 'Cooked' }, { value: 'as_sold', label: 'As sold' },
];
const SOURCES: { value: SourceKind; label: string }[] = [
  { value: 'label', label: 'Package label' },
  { value: 'usda_fdc', label: 'USDA FoodData Central' },
  { value: 'generic_assumption', label: 'General estimate' },
  { value: 'unknown', label: 'Not sure yet' },
];

function NutrientFields({ value, onChange, idPrefix }: { value: NutrientForm; onChange: (v: NutrientForm) => void; idPrefix: string }) {
  const f = (k: keyof NutrientForm, label: string, unit: string) => (
    <label className="field" key={k}>
      {label} <span className="label">({unit} per 100 g)</span>
      <input id={`${idPrefix}-${k}`} className="input num" inputMode="decimal" placeholder="Unknown" value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="metrics">
      {f('energy_kcal', 'Energy', 'kcal')}
      {f('protein_g', 'Protein', 'g')}
      {f('carbs_g', 'Carbs', 'g')}
      {f('fat_g', 'Fat', 'g')}
      {f('fiber_g', 'Fibre', 'g')}
    </div>
  );
}

function IngredientEditor({ ing, foods, onChange, onRemove }: { ing: IngredientForm; foods: FoodVersion[]; onChange: (i: IngredientForm) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!ing.food_version_id && !ing.name);
  return (
    <div className="card tight flat stack-sm">
      <div className="row">
        <input className="input grow" aria-label="Ingredient name" placeholder="Ingredient" value={ing.name} disabled={Boolean(ing.food_version_id)} onChange={(e) => onChange({ ...ing, name: e.target.value })} />
        <input className="input num" style={{ width: 92 }} aria-label={`${ing.name || 'Ingredient'} grams`} inputMode="decimal" placeholder="g" value={ing.grams} onChange={(e) => onChange({ ...ing, grams: e.target.value })} />
        <button className="icon-btn plain" aria-label={`Remove ${ing.name || 'ingredient'}`} onClick={onRemove}><Icon name="trash" size={18} /></button>
      </div>
      <Segmented label={`${ing.name || 'Ingredient'} state`} value={ing.state} full onChange={(v) => onChange({ ...ing, state: v })} options={STATES} />
      {ing.food_version_id ? (
        <span className="label">Uses your saved “{foods.find((f) => f.id === ing.food_version_id)?.name}” values.</span>
      ) : (
        <>
          <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Nutrition per 100 g <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} /></button>
          {open ? (
            <>
              <NutrientFields value={ing.per100} onChange={(per100) => onChange({ ...ing, per100 })} idPrefix={`ing-${ing.key}`} />
              <select className="select" aria-label="Where these numbers come from" value={ing.source_kind} onChange={(e) => onChange({ ...ing, source_kind: e.target.value as SourceKind })}>
                {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function initialForm(existing: ReturnType<typeof formFromPreset> | null): MealForm {
  if (existing) return existing;
  let draft: { name?: string; photo?: string | null } = {};
  try {
    draft = JSON.parse(sessionStorage.getItem(MEAL_DRAFT_KEY) ?? '{}');
    sessionStorage.removeItem(MEAL_DRAFT_KEY);
  } catch {
    // no draft
  }
  return { ...emptyMealForm(), name: draft.name ?? '', photo: draft.photo ?? null };
}

export function MealEditor({ presetId }: { presetId: string | null }) {
  const { data: lib, nutrition } = useLibrary();
  if (!lib || !nutrition) return <div className="skeleton" style={{ minHeight: 320 }} />;
  const existing = presetId && presetId !== 'new' ? lib.presets.find((p) => p.id === presetId) ?? null : null;
  if (presetId && presetId !== 'new' && !existing) return <p className="muted">That meal no longer exists.</p>;
  return <MealEditorForm key={existing?.id ?? 'new'} existing={existing} initial={initialForm(existing ? formFromPreset(existing, nutrition.foods, nutrition.recipes) : null)} />;
}

function MealEditorForm({ existing, initial }: { existing: MealPreset | null; initial: MealForm }) {
  const { journal, profile, notify, refresh } = useJournal();
  const { data: lib, nutrition } = useLibrary();
  const [form, setForm] = useState<MealForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const preview = useMemo(() => {
    const g = Number(form.grams_per_unit) * Number(form.default_quantity);
    if (!(g > 0)) return null;
    try {
      if (form.kind === 'food') {
        const per = nutrientsFrom(form.per100);
        if (typeof per === 'string') return null;
        return { e: per.energy_kcal === null ? null : (per.energy_kcal * g) / 100, p: per.protein_g === null ? null : (per.protein_g * g) / 100, complete: per.energy_kcal !== null };
      }
      const foods = new Map(nutrition?.foods ?? []);
      const ings = form.ingredients.map((i) => {
        let id = i.food_version_id;
        if (!id) {
          const per = nutrientsFrom(i.per100);
          if (typeof per === 'string') throw new Error('bad');
          id = `tmp-${i.key}`;
          foods.set(id, { id, per_100g: per, preparation_state: i.state, name: i.name } as FoodVersion);
        }
        return { food_version_id: id, grams: Number(i.grams), state: i.state };
      });
      const y = Number(form.cooked_yield_g);
      if (!(y > 0) || ings.some((i) => !(i.grams > 0))) return null;
      const portion = portionNutrients(batchNutrients({ ingredients: ings } as never, foods), g, y);
      return { e: portion.energy_kcal.value, p: portion.protein_g.value, complete: portion.energy_kcal.complete };
    } catch {
      return null;
    }
  }, [form, nutrition]);

  if (!lib) return <div className="skeleton" style={{ minHeight: 320 }} />;
  const set = (patch: Partial<MealForm>) => setForm({ ...form, ...patch });

  const save = async () => {
    const errs = validateMealForm(form);
    setErrors(errs);
    if (errs.length || !nutrition) return;
    try {
      const r = buildMeal({ form, ownerId: journal.ownerId, now: new Date().toISOString(), newId, synthetic: profile.synthetic, foods: nutrition.foods, recipes: nutrition.recipes, existing });
      await saveBuiltMeal(journal, r);
      refresh();
      notify({ kind: 'info', message: r.newRevision ? `Saved ${r.preset.name}. Meals you logged before keep their old values.` : `Saved ${r.preset.name}` });
      goBack('food');
    } catch (e) {
      setErrors([saveErrorMessage(e)]);
    }
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <button className="btn ghost" onClick={() => goBack('food')}><Icon name="chevronLeft" size={18} /> Back</button>
        <button className="btn" onClick={save}>Save meal</button>
      </div>

      <div className="row" style={{ gap: 16 }}>
        <span style={{ width: 96, height: 96, borderRadius: 22, background: 'var(--food)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
          <FoodArt icon={form.icon} photo={form.photo} size={96} label={form.name} />
        </span>
        <div className="grow stack-sm">
          <label className="field">
            Meal name
            <input className="input" value={form.name} maxLength={60} placeholder="e.g. Dal tadka" onChange={(e) => set({ name: e.target.value })} />
          </label>
        </div>
      </div>

      <Section title="Picture">
        <div className="chips" role="group" aria-label="Choose an illustration">
          {ART_CHOICES.map((a) => (
            <button key={a.key} className="chip" aria-pressed={!form.photo && form.icon === a.key} onClick={() => set({ icon: a.key, photo: null })} style={{ paddingLeft: 6 }}>
              <FoodArt icon={a.key} size={30} /> {a.label}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <button className="btn secondary sm" onClick={() => setPhotoOpen(true)}><Icon name="camera" size={18} /> {form.photo ? 'Change my photo' : 'Use my own photo'}</button>
          {form.photo ? <button className="btn ghost sm" onClick={() => set({ photo: null })}>Remove photo</button> : null}
        </div>
        <Toggle label="Favourite" description="Shown first in your usual meals" checked={form.favorite} onChange={(v) => set({ favorite: v })} />
      </Section>

      <Section title="Usual portion">
        <div className="metrics">
          <label className="field">
            Unit
            <select className="select" value={form.unit_label} onChange={(e) => set({ unit_label: e.target.value })}>
              {[...new Set([form.unit_label, ...UNIT_OPTIONS])].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="field">
            1 {form.unit_label} weighs (g)
            <input className="input num" inputMode="decimal" value={form.grams_per_unit} onChange={(e) => set({ grams_per_unit: e.target.value })} placeholder="e.g. 180" />
          </label>
          <label className="field">
            Usual amount
            <input className="input num" inputMode="decimal" value={form.default_quantity} onChange={(e) => set({ default_quantity: e.target.value })} />
          </label>
          <label className="field">
            Change by
            <select className="select" value={form.quantity_step} onChange={(e) => set({ quantity_step: e.target.value })}>
              {['0.25', '0.5', '1'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <p className="label">Weigh your usual {form.unit_label} once on a kitchen scale for the best estimate.</p>
      </Section>

      <Section title="Nutrition">
        <Segmented label="Nutrition comes from" value={form.kind} full onChange={(kind) => set({ kind })} options={[{ value: 'food', label: 'A label or food' }, { value: 'recipe', label: 'My recipe' }]} />
        {form.kind === 'food' ? (
          <div className="stack-sm">
            <Segmented label="State" value={form.preparation_state} full onChange={(v) => set({ preparation_state: v })} options={STATES} />
            <NutrientFields value={form.per100} onChange={(per100) => set({ per100 })} idPrefix="food" />
            <div className="metrics">
              <label className="field">
                Source
                <select className="select" value={form.source_kind} onChange={(e) => set({ source_kind: e.target.value as SourceKind })}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="field">
                Reference (optional)
                <input className="input" value={form.source_ref} placeholder={form.source_kind === 'usda_fdc' ? 'FDC ID' : 'Brand, label date…'} onChange={(e) => set({ source_ref: e.target.value })} />
              </label>
            </div>
          </div>
        ) : (
          <div className="stack-sm">
            <p className="small muted">List raw or dry ingredients for the whole batch, including cooking oil or ghee (counted once). Then weigh the cooked batch.</p>
            {form.ingredients.map((ing, i) => (
              <IngredientEditor key={ing.key} ing={ing} foods={lib.foods}
                onChange={(n) => set({ ingredients: form.ingredients.map((x, k) => (k === i ? n : x)) })}
                onRemove={() => set({ ingredients: form.ingredients.filter((_, k) => k !== i) })} />
            ))}
            <div className="row wrap">
              <button className="btn secondary sm" onClick={() => set({ ingredients: [...form.ingredients, { key: newId(), food_version_id: null, name: '', state: 'raw', grams: '', per100: emptyNutrients(), source_kind: 'label' }] })}>
                <Icon name="plus" size={18} /> Add ingredient
              </button>
              {lib.foods.length ? (
                <select className="select" style={{ width: 'auto', minHeight: 40 }} aria-label="Add one of your saved foods" value="" onChange={(e) => {
                  const fv = lib.foods.find((f) => f.id === e.target.value);
                  if (fv) set({ ingredients: [...form.ingredients, { key: newId(), food_version_id: fv.id, name: fv.name, state: fv.preparation_state, grams: '', per100: emptyNutrients(), source_kind: fv.source.kind }] });
                }}>
                  <option value="">Add a saved food…</option>
                  {lib.foods.filter((f) => !f.deleted_at).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              ) : null}
            </div>
            <label className="field">
              Cooked batch weight (g)
              <input className="input num" inputMode="decimal" value={form.cooked_yield_g} onChange={(e) => set({ cooked_yield_g: e.target.value })} placeholder="Weigh the pot minus the empty pot" />
            </label>
            <label className="field">
              Notes (optional)
              <input className="input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. ghee on the plate is logged separately" />
            </label>
          </div>
        )}
        <div className="notice">
          {preview
            ? <>Usual portion ≈ <strong>{formatTotal({ value: preview.e, complete: preview.complete }, 'kcal')}</strong> · {formatTotal({ value: preview.p, complete: true }, 'g protein')} — an estimate from your numbers.</>
            : 'Fill in the portion and nutrition to see an estimate. Blank values stay unknown.'}
        </div>
      </Section>

      {errors.length ? <div className="notice error" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div> : null}
      <button className="btn block" onClick={save}>Save meal</button>
      {existing ? <button className="btn danger block" onClick={() => setConfirmDelete(true)}>Remove from my meals</button> : null}

      {photoOpen ? (
        <Sheet title="Meal picture" onClose={() => setPhotoOpen(false)}>
          <PhotoCropper hint="Frame just the food. Saved pictures stay private to you." onDone={(p) => { set({ photo: p.thumb }); setPhotoOpen(false); }} />
        </Sheet>
      ) : null}
      {confirmDelete && existing ? (
        <Sheet title={`Remove ${existing.name}?`} onClose={() => setConfirmDelete(false)} actions={
          <>
            <button className="btn secondary grow" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button className="btn danger grow" onClick={async () => {
              const cur = await journal.db.get('presets', existing.id);
              if (cur) await journal.remove('presets', cur);
              refresh();
              notify({ kind: 'info', message: `Removed ${existing.name}. Past meals are unchanged.` });
              goBack('food');
            }}>Remove</button>
          </>
        }>
          <p className="muted">It disappears from your usual meals. Meals you already logged stay as they are.</p>
        </Sheet>
      ) : null}
    </div>
  );
}
