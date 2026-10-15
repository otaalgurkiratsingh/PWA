import { useEffect, useMemo, useState } from 'react';
import type { FoodVersion, MealPreset, MealSlot } from '@shared/contracts';
import {
  canUseGrams, closestDish, dietOf, pendingMatch, loadFoodDb, MULTIPLIERS, scaleMacros, sourceLine, TYPICAL_LABEL, type Dish, type FoodDb, type Macros,
  type RestaurantHit,
} from '@shared/fooddb/foodDb';
import { useJournal } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { track, type InputMethod } from '@/core/analytics/analytics';
import { supabase } from '@/core/auth/supabase';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { Segmented, Sheet } from '@/core/design/ui';
import { newId } from '@/core/ids';
import { existingDishPreset, iconForDish, presetFromDish } from './dishFood';
import { SLOT_LABEL } from './mealActions';
import { saveErrorMessage, useLibrary, useMealLogging } from './useFood';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];

/** The bundled food database (separate cached chunk, works offline). */
export function useFoodDb(): { db: FoodDb | null; failed: boolean } {
  const [state, setState] = useState<{ db: FoodDb | null; failed: boolean }>({ db: null, failed: false });
  useEffect(() => {
    let live = true;
    loadFoodDb().then((db) => live && setState({ db, failed: false }), () => live && setState({ db: null, failed: true }));
    return () => { live = false; };
  }, []);
  return state;
}

const fmt = (v: number | null, unit = '') => (v === null ? '–' : `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}${unit}`);

/** Log a database dish: reuse the person's meal made from it, or create it once (T1/T7). */
export function useDishLogger() {
  const { journal, refresh, notify } = useJournal();
  const { data: lib } = useLibrary();
  const { logPreset } = useMealLogging();
  return async (dish: Dish, db: FoodDb, multiplier: number, opts: { slot: MealSlot; date: string; method: InputMethod; quiet?: boolean }) => {
    try {
      let preset = existingDishPreset(lib?.presets ?? [], dish.id);
      let newFoods: FoodVersion[] = [];
      if (!preset) {
        const built = presetFromDish(dish, db, journal.ownerId, new Date().toISOString(), newId);
        for (const f of built.foods) await journal.commit('foods', f);
        await journal.commit('presets', built.preset);
        preset = built.preset;
        newFoods = built.foods;
        refresh();
      }
      return await logPreset(preset, multiplier, { slot: opts.slot, date: opts.date, newFoods, method: opts.method, quiet: opts.quiet });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
      return null;
    }
  };
}

function DietDot({ d }: { d: Dish }) {
  const diet = dietOf(d);
  return <span className={`diet-dot ${diet}`} title={diet === 'veg' ? 'Vegetarian' : diet === 'egg' ? 'Contains egg' : 'Non-vegetarian'} aria-label={diet === 'veg' ? 'Vegetarian' : diet === 'egg' ? 'Contains egg' : 'Non-vegetarian'} />;
}

/** Search row: name, serving, and the two numbers gym users scan for (kcal + protein). */
export function DishRow({ d, onPick, badge }: { d: Dish; onPick: () => void; badge?: string }) {
  const s = d.per_serving!;
  return (
    <button className="ex-row dish-row" onClick={onPick} aria-label={`${d.name}, ${fmt(s.kcal)} kcal, ${fmt(s.protein_g)} grams protein per ${d.serving_label}`}>
      <span className="ex-art" style={{ background: 'var(--food)', overflow: 'hidden' }}><FoodArt icon={iconForDish(d)} size={52} label={d.name} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="er-name"><DietDot d={d} /> {d.name}</span><br />
        <span className="er-sub">{d.brand ? `${d.brand} · ` : ''}{badge ? `${badge} · ` : ''}{d.serving_label}</span>
      </span>
      <span className="dish-nums"><b className="num">{fmt(s.kcal)}</b><small>kcal</small><b className="num">{fmt(s.protein_g, ' g')}</b><small>protein</small></span>
    </button>
  );
}

