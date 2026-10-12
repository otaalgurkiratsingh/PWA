import { useEffect, useRef, useState } from 'react';
import type { FoodVersion, MealPreset, MealSlot } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { LookupError, lookupBarcode, normalizeBarcode, type Product } from '@/core/barcode/openFoodFacts';
import { cameraAvailable, startScanner } from '@/core/barcode/scanner';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { Segmented, Sheet, Stepper } from '@/core/design/ui';
import { newId } from '@/core/ids';
import { SLOT_LABEL, describeAmount } from './mealActions';
import { saveErrorMessage, useLibrary, useMealLogging } from './useFood';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
type Step = { kind: 'scan' } | { kind: 'looking'; code: string } | { kind: 'found'; product: Product; existing: MealPreset | null } | { kind: 'missing'; code: string } | { kind: 'error'; message: string };

/** Build the person's own food + meal from a product label (values per 100 g, source named). */
export function presetFromProduct(p: Product, ownerId: string, now: string, id: () => string): { food: FoodVersion; preset: MealPreset } {
  const base = (x: string) => ({ id: x, owner_id: ownerId, local_version: 0, created_at: now, updated_at: now, deleted_at: null, synthetic: false });
  const name = (p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name).slice(0, 60);
  const food: FoodVersion = {
    ...base(id()), food_id: id(), revision: 1, name, preparation_state: 'as_sold', per_100g: { ...p.per_100g },
    source: { kind: 'open_food_facts', ref: p.barcode, version: null, license: 'Open Food Facts contributors, ODbL 1.0 (openfoodfacts.org)', note: 'Label values from Open Food Facts. Check them against your package.' },
    assumptions: p.liquid ? ['Label values are per 100 ml; treated as 100 g.'] : [],
  };
  const serving = p.serving_grams !== null;
  const preset: MealPreset = {
    ...base(id()), name, icon: 'plate',
    items: [serving
      ? { kind: 'food', food_version_id: food.id, unit_label: 'serving', grams_per_unit: p.serving_grams!, default_quantity: 1 }
      : { kind: 'food', food_version_id: food.id, unit_label: 'g', grams_per_unit: 1, default_quantity: 100 }],
    quantity_step: serving ? 0.5 : 10, favorite: false, photo: null,
  };
  return { food, preset };
}

