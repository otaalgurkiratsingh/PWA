import { useMemo, useState } from 'react';
import type { MealEntry, MealPreset, MealSlot } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { EmptyState, Section, Segmented, Sheet, Stepper } from '@/core/design/ui';
import { formatShortDate, formatTime } from '@/core/time/localDate';
import { addDays } from '@/domain/metrics/metrics';
import { snapshotPreset, totalsOfItems, formatTotal } from '@/domain/nutrition/calc';
import { NutritionSummary } from './NutritionSummary';
import { PhotoSheet } from './PhotoSheet';
import { SLOT_LABEL, copyEntries, describeAmount, describeQuantity, rescaleEntry, slotForHour } from './mealActions';
import { saveErrorMessage, sortPresets, useLibrary, useMealLogging } from './useFood';
import { localHourIn } from '@/core/time/localDate';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatShortDate(date);
}

/** Usual-meal card: big appetising thumbnail, short name, usual amount, one-tap add. */
export function MealCard({ preset, onOpen, onQuickAdd }: { preset: MealPreset; onOpen: () => void; onQuickAdd: () => void }) {
  return (
    <div className="meal-card-wrap">
      <button className="meal-card" onClick={onOpen} aria-label={`${preset.name}, ${describeQuantity(preset, 1)}. Choose amount`}>
        <span className="thumb">
          <FoodArt icon={preset.icon} photo={preset.photo} size={104} label={preset.name} />
        </span>
        <span className="mc-name">{preset.name}</span>
        <span className="mc-sub">{describeQuantity(preset, 1)}</span>
      </button>
      {preset.favorite ? <span className="fav-dot" aria-hidden="true"><Icon name="star" size={16} /></span> : null}
      <button className="quick-add" onClick={onQuickAdd} aria-label={`Add usual ${preset.name}`}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function AddMealSheet({ preset, date, slot, onClose }: { preset: MealPreset; date: string; slot: MealSlot; onClose: () => void }) {
  const { logPreset } = useMealLogging();
  const { nutrition } = useLibrary();
  const [mult, setMult] = useState(1);
  const [s, setS] = useState<MealSlot>(slot);
  const item = preset.items[0]!;
  const step = preset.quantity_step / item.default_quantity;
  const preview = useMemo(() => {
    if (!nutrition) return null;
    try {
      return totalsOfItems(snapshotPreset(preset, mult, nutrition));
    } catch {
      return null;
    }
  }, [nutrition, preset, mult]);
  const qty = item.default_quantity * mult;
  return (
    <Sheet
      title={preset.name}
      onClose={onClose}
      actions={
        <button className="btn block" onClick={async () => { onClose(); await logPreset(preset, mult, { slot: s, date }); }}>
          Add {describeAmount(item.unit_label, qty)}
        </button>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 16 }}>
          <span className="thumb" style={{ width: 88, height: 88, borderRadius: 18, background: 'var(--food)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
            <FoodArt icon={preset.icon} photo={preset.photo} size={88} label={preset.name} />
          </span>
          <div className="grow">
            <div className="small muted">Usual: {describeQuantity(preset, 1)}</div>
            <div className="small muted">
              {item.unit_label === 'g' ? '' : `1 ${item.unit_label} ≈ ${item.grams_per_unit} g · `}
              {preview && preview.energy_kcal.value !== null
                ? `${formatTotal(preview.energy_kcal, 'kcal')} · ${formatTotal(preview.protein_g, 'g protein')} (estimate)`
                : 'Nutrition not set yet'}
            </div>
          </div>
        </div>
        <Stepper
          label="Amount"
          value={describeAmount(item.unit_label, qty)}
          onDec={() => setMult((m) => Math.max(step, Math.round((m - step) * 1000) / 1000))}
          onInc={() => setMult((m) => Math.min(20, Math.round((m + step) * 1000) / 1000))}
          disabledDec={mult <= step}
        />
        <Segmented label="Meal" value={s} onChange={setS} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); navigate('meal', preset.id); }}>
          <Icon name="edit" size={16} /> Edit meal, portion or nutrition
        </button>
      </div>
    </Sheet>
  );
}

