import { useEffect, useMemo, useState } from 'react';
import type { MealPreset, MealSlot } from '@shared/contracts';
import { perServing, shortSource, type StandardNutrition } from '@shared/catalogue/standardNutrition';
import { CATEGORY_IDS, searchCatalogue, canonicalTokens, type CatalogueFood, type CatalogueIndex, type CategoryId } from '@shared/catalogue/catalogue';
import { useJournal } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { newId } from '@/core/ids';
import { CatalogueArt } from '@/core/design/catalogueArt';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { Segmented, Sheet, Stepper, Toggle } from '@/core/design/ui';
import { coveredByDb, coveredNames, searchDishes, searchRestaurants, type Dish } from '@shared/fooddb/foodDb';
import { useQuery } from '@/app/JournalContext';
import { track, type InputMethod } from '@/core/analytics/analytics';
import { LEGACY_REFERENCE_VALUES } from '@/core/config/dataPolicy';
import { addDays } from '@/domain/metrics/metrics';
import { BarcodeSheet } from './BarcodeSheet';
import { DishRow, DishSheet, NoResultPanel, QuickAddSheet, RestaurantCard, useFoodDb } from './DishParts';
import { existingPresetFor, presetFromCatalogue, visibleFor } from './catalogueFood';
import { SLOT_LABEL, describeAmount, describeQuantity } from './mealActions';
import { CATEGORY_SHORT, useCatalogue } from './useCatalogue';
import { saveErrorMessage, useMealLogging } from './useFood';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];
type Chip = 'popular' | 'all' | CategoryId;

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function PresetRow({ p, onPick }: { p: MealPreset; onPick: () => void }) {
  return (
    <button className="ex-row" onClick={onPick}>
      <span className="ex-art" style={{ background: 'var(--food)', overflow: 'hidden' }}><FoodArt icon={p.icon} photo={p.photo} catalogueId={p.catalogue_id} size={52} label={p.name} /></span>
      <span className="grow"><span className="er-name">{p.kind === 'recipe' || p.kind === 'template' ? <span className="my-badge">My</span> : null}{p.name}</span><br /><span className="er-sub">{p.kind === 'recipe' ? 'My recipe · ' : p.kind === 'template' ? 'Template · ' : ''}{describeQuantity(p, 1)}</span></span>
      <Icon name="chevronRight" />
    </button>
  );
}

function CatalogueRow({ f, mine, onPick, std }: { f: CatalogueFood; mine: MealPreset | null; onPick: () => void; std?: StandardNutrition }) {
  const kcal = std && std.serving.unit === f.portion.display_unit ? perServing(std, std.serving.grams).energy_kcal : null;
  return (
    <button className="ex-row lazy-row" onClick={onPick} aria-label={mine ? `${f.name}, in your meals` : f.name}>
      <span className="ex-art" style={{ background: 'var(--food)', overflow: 'hidden' }}><CatalogueArt id={f.id} size={52} /></span>
      <span className="grow">
        <span className="er-name">{f.name}</span><br />
        <span className="er-sub">{mine ? `In your meals · ${describeQuantity(mine, 1)}` : kcal !== null ? `${Math.round(kcal)} kcal · 1 ${f.portion.display_unit}` : CATEGORY_SHORT[f.category_id]}</span>
      </span>
      {mine ? <Icon name="star" size={18} /> : <Icon name="plus" size={20} />}
    </button>
  );
}

/** T9: one dish_searched per settled query (and dish_searched_no_result with the text). */
function useSearchAnalytics(query: string, results: number) {
  useEffect(() => {
    if (query.length < 2) return;
    const t = window.setTimeout(() => {
      track('dish_searched', { q_len: query.length, results });
      if (results === 0) track('dish_searched_no_result', { text: query });
    }, 1200);
    return () => window.clearTimeout(t);
  }, [query, results]);
}

/**
 * Choose food: your meals first, then the full food list (search, categories). Same row layout,
 * cream thumbnails and "Create a meal" action as the approved picker.
 */