export function BarcodeSheet({ date, initialSlot, onClose }: { date: string; initialSlot: MealSlot; onClose: () => void }) {
  const { journal, refresh, notify, today } = useJournal();
  const { data: lib } = useLibrary();
  const { logPreset } = useMealLogging();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [typed, setTyped] = useState('');
  const [camError, setCamError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const scanning = step.kind === 'scan';

  const lookup = async (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return setStep({ kind: 'error', message: 'That doesn’t look like a valid barcode. Check the numbers under the bars.' });
    // Already saved from an earlier scan: reuse it, no lookup needed.
    const food = lib?.foods.find((f) => f.source.kind === 'open_food_facts' && f.source.ref === code && !f.deleted_at);
    const existing = food ? lib?.presets.find((p) => !p.deleted_at && p.items.some((i) => i.kind === 'food' && i.food_version_id === food.id)) ?? null : null;
    setStep({ kind: 'looking', code });
    try {
      if (existing && food) {
        setQty(1);
        return setStep({ kind: 'found', existing, product: { barcode: code, name: existing.name, brand: null, per_100g: food.per_100g, liquid: false, serving_label: null, serving_grams: existing.items[0]!.unit_label === 'serving' ? existing.items[0]!.grams_per_unit : null, complete: true } });
      }
      const p = await lookupBarcode(code);
      if (!p) return setStep({ kind: 'missing', code });
      setQty(1);
      setStep({ kind: 'found', product: p, existing: null });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof LookupError ? e.message : 'Something went wrong. Try again.' });
    }
  };

  // The scanner keeps running across renders; it calls the latest lookup through this ref.
  const onCode = useRef(lookup);
  useEffect(() => { onCode.current = lookup; });
  useEffect(() => {
    if (!scanning || !video.current || !cameraAvailable()) return;
    let stop: (() => void) | null = null;
    let live = true;
    startScanner(video.current, (code) => { if (live) { navigator.vibrate?.(40); void onCode.current(code); } }).then(
      (s) => { if (live) stop = s; else s(); },
      (e: Error) => live && setCamError(e.message),
    );
    return () => { live = false; stop?.(); };
  }, [scanning]);

  const add = async () => {
    if (step.kind !== 'found') return;
    setBusy(true);
    try {
      let preset = step.existing;
      let newFoods: FoodVersion[] = [];
      if (!preset) {
        const built = presetFromProduct(step.product, journal.ownerId, new Date().toISOString(), newId);
        await journal.commit('foods', built.food);
        await journal.commit('presets', built.preset);
        preset = built.preset;
        newFoods = [built.food];
        refresh();
      }
      onClose();
      await logPreset(preset, qty, { slot, date: date || today, newFoods });
    } catch (e) {
      setBusy(false);
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  let body;
  if (step.kind === 'found') {
    const p = step.product;
    const unitIsServing = p.serving_grams !== null;
    const grams = unitIsServing ? p.serving_grams! * qty : 100 * qty;
    const v = (x: number | null) => (x === null ? null : (x * grams) / 100);
    const kcal = v(p.per_100g.energy_kcal);
    body = (
      <div className="stack">
        <div className="row" style={{ gap: 14 }}>
          <span className="thumb" style={{ width: 72, height: 72, borderRadius: 18, background: 'var(--food)', display: 'grid', placeItems: 'center', flex: 'none' }}><FoodArt icon="plate" size={60} /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <strong style={{ display: 'block' }}>{p.name}</strong>
            {p.brand ? <span className="small muted">{p.brand}</span> : null}
            <span className="label" style={{ display: 'block' }}>Barcode {p.barcode}{step.existing ? ' · saved in your meals' : ''}</span>
          </div>
        </div>
        <div className="std-nutrition" aria-label="Nutrition for this amount">
          <span><b className="num">{kcal === null ? '–' : Math.round(kcal)}</b> kcal</span>
          <span><b className="num">{v(p.per_100g.protein_g)?.toFixed(1) ?? '–'}</b> g protein</span>
          <span><b className="num">{v(p.per_100g.carbs_g)?.toFixed(1) ?? '–'}</b> g carbs</span>
          <span><b className="num">{v(p.per_100g.fat_g)?.toFixed(1) ?? '–'}</b> g fat</span>
        </div>
        {!p.complete ? <div className="notice warn" role="status">Some label values are missing. Totals will show as partial until you add them (Edit meal).</div> : null}
        <Stepper label="Amount" value={unitIsServing ? `${describeAmount('serving', qty)} (${Math.round(grams)} g)` : `${Math.round(grams)} g`}
          onDec={() => setQty((x) => Math.max(0.5, x - 0.5))} onInc={() => setQty((x) => Math.min(20, x + 0.5))} disabledDec={qty <= 0.5} />
        <Segmented label="Meal" value={slot} onChange={setSlot} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        <p className="label">From Open Food Facts (ODbL), entered by volunteers. Check the numbers against your package; you can edit them any time.</p>
      </div>
    );
  } else if (step.kind === 'missing') {
    body = (
      <div className="stack">
        <div className="notice" role="status">Barcode {step.code} isn’t in Open Food Facts yet. Add it once from the nutrition label and it’s one tap after that.</div>
        <button className="btn" onClick={() => { onClose(); navigate('meal', 'new'); }}><Icon name="edit" size={18} /> Add from the label</button>
        <button className="btn secondary" onClick={() => setStep({ kind: 'scan' })}>Scan another</button>
      </div>
    );
  } else {
    body = (
      <div className="stack">
        {cameraAvailable() && !camError ? (
          <div className="scan-view">
            <video ref={video} aria-label="Camera view" />
            <span className="scan-frame" aria-hidden="true"><i /></span>
            <span className="scan-hint">{step.kind === 'looking' ? 'Looking it up…' : 'Point the camera at the barcode'}</span>
          </div>
        ) : null}
        {camError ? <div className="notice warn" role="status">{camError}</div> : null}
        {step.kind === 'error' ? <div className="notice error" role="alert">{step.message}</div> : null}
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void lookup(typed); }}>
          <label className="field grow" style={{ margin: 0 }}>
            Or type the numbers
            <input className="input num" inputMode="numeric" autoComplete="off" value={typed} maxLength={16} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. 0064200116473" />
          </label>
          <button className="btn secondary" type="submit" style={{ alignSelf: 'flex-end' }} disabled={step.kind === 'looking' || typed.replace(/\D/g, '').length < 8}>
            {step.kind === 'looking' ? <span className="spinner" /> : 'Look up'}
          </button>
        </form>
        <p className="label">Only the barcode number is sent to Open Food Facts to find the product. Camera images stay on your phone.</p>
      </div>
    );
  }

  return (
    <Sheet title="Scan a barcode" onClose={onClose} actions={step.kind === 'found' ? (
      <div className="row" style={{ gap: 8, width: '100%' }}>
        <button className="btn secondary" onClick={() => setStep({ kind: 'scan' })}>Rescan</button>
        <button className="btn grow" disabled={busy} onClick={() => void add()}>Add to {SLOT_LABEL[slot].toLowerCase()}</button>
      </div>
    ) : undefined}>
      {body}
    </Sheet>
  );
}