function MacroGrid({ m, big }: { m: Macros; big?: boolean }) {
  return (
    <div className={`macro-grid${big ? ' big' : ''}`}>
      <span><b className="num">{fmt(m.kcal)}</b> kcal</span>
      <span><b className="num">{fmt(m.protein_g, ' g')}</b> protein</span>
      <span><b className="num">{fmt(m.carbs_g, ' g')}</b> carbs</span>
      <span><b className="num">{fmt(m.fat_g, ' g')}</b> fat</span>
      <span><b className="num">{fmt(m.fiber_g, ' g')}</b> fibre</span>
    </div>
  );
}

/** T4/T5: dish detail with serving selector (0.5×–3× or custom grams) and the source line. */
export function DishSheet({ d, db, date, initialSlot, method, restaurant, onClose, onLogged }: {
  d: Dish; db: FoodDb; date: string; initialSlot: MealSlot; method: InputMethod; restaurant?: string | null;
  onClose: () => void; onLogged?: () => void;
}) {
  const logDish = useDishLogger();
  const [mult, setMult] = useState(1);
  const [grams, setGrams] = useState('');
  const [per100, setPer100] = useState(false);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [busy, setBusy] = useState(false);
  const g = grams.trim() ? Number(grams.replace(',', '.')) : null;
  const gramsOk = g !== null && g > 0 && g < 3000;
  const amount: { grams: number } | { multiplier: number } = gramsOk && canUseGrams(d) ? { grams: g! } : { multiplier: mult };
  const m = scaleMacros(d, amount);
  const multiplier = 'grams' in amount ? amount.grams / d.serving_g! : mult;
  const log = async () => {
    setBusy(true);
    const e = await logDish(d, db, multiplier, { slot, date, method });
    setBusy(false);
    if (e) { onLogged?.(); onClose(); }
  };
  return (
    <Sheet title={d.name} onClose={onClose} actions={<button className="btn block" disabled={busy || (grams.trim() !== '' && !gramsOk)} onClick={() => void log()}>Log {SLOT_LABEL[slot].toLowerCase()}</button>}>
      <div className="stack">
        {restaurant ? <div className="typical-label" role="note"><Icon name="info" size={16} /> <span><strong>{restaurant}</strong> · {TYPICAL_LABEL}</span></div> : null}
        <div className="row" style={{ gap: 14 }}>
          <span className="thumb" style={{ width: 72, height: 72, borderRadius: 18, background: 'var(--food)', display: 'grid', placeItems: 'center', flex: 'none' }}><FoodArt icon={iconForDish(d)} size={64} label={d.name} /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <span className="small muted">{d.brand ?? (d.name_local !== d.name ? d.name_local : '')}</span>
            <strong style={{ display: 'block' }}>{'grams' in amount ? `${Math.round(amount.grams)} g` : `${mult === 1 ? '' : `${mult} × `}${d.serving_label}`}</strong>
            {d.components?.length ? <span className="label">{d.components.map((c) => `${db.byId.get(c.dish_id)?.name} ${c.grams} g`).join(' + ')}</span> : null}
          </div>
        </div>
        <MacroGrid m={m} big />
        <div className="chips" role="group" aria-label="Servings">
          {MULTIPLIERS.map((x) => <button key={x} className="chip" aria-pressed={!gramsOk && mult === x} onClick={() => { setMult(x); setGrams(''); }}>{x === 0.5 ? '½' : x}×</button>)}
        </div>
        {canUseGrams(d) ? (
          <label className="field">
            Or exact grams
            <input className="input num" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder={`${d.serving_g} g = 1 serving`} />
          </label>
        ) : <span className="label">Official per-serving values; the brand doesn’t publish the weight.</span>}
        <Segmented label="Meal" value={slot} onChange={setSlot} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        {d.per_100g ? (
          <div>
            <button className="link" onClick={() => setPer100((v) => !v)} aria-expanded={per100}>Per 100 g <Icon name={per100 ? 'chevronUp' : 'chevronDown'} size={16} /></button>
            {per100 ? <MacroGrid m={d.per_100g} /> : null}
          </div>
        ) : null}
        <p className="label">{sourceLine(d)}</p>
        {!d.brand ? (
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); navigate('recipe', `from:${d.id}`); }}>
            <Icon name="edit" size={16} /> Make it mine (your recipe, e.g. less oil)
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/** T22: restaurant (typical values) or chain (official values) card with 1-tap logging. */
export function RestaurantCard({ hit, db, date, slot, onOpen }: { hit: RestaurantHit; db: FoodDb; date: string; slot: MealSlot; onOpen: (d: Dish, restaurant: string | null) => void }) {
  const logDish = useDishLogger();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="card tight restaurant-card">
      <div className="row" style={{ gap: 10 }}>
        <span className="mini-icon" aria-hidden="true"><Icon name={hit.kind === 'brand' ? 'store' : 'food'} size={18} /></span>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong>{hit.name}</strong><br />
          <span className="small muted">{hit.subtitle}</span>
        </span>
      </div>
      {hit.kind === 'restaurant' ? <div className="typical-label" role="note"><Icon name="info" size={16} /> <span>{TYPICAL_LABEL}</span></div> : null}
      {hit.items.length ? (
        <div className="list-divided">
          {hit.items.map((it) => (
            <div key={it.dish.id + it.title} className="row rc-item">
              <button className="link grow" style={{ textAlign: 'left' }} onClick={() => onOpen(it.dish, hit.kind === 'restaurant' ? hit.name : null)}>
                {it.title}<span className="small muted"> · {fmt(it.dish.per_serving!.kcal)} kcal · {fmt(it.dish.per_serving!.protein_g, ' g')} protein</span>
              </button>
              <button className="btn sm" aria-label={`Log ${it.title}${hit.kind === 'restaurant' ? ' (typical values)' : ''}`} disabled={done === it.dish.id}
                onClick={async () => { const e = await logDish(it.dish, db, 1, { slot, date, method: 'restaurant' }); if (e) setDone(it.dish.id); }}>
                {done === it.dish.id ? <Icon name="check" size={16} /> : 'Log'}
              </button>
            </div>
          ))}
        </div>
      ) : <p className="small muted">No signature dish matched in the food database yet. Use a close dish or quick-add below.</p>}
    </div>
  );
}

