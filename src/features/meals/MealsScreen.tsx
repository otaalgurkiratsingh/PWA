import { useMemo, useState } from 'react';
import type { MealEntry, MealSlot } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { Sheet } from '@/app/Sheet';
import { FoodIcon } from '@/core/design/icons';
import { formatTime } from '@/core/time/localDate';
import { addDays } from '@/domain/metrics/metrics';
import { formatTotal, totalsOfItems } from '@/domain/nutrition/calc';
import { MealTiles } from './MealTiles';
import { NutritionSummary } from './NutritionSummary';
import { SLOT_LABEL, copyEntries, rescaleEntry } from './mealActions';
import { saveErrorMessage, sortByUse, useLibrary } from './useMeals';

export function MealTimeline({ entries, onEdit }: { entries: MealEntry[]; onEdit?: (e: MealEntry) => void }) {
  const { profile } = useJournal();
  if (entries.length === 0) return <p className="empty">No meals logged today. Tap a tile to log one.</p>;
  return (
    <ul className="timeline">
      {entries.map((e) => {
        const t = totalsOfItems(e.items);
        return (
          <li key={e.id}>
            <span className="t-time">{formatTime(e.logged_at, e.timezone || profile.timezone)}<br />{SLOT_LABEL[e.slot]}</span>
            <span className="tile-art" style={{ width: 40, height: 40 }}><FoodIcon name={e.icon} size={22} /></span>
            <span className="t-body">
              <span className="t-name">{e.name}</span>
              <br />
              <span className="muted small">
                {e.items.map((i) => `${i.quantity} ${i.unit_label}`).join(' + ')} · {formatTotal(t.energy_kcal, 'kcal')} ·{' '}
                {formatTotal(t.protein_g, 'g protein')}
              </span>
            </span>
            {onEdit ? (
              <button className="btn secondary" style={{ minWidth: 64 }} onClick={() => onEdit(e)} aria-label={`Edit ${e.name}`}>
                Edit
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EditSheet({ entry, onClose }: { entry: MealEntry; onClose: () => void }) {
  const { journal, refresh, notify } = useJournal();
  const [mult, setMult] = useState(entry.quantity);
  const [slot, setSlot] = useState<MealSlot>(entry.slot);
  const save = async () => {
    try {
      const current = await journal.db.get('meal_entries', entry.id);
      if (!current) return onClose();
      await journal.commit('meal_entries', { ...rescaleEntry(current, mult), slot });
      refresh();
      notify({ kind: 'info', message: `Updated ${entry.name}` });
      onClose();
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  const del = async () => {
    try {
      const current = await journal.db.get('meal_entries', entry.id);
      if (current) await journal.remove('meal_entries', current);
      refresh();
      onClose();
      notify({
        kind: 'info',
        message: `Deleted ${entry.name}`,
        action: {
          label: 'Undo',
          run: async () => {
            const c = await journal.db.get('meal_entries', entry.id);
            if (c) await journal.commit('meal_entries', { ...c, deleted_at: null });
            refresh();
          },
        },
      });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  const step = 0.5;
  return (
    <Sheet title={`Edit ${entry.name}`} onClose={onClose}>
      <div className="stepper">
        <button className="icon-btn" aria-label="Less" onClick={() => setMult((m) => Math.max(step, m - step))}>−</button>
        <output aria-live="polite">×{mult}</output>
        <button className="icon-btn" aria-label="More" onClick={() => setMult((m) => Math.min(10, m + step))}>+</button>
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>
        {rescaleEntry(entry, mult).items.map((i) => `${i.quantity} ${i.unit_label} (${i.grams} g)`).join(' + ')}
      </p>
      <label className="field" style={{ marginBottom: 16 }}>
        Meal
        <select className="input" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
          {(Object.keys(SLOT_LABEL) as MealSlot[]).map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
        </select>
      </label>
      <p className="muted small">
        Nutrition values stay tied to the recipe/food version used when this was logged
        {entry.items.map((i) => ` (${i.label} rev ${i.source_ref.revision})`).join(',')}.
      </p>
      <div className="row">
        <button className="btn danger" onClick={del}>Delete</button>
        <span className="spacer" />
        <button className="btn" onClick={save}>Save</button>
      </div>
    </Sheet>
  );
}

export function MealsScreen() {
  const { journal, profile, today, refresh, notify } = useJournal();
  const { data: lib } = useLibrary();
  const recent = useQuery((j) => j.mealsBetween(addDays(today, -14), today), [today]);
  const presets = useMemo(() => (lib && recent ? sortByUse(lib.presets, recent) : null), [lib, recent]);
  const entries = useQuery((j) => j.mealsOn(today), [today]);
  const yesterday = useQuery((j) => j.mealsOn(addDays(today, -1)), [today]);
  const status = useQuery((j) => j.db.get('daily_log_status', today), [today]);
  const [editing, setEditing] = useState<MealEntry | null>(null);
  const [photoInfo, setPhotoInfo] = useState(false);

  const repeatYesterday = async () => {
    if (!yesterday?.length) return;
    try {
      const copies = copyEntries(yesterday, today, new Date(), journal.ownerId).map((c) => ({ ...c, synthetic: profile.synthetic }));
      for (const c of copies) await journal.commit('meal_entries', c);
      refresh();
      notify({
        kind: 'info',
        message: `Copied ${copies.length} items from yesterday`,
        action: {
          label: 'Undo',
          run: async () => {
            for (const c of copies) {
              const cur = await journal.db.get('meal_entries', c.id);
              if (cur) await journal.remove('meal_entries', cur);
            }
            refresh();
          },
        },
      });
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  const toggleComplete = async () => {
    try {
      await journal.commit('daily_log_status', {
        local_date: today,
        owner_id: journal.ownerId,
        intake_complete: !(status?.intake_complete ?? false),
        updated_at: new Date().toISOString(),
      });
      refresh();
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  return (
    <div className="stack">
      <section className="card" aria-labelledby="today-intake">
        <div className="card-head">
          <h2 id="today-intake">Today’s intake</h2>
        </div>
        {entries ? <NutritionSummary entries={entries} targets={profile.targets} dayComplete={status?.intake_complete ?? null} /> : <div className="skeleton" />}
        <button className="btn secondary block" style={{ marginTop: 12 }} onClick={toggleComplete} aria-pressed={status?.intake_complete ?? false}>
          {status?.intake_complete ? '✓ Day marked complete — tap to undo' : 'Mark today’s log complete'}
        </button>
      </section>

      <h2 className="section-title">Your usual meals</h2>
      {presets ? <MealTiles presets={presets} /> : <div className="skeleton" />}
      <div className="row wrap">
        <button className="btn secondary" onClick={repeatYesterday} disabled={!yesterday?.length}>
          Repeat yesterday{yesterday?.length ? ` (${yesterday.length})` : ''}
        </button>
        <button className="btn ghost" onClick={() => setPhotoInfo(true)}>Photo suggestion…</button>
      </div>

      <section className="card" aria-labelledby="timeline-h">
        <h2 id="timeline-h">Today’s timeline</h2>
        {entries ? <MealTimeline entries={entries} onEdit={setEditing} /> : <div className="skeleton" />}
      </section>

      {editing ? <EditSheet entry={editing} onClose={() => setEditing(null)} /> : null}
      {photoInfo ? (
        <Sheet title="Photo suggestions" onClose={() => setPhotoInfo(false)}>
          <p><span className="badge">Not set up</span></p>
          <p>
            Photo-assisted logging is planned for Phase 2. It will suggest dish candidates and ask questions — it will never
            produce authoritative calories from a photo. It needs a protected backend and your separate AI consent, so it is
            switched off in this local demo.
          </p>
          <button className="btn block" onClick={() => setPhotoInfo(false)}>OK</button>
        </Sheet>
      ) : null}
    </div>
  );
}