export function FoodPicker({ presets, date, slot, onPickPreset, onClose, initialQuery = '' }: {
  presets: MealPreset[];
  date: string;
  slot: MealSlot;
  initialQuery?: string;
  onPickPreset: (p: MealPreset) => void;
  onClose: () => void;
}) {
  const { profile } = useJournal();
  const { index, failed } = useCatalogue();
  const [q, setQ] = useState(initialQuery);
  const [chip, setChip] = useState<Chip>('popular');
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState<CatalogueFood | null>(null);
  const [scanning, setScanning] = useState(false);
  const { db } = useFoodDb();
  const [vegOnly, setVegOnly] = useState(false);
  const [dish, setDish] = useState<{ d: Dish; restaurant: string | null; method: InputMethod } | null>(null);
  const [quick, setQuick] = useState(false);
  const recent = useQuery((j) => j.mealsBetween(addDays(date, -30), date), [date]);
  const weekday = weekdayOf(date);
  const prefs = profile.food_prefs;

  const query = q.trim();
  const myMatches = useMemo(() => {
    if (!query) return presets;
    const toks = canonicalTokens(query);
    return presets.filter((p) => {
      const words = canonicalTokens(p.name);
      return toks.every((t) => words.some((w) => w.startsWith(t)));
    });
  }, [presets, query]);

  const listed = useMemo(() => {
    if (!index) return { foods: [] as CatalogueFood[], hidden: 0 };
    const pool = query
      ? searchCatalogue(index, query, { limit: 80 })
      : chip === 'popular' ? index.foods.filter((f) => f.priority === 'starter')
        : chip === 'all' ? [...index.foods]
          : index.foods.filter((f) => f.category_id === chip);
    const shown = showHidden ? pool : pool.filter((f) => visibleFor(f, prefs, weekday));
    return { foods: shown, hidden: pool.length - shown.length };
  }, [index, query, chip, showHidden, prefs, weekday]);

  const usage = useMemo(() => {
    const byPreset = new Map(presets.map((p) => [p.id, p.dish_id]));
    const m = new Map<string, number>();
    for (const e of recent ?? []) { const id = e.preset_id ? byPreset.get(e.preset_id) : null; if (id) m.set(id, (m.get(id) ?? 0) + 1); }
    return m;
  }, [presets, recent]);
  const hour = new Date().getHours();
  const dishes = useMemo(() => (db ? searchDishes(db, query, { vegOnly, hour, usage, limit: query ? 40 : 12 }) : []), [db, query, vegOnly, hour, usage]);
  const places = useMemo(() => (db && query ? searchRestaurants(db, query) : []), [db, query]);
  // A list food that is the same dish as a database entry is shown once (as the database dish).
  const dbNames = useMemo(() => (db ? coveredNames(db) : new Set<string>()), [db]);
  const extraFoods = listed.foods.filter((f) => !coveredByDb(dbNames, f));
  const nothing = !!query && !!db && dishes.length === 0 && places.length === 0 && myMatches.length === 0;
  useSearchAnalytics(query, dishes.length + places.length + myMatches.length);

  if (scanning) return <BarcodeSheet date={date} initialSlot={slot} onClose={onClose} />;
  if (quick) return <QuickAddSheet date={date} initialSlot={slot} initialName={query} onClose={onClose} />;
  if (dish && db) return <DishSheet d={dish.d} db={db} date={date} initialSlot={slot} method={dish.method} restaurant={dish.restaurant} onClose={onClose} />;
  if (adding && index) {
    return <CatalogueAddSheet food={adding} index={index} date={date} initialSlot={slot} onClose={onClose} onBack={() => setAdding(null)} />;
  }

  const pick = (f: CatalogueFood) => {
    const mine = index ? existingPresetFor(index, presets, f.id) : null;
    if (mine) onPickPreset(mine);
    else setAdding(f);
  };

  return (
    <Sheet title="Choose food" onClose={onClose} full>
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" type="search" placeholder="Search foods: roti, dal, chai…" aria-label="Search foods" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn secondary scan-btn" onClick={() => setScanning(true)} aria-label="Scan a barcode"><Icon name="barcode" size={22} /></button>
        </div>

        {myMatches.length ? (
          <div className="stack-sm">
            <h3 className="picker-head">Your meals</h3>
            <div className="list-divided">
              {myMatches.map((p) => <PresetRow key={p.id} p={p} onPick={() => onPickPreset(p)} />)}
            </div>
          </div>
        ) : null}

        {places.length && db ? (
          <div className="stack-sm">
            <h3 className="picker-head">Restaurants</h3>
            {places.map((h) => <RestaurantCard key={h.id} hit={h} db={db} date={date} slot={slot} onOpen={(d, restaurant) => setDish({ d, restaurant, method: 'restaurant' })} />)}
          </div>
        ) : null}

        <div className="stack-sm">
          <div className="row between">
            <h3 className="picker-head">{query ? 'Dishes' : 'Suggested now'}</h3>
            <button className="chip" aria-pressed={vegOnly} onClick={() => setVegOnly((v) => !v)}><span className="diet-dot veg" aria-hidden="true" /> Veg only</button>
          </div>
          {!db ? <div className="skeleton" /> : dishes.length ? (
            <div className="list-divided">
              {dishes.map((h) => <DishRow key={h.dish.id} d={h.dish} badge={h.dish.components?.length ? 'Combo' : undefined}
                onPick={() => setDish({ d: h.dish, restaurant: null, method: query ? 'search' : 'suggestion' })} />)}
            </div>
          ) : null}
          {nothing && db ? <NoResultPanel q={query} db={db} vegOnly={vegOnly} listedBelow={extraFoods.map((f) => f.name)} onOpenDish={(d) => setDish({ d, restaurant: null, method: 'closest_match' })} onQuickAdd={() => setQuick(true)} /> : null}
          {!nothing ? <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setQuick(true)}><Icon name="plus" size={16} /> Quick-add calories</button> : null}
        </div>

        <div className="stack-sm" hidden={!!query && extraFoods.length === 0}>
          <h3 className="picker-head">{query ? (LEGACY_REFERENCE_VALUES ? 'More foods' : 'More foods (no values yet)') : 'More foods'}</h3>
          {!query ? (
            <div className="chips" role="group" aria-label="Food categories">
              {(['popular', ...CATEGORY_IDS, 'all'] as Chip[]).map((c) => (
                <button key={c} className="chip" aria-pressed={chip === c} onClick={() => setChip(c)}>
                  {c === 'popular' ? 'Popular' : c === 'all' ? 'All foods' : CATEGORY_SHORT[c]}
                </button>
              ))}
            </div>
          ) : null}
          {failed ? <p className="small muted">The food list couldn’t load. Your own meals still work.</p> : !index ? <div className="skeleton" /> : (
            <div className="list-divided">
              {extraFoods.map((f) => <CatalogueRow key={f.id} f={f} std={LEGACY_REFERENCE_VALUES ? index.standard.get(f.id) : undefined} mine={existingPresetFor(index, presets, f.id)} onPick={() => pick(f)} />)}
            </div>
          )}
          {listed.hidden > 0 ? (
            <button className="link" onClick={() => setShowHidden(true)}>
              {listed.hidden} more hidden by your food choices · Show
            </button>
          ) : null}
        </div>

        <div className="stack-sm">
          <button className="btn secondary" onClick={() => { onClose(); navigate('recipe', 'new'); }}><Icon name="edit" size={18} /> Create your own recipe</button>
          <button className="btn secondary" onClick={() => { onClose(); navigate('meal', 'new'); }}><Icon name="plus" size={18} /> Add a food from its label</button>
        </div>
        <p className="label">Dish values come from the TrainLuma food database (Indian Food Composition Tables, ICMR-NIN; INDB; brands’ official Canadian nutrition).{LEGACY_REFERENCE_VALUES
          ? ' “More foods” show standard values from the Canadian Nutrient File or USDA where there’s a good match; the rest have no values yet — log a close dish, quick-add, or add your recipe.'
          : ' “More foods” have pictures but no values yet — log a close dish, quick-add, or add your recipe.'}</p>
      </div>
    </Sheet>
  );
}