/** T14 + T24: never a dead end. Closest match → quick add → your own recipe → request it. */
export function NoResultPanel({ q, db, vegOnly, onOpenDish, onQuickAdd, listedBelow = [] }: {
  q: string; db: FoodDb; vegOnly: boolean; onOpenDish: (d: Dish) => void; onQuickAdd: () => void;
  /** Names of list foods ("More foods") that match the search, shown below this panel. */
  listedBelow?: readonly string[];
}) {
  const { mode } = useJournal();
  const close = useMemo(() => closestDish(db, q, { vegOnly }), [db, q, vegOnly]);
  const pending = useMemo(() => pendingMatch(db, q, { vegOnly }), [db, q, vegOnly]);
  const [requested, setRequested] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const request = async () => {
    setBusy(true);
    track('food_requested', { text: q });
    let count = 1;
    if (mode === 'account') {
      try {
        const db2 = await supabase();
        const { data } = await db2.rpc('request_food', { p_text: q.slice(0, 80) });
        count = Number((data as { count?: number } | null)?.count) || 1;
      } catch {
        count = 1;
      }
    }
    setRequested(count);
    setBusy(false);
  };
  return (
    <div className="card tight stack-sm no-result" aria-live="polite">
      <p className="small" style={{ margin: 0 }}>A close guess beats a skipped meal.</p>
      {pending ? (
        <p className="small muted" style={{ margin: 0 }} role="status"><strong>{pending.dish.name}</strong> is in our database but still being verified, so it can’t be logged with numbers yet.</p>
      ) : null}
      {listedBelow.length ? (
        <p className="small muted" style={{ margin: 0 }}>Also in <strong>More foods</strong> below: {listedBelow.slice(0, 3).map((n) => `“${n}”`).join(', ')}.</p>
      ) : null}
      {close ? (
        <button className="choice" onClick={() => onOpenDish(close.dish)}>
          <Icon name="search" /> <span className="grow"><strong>{pending ? `Log “${close.dish.name}” instead?` : `No “${q}” yet — log as “${close.dish.name}” instead?`}</strong><br /><span className="small muted">{fmt(close.dish.per_serving!.kcal)} kcal · {fmt(close.dish.per_serving!.protein_g, ' g')} protein · {close.dish.serving_label}</span></span>
        </button>
      ) : null}
      <button className="choice" onClick={onQuickAdd}><Icon name="plus" /> <span className="grow"><strong>Quick-add calories</strong><br /><span className="small muted">Just a number, done in seconds.</span></span></button>
      <button className="choice" onClick={() => navigate('recipe', 'new')}><Icon name="edit" /> <span className="grow"><strong>Create your own recipe</strong><br /><span className="small muted">Build it from dishes in the food database.</span></span></button>
      {requested === null ? (
        <button className="btn secondary" disabled={busy} onClick={() => void request()}>Can’t find it? Request it</button>
      ) : (
        <div className="notice" role="status">Got it — we’ll add it. {requested > 1 ? `You’re #${requested} asking for this.` : 'You’re the first to ask for this.'}</div>
      )}
    </div>
  );
}