function EntrySheet({ entry, onClose }: { entry: MealEntry; onClose: () => void }) {
  const { journal, refresh, notify, today } = useJournal();
  const [mult, setMult] = useState(entry.quantity);
  const [slot, setSlot] = useState<MealSlot>(entry.slot);
  const preview = rescaleEntry(entry, mult);
  const step = 0.5;
  const commit = async (fn: () => Promise<void>, msg: string, undo?: () => Promise<void>) => {
    try {
      await fn();
      refresh();
      onClose();
      notify({ kind: 'info', message: msg, action: undo ? { label: 'Undo', run: () => void undo().then(refresh) } : undefined });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  return (
    <Sheet
      title={entry.name}
      onClose={onClose}
      actions={
        <>
          <button className="btn danger" onClick={() => commit(async () => {
            const cur = await journal.db.get('meal_entries', entry.id);
            if (cur) await journal.remove('meal_entries', cur);
          }, `Deleted ${entry.name}`, async () => {
            const c = await journal.db.get('meal_entries', entry.id);
            if (c) await journal.commit('meal_entries', { ...c, deleted_at: null });
          })}>
            <Icon name="trash" size={18} /> Delete
          </button>
          <button className="btn grow" onClick={() => commit(async () => {
            const cur = await journal.db.get('meal_entries', entry.id);
            if (cur) await journal.commit('meal_entries', { ...rescaleEntry(cur, mult), slot });
          }, `Updated ${entry.name}`)}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Stepper label="Amount" value={preview.items.map((i) => describeAmount(i.unit_label, i.quantity)).join(' + ')}
          onDec={() => setMult((m) => Math.max(step, m - step))} onInc={() => setMult((m) => Math.min(20, m + step))} disabledDec={mult <= step} />
        <Segmented label="Meal" value={slot} onChange={setSlot} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
        <button className="btn secondary" onClick={() => commit(async () => {
          const [copy] = copyEntries([entry], today, new Date(), journal.ownerId);
          await journal.commit('meal_entries', copy!);
        }, `Added ${entry.name} again${entry.local_date === today ? '' : ' today'}`)}>
          <Icon name="repeat" size={18} /> Add again {entry.local_date === today ? '' : 'today'}
        </button>
        <details className="more">
          <summary><Icon name="info" size={16} /> Details</summary>
          <div className="small muted stack-sm">
            {entry.items.map((i, k) => (
              <div key={k}>
                {i.label}: {i.grams} g · {formatTotal({ value: i.nutrients.energy_kcal, complete: i.complete.energy_kcal !== false }, 'kcal')} · {formatTotal({ value: i.nutrients.protein_g, complete: i.complete.protein_g !== false }, 'g protein')}
                {i.estimated ? ' · estimate' : ''}
              </div>
            ))}
            <div>Logged values stay as they were, even if you change the recipe later.</div>
          </div>
        </details>
      </div>
    </Sheet>
  );
}

function AllMealsSheet({ presets, onPick, onClose }: { presets: MealPreset[]; onPick: (p: MealPreset) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const shown = presets.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet title="Your meals" onClose={onClose}>
      <div className="stack">
        <input className="input" type="search" placeholder="Search your meals" aria-label="Search your meals" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list-divided">
          {shown.map((p) => (
            <button key={p.id} className="ex-row" onClick={() => onPick(p)}>
              <span className="ex-art" style={{ background: 'var(--food)', overflow: 'hidden' }}><FoodArt icon={p.icon} photo={p.photo} size={52} label={p.name} /></span>
              <span className="grow"><span className="er-name">{p.name}</span><br /><span className="er-sub">{describeQuantity(p, 1)}</span></span>
              <Icon name="chevronRight" />
            </button>
          ))}
          {shown.length === 0 ? <p className="muted small" style={{ padding: 12 }}>No meals match “{q}”.</p> : null}
        </div>
        <button className="btn secondary" onClick={() => { onClose(); navigate('meal', 'new'); }}><Icon name="plus" size={18} /> Create a meal</button>
      </div>
    </Sheet>
  );
}

export function FoodScreen() {
  const { journal, profile, today, refresh, notify, mode } = useJournal();
  const [date, setDate] = useState(today);
  const { data: lib } = useLibrary();
  const recent = useQuery((j) => j.mealsBetween(addDays(today, -14), today), [today]);
  const entries = useQuery((j) => j.mealsOn(date), [date]);
  const yesterday = useQuery((j) => j.mealsOn(addDays(date, -1)), [date]);
  const status = useQuery((j) => j.db.get('daily_log_status', date), [date]);
  const presets = useMemo(() => (lib && recent ? sortPresets(lib.presets, recent) : null), [lib, recent]);
  const { logPreset } = useMealLogging();
  const defaultSlot: MealSlot = date === today ? slotForHour(localHourIn(profile.timezone)) : 'lunch';

  const [adding, setAdding] = useState<{ preset: MealPreset; slot: MealSlot } | null>(null);
  const [editing, setEditing] = useState<MealEntry | null>(null);
  const [menu, setMenu] = useState(false);
  const [all, setAll] = useState<MealSlot | null>(null);
  const [photo, setPhoto] = useState(false);

  const markComplete = async () => {
    try {
      await journal.commit('daily_log_status', { local_date: date, owner_id: journal.ownerId, intake_complete: !(status?.intake_complete ?? false), updated_at: new Date().toISOString() });
      refresh();
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  const repeatYesterday = async () => {
    if (!yesterday?.length) return;
    try {
      const copies = copyEntries(yesterday, date, new Date(), journal.ownerId).map((c) => ({ ...c, synthetic: profile.synthetic }));
      for (const c of copies) await journal.commit('meal_entries', c);
      refresh();
      notify({
        kind: 'info',
        message: `Added ${copies.length} meal${copies.length === 1 ? '' : 's'} from the day before`,
        action: { label: 'Undo', run: async () => { for (const c of copies) { const cur = await journal.db.get('meal_entries', c.id); if (cur) await journal.remove('meal_entries', cur); } refresh(); } },
      });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}><Icon name="chevronLeft" /></button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>{dayLabel(date, today)}</div>
          <div className="label">{formatShortDate(date)}</div>
        </div>
        <button className="icon-btn" aria-label="Next day" onClick={() => setDate((d) => addDays(d, 1))} disabled={date >= today}><Icon name="chevronRight" /></button>
      </div>

      <div className="card food">
        {entries ? <NutritionSummary entries={entries} targets={profile.targets} dayComplete={status?.intake_complete ?? false} /> : <div className="skeleton" />}
      </div>

      <Section title="Your usual meals" action={presets && presets.length > 6 ? <button className="link" onClick={() => setAll(defaultSlot)}>See all</button> : undefined}>
        {presets === null ? <div className="skeleton" /> : presets.length === 0 ? (
          <div className="card flat">
            <EmptyState icon="food" tone="food" title="Save the meals you eat often" action={<button className="btn" onClick={() => navigate('meal', 'new')}>Create a meal</button>}>
              Then logging them is one tap.
            </EmptyState>
          </div>
        ) : (
          <div className="carousel" role="list" aria-label="Usual meals">
            {presets.slice(0, 12).map((p) => (
              <div role="listitem" key={p.id}>
                <MealCard preset={p} onOpen={() => setAdding({ preset: p, slot: defaultSlot })} onQuickAdd={() => void logPreset(p, 1, { slot: defaultSlot, date })} />
              </div>
            ))}
          </div>
        )}
        <button className="btn block" onClick={() => setMenu(true)}><Icon name="plus" size={20} /> Add food</button>
      </Section>

      <Section title={date === today ? 'Today’s meals' : `Meals · ${dayLabel(date, today)}`}>
        <div className="card tight stack-sm">
          {SLOTS.map((slot) => {
            const list = (entries ?? []).filter((e) => e.slot === slot);
            return (
              <div key={slot}>
                <div className="slot-head">
                  <h3>{SLOT_LABEL[slot]}</h3>
                  <button className="link" onClick={() => setAll(slot)} aria-label={`Add to ${SLOT_LABEL[slot]}`}><Icon name="plus" size={16} /> Add</button>
                </div>
                {list.length === 0 ? <div className="label" style={{ paddingBottom: 8 }}>Not logged</div> : list.map((e) => {
                  const t = totalsOfItems(e.items);
                  return (
                    <button key={e.id} className="meal-row" style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', color: 'inherit' }} onClick={() => setEditing(e)} aria-label={`Edit ${e.name}`}>
                      <span className="mini-thumb"><FoodArt icon={e.icon} photo={lib?.presets.find((p) => p.id === e.preset_id)?.photo} size={48} label={e.name} /></span>
                      <span className="grow">
                        <span className="mr-name">{e.name}</span><br />
                        <span className="mr-sub">{e.items.map((i) => describeAmount(i.unit_label, i.quantity)).join(' + ')} · {formatTime(e.logged_at, e.timezone)}</span>
                      </span>
                      <span className="small muted num" style={{ textAlign: 'right' }}>{t.energy_kcal.value === null ? '—' : formatTotal(t.energy_kcal, 'kcal')}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <button className="btn secondary block" aria-pressed={status?.intake_complete ?? false} onClick={markComplete}>
          <Icon name="check" size={18} /> {status?.intake_complete ? 'Marked as fully logged' : 'I’ve logged everything for this day'}
        </button>
      </Section>

      {menu ? (
        <Sheet title="Add food" onClose={() => setMenu(false)}>
          <div className="stack-sm">
            <button className="choice" onClick={() => { setMenu(false); setAll(defaultSlot); }}>
              <Icon name="star" /> <span className="grow"><strong>Usual meal</strong><br /><span className="small muted">Pick from your saved meals</span></span>
            </button>
            <button className="choice" onClick={() => { setMenu(false); navigate('meal', 'new'); }}>
              <Icon name="edit" /> <span className="grow"><strong>Create meal</strong><br /><span className="small muted">From a label or your own recipe</span></span>
            </button>
            <button className="choice" onClick={() => { setMenu(false); setPhoto(true); }}>
              <Icon name="camera" /> <span className="grow"><strong>Photo</strong><br /><span className="small muted">{mode === 'account' ? 'Get dish suggestions, then confirm' : 'Use a photo as a meal picture'}</span></span>
            </button>
            {yesterday && yesterday.length ? (
              <button className="choice" onClick={() => { setMenu(false); void repeatYesterday(); }}>
                <Icon name="repeat" /> <span className="grow"><strong>Repeat the day before</strong><br /><span className="small muted">{yesterday.length} meal{yesterday.length === 1 ? '' : 's'}</span></span>
              </button>
            ) : null}
          </div>
        </Sheet>
      ) : null}
      {all && presets ? <AllMealsSheet presets={presets} onClose={() => setAll(null)} onPick={(p) => { const s = all; setAll(null); setAdding({ preset: p, slot: s }); }} /> : null}
      {adding ? <AddMealSheet preset={adding.preset} slot={adding.slot} date={date} onClose={() => setAdding(null)} /> : null}
      {editing ? <EntrySheet entry={editing} onClose={() => setEditing(null)} /> : null}
      {photo && presets ? <PhotoSheet presets={presets} onClose={() => setPhoto(false)} onPickPreset={(p) => { setPhoto(false); setAdding({ preset: p, slot: defaultSlot }); }} /> : null}
    </div>
  );
}