const fmtG = (g: number | null) => (g === null ? '–' : `${g < 10 ? Math.round(g * 10) / 10 : Math.round(g)} g`);

/** First time a person picks a list food: confirm their usual amount (and optionally its weight), then add it. */
function CatalogueAddSheet({ food, index, date, initialSlot, onClose, onBack }: { food: CatalogueFood; index: CatalogueIndex; date: string; initialSlot: MealSlot; onClose: () => void; onBack: () => void }) {
  const { journal, profile, refresh, notify, today } = useJournal();
  const { logPreset } = useMealLogging();
  const unit = food.portion.display_unit;
  const step = unit === 'bowl' || unit === 'serving' || unit === 'cup' ? 0.5 : 1;
  const [qty, setQty] = useState(food.portion.suggested_quantity);
  const [grams, setGrams] = useState('');
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const allergies = profile.food_prefs.allergies;
  const std = LEGACY_REFERENCE_VALUES ? (index.standard.get(food.id) ?? null) : null;
  const typed = grams.trim() ? Number(grams.replace(',', '.')) : null;
  const unitGrams = typed && typed > 0 ? typed : std && std.serving.unit === unit ? std.serving.grams : null;
  const est = std && unitGrams ? perServing(std, unitGrams * qty) : null;

  const save = async (then: 'log' | 'edit') => {
    const g = grams.trim() ? Number(grams.replace(',', '.')) : null;
    if (g !== null && !(g > 0 && g < 5000)) return notify({ kind: 'error', message: 'Enter the weight in grams, or leave it blank.' });
    setBusy(true);
    try {
      const built = presetFromCatalogue({
        food, seedVersion: index.seed_version, ownerId: journal.ownerId, now: new Date().toISOString(), newId,
        choice: { grams_per_unit: g, default_quantity: 1, favorite: keep }, standard: std,
      });
      await journal.commit('foods', built.food);
      await journal.commit('presets', built.preset);
      refresh();
      onClose();
      if (then === 'edit') navigate('meal', built.preset.id);
      else await logPreset(built.preset, qty, { slot, date: date || today, newFoods: [built.food] });
    } catch (e) {
      setBusy(false);
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  return (
    <Sheet title={food.name} onClose={onClose} actions={
      <button className="btn block" disabled={busy} onClick={() => void save('log')}>Add {describeAmount(unit, qty)}</button>
    }>
      <div className="stack">
        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={onBack}><Icon name="chevronLeft" size={16} /> Back to the list</button>
        <div className="row" style={{ gap: 16 }}>
          <span className="thumb" style={{ width: 88, height: 88, borderRadius: 18, background: 'var(--food)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
            <CatalogueArt id={food.id} size={88} />
          </span>
          {est && std ? (
            <div className="grow stack-sm">
              <div className="std-nutrition" aria-label="Standard estimate">
                <span><b className="num">{Math.round(est.energy_kcal ?? 0)}</b> kcal</span>
                <span><b className="num">{fmtG(est.protein_g)}</b> protein</span>
                <span><b className="num">{fmtG(est.carbs_g)}</b> carbs</span>
                <span><b className="num">{fmtG(est.fat_g)}</b> fat</span>
              </div>
              <span className="label">Standard estimate for {describeAmount(unit, qty)} ({Math.round(unitGrams! * qty)} g) · {shortSource(std.source)}{std.match === 'close' ? ` (closest: ${std.record_name})` : ''}. Your recipe may differ.</span>
            </div>
          ) : (
            <div className="grow small muted">
              Nutrition not set yet. It’s logged with nutrition unknown until you add your recipe or a package label.
            </div>
          )}
        </div>
        <Stepper label="Amount" value={describeAmount(unit, qty)} onDec={() => setQty((v) => Math.max(step, v - step))} onInc={() => setQty((v) => Math.min(20, v + step))} disabledDec={qty <= step} />
        <Segmented label="Meal" value={slot} onChange={setSlot} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        <label className="field">
          1 {unit} of yours weighs (g, optional)
          <input className="input num" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)}
            placeholder={std && std.serving.unit === unit ? `Standard ${std.serving.grams} g` : 'Not weighed yet'} />
        </label>
        <Toggle label="Favourite" checked={keep} onChange={setKeep} description="Favourites come first in your usual meals." />
        <p className="label">
          Recipes differ from home to home, so check ingredients yourself{allergies.length ? `, especially for ${allergies.join(', ')}` : ''}. The list can’t confirm allergens.
        </p>
        <button className="link" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void save('edit')}>
          <Icon name="edit" size={16} /> Add my recipe or label numbers
        </button>
      </div>
    </Sheet>
  );
}