/** Quick-add: a calorie number (and optional protein) with no dish. Logged as the person's own number. */
export function QuickAddSheet({ date, initialSlot, initialName = '', onClose }: { date: string; initialSlot: MealSlot; initialName?: string; onClose: () => void }) {
  const { journal, refresh, notify } = useJournal();
  const { logPreset } = useMealLogging();
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [name, setName] = useState(initialName);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const k = Number(kcal);
  const p = protein.trim() ? Number(protein.replace(',', '.')) : null;
  const ok = Number.isFinite(k) && k > 0 && k <= 5000 && (p === null || (p >= 0 && p <= 400));
  const save = async () => {
    if (!ok) return;
    const now = new Date().toISOString();
    const base = { owner_id: journal.ownerId, local_version: 0, created_at: now, updated_at: now, deleted_at: null, synthetic: false };
    const food: FoodVersion = {
      ...base, id: newId(), food_id: newId(), revision: 1, name: (name.trim() || 'Quick add').slice(0, 80), preparation_state: 'as_sold',
      per_100g: { energy_kcal: k, protein_g: p, carbs_g: null, fat_g: null, fiber_g: null },
      source: { kind: 'quick_add', ref: null, version: null, license: null, note: 'A number the person entered; stored as 1 serving = 100 units.' }, assumptions: [],
    };
    const preset: MealPreset = {
      ...base, id: newId(), name: (name.trim() || 'Quick add').slice(0, 60), icon: 'plate', quantity_step: 1, favorite: false, photo: null, kind: 'quick',
      items: [{ kind: 'food', food_version_id: food.id, unit_label: 'serving', grams_per_unit: 100, default_quantity: 1 }],
    };
    try {
      await journal.commit('foods', food);
      await journal.commit('presets', preset);
      refresh();
      track('quick_add', { kcal: k });
      onClose();
      await logPreset(preset, 1, { slot, date, newFoods: [food], method: 'quick_add' });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  return (
    <Sheet title="Quick-add calories" onClose={onClose} actions={<button className="btn block" disabled={!ok} onClick={() => void save()}>Log {SLOT_LABEL[slot].toLowerCase()}</button>}>
      <div className="stack">
        <label className="field">Calories (kcal)<input className="input num" inputMode="numeric" autoFocus value={kcal} onChange={(e) => setKcal(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 450" /></label>
        <label className="field">Protein (g, optional)<input className="input num" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
        <label className="field">What was it? (optional)<input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Quick add" /></label>
        <Segmented label="Meal" value={slot} onChange={setSlot} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        <p className="label">Your own number — fine for a rough log. A close guess beats a skipped meal.</p>
      </div>
    </Sheet>
  );
}
