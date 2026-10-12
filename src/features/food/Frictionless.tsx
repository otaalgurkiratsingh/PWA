import { useEffect, useMemo, useRef, useState } from 'react';
import type { MealEntry, MealSlot } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { track } from '@/core/analytics/analytics';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { Segmented, Sheet } from '@/core/design/ui';
import { newId } from '@/core/ids';
import { localHourIn } from '@/core/time/localDate';
import { addDays } from '@/domain/metrics/metrics';
import { routineNudge, slotSuggestions, templateFromEntries } from '@/domain/nutrition/routines';
import { parseVoice, type VoiceItem } from '@/domain/nutrition/voiceParse';
import { useDishLogger, useFoodDb } from './DishParts';
import { SLOT_LABEL, describeQuantity, slotForHour } from './mealActions';
import { saveErrorMessage, useLibrary, useMealLogging } from './useFood';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const DISMISS = (owner: string, today: string) => `trainluma.nudgeDismissed.${owner}.${today}`;

/** T12: "Your usual double-double? [Log it]" — shown around the usual time, gone once logged or dismissed. */
export function NudgeCard() {
  const { journal, profile, today } = useJournal();
  const { data: lib } = useLibrary();
  const entries = useQuery((j) => j.mealsBetween(addDays(today, -14), today), [today]);
  const { logPreset } = useMealLogging();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS(journal.ownerId, today)) === '1'; } catch { return false; } });
  const now = new Date();
  const mins = localHourIn(profile.timezone, now) * 60 + now.getMinutes();
  const nudge = useMemo(() => (lib && entries ? routineNudge(lib.presets, entries, today, mins) : null), [lib, entries, today, mins]);
  if (!nudge || hidden) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS(journal.ownerId, today), '1'); } catch { /* convenience only */ } setHidden(true); };
  return (
    <div className="card nudge-card" role="region" aria-label="Your usual">
      <span className="mini-thumb"><FoodArt icon={nudge.preset.icon} photo={nudge.preset.photo} catalogueId={nudge.preset.catalogue_id} size={48} label={nudge.preset.name} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <strong>Your usual {nudge.preset.name}?</strong>
        <span className="small muted" style={{ display: 'block' }}>{SLOT_LABEL[nudge.slot]} · {describeQuantity(nudge.preset, 1)}</span>
      </span>
      <span className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => void logPreset(nudge.preset, 1, { slot: nudge.slot, method: 'nudge' }).then((e) => e && setHidden(true))}>Log it</button>
        <button className="icon-btn plain" aria-label="Not today" onClick={dismiss}><Icon name="close" size={18} /></button>
      </span>
    </div>
  );
}

/** T11: "Right now" — what this person usually has at this time of day. One tap logs it. */
export function SuggestionsRow({ date }: { date: string }) {
  const { profile, today } = useJournal();
  const { data: lib } = useLibrary();
  const entries = useQuery((j) => j.mealsBetween(addDays(today, -30), today), [today]);
  const { logPreset } = useMealLogging();
  const slot = slotForHour(localHourIn(profile.timezone));
  const picks = useMemo(() => (lib && entries ? slotSuggestions(lib.presets, entries, today, slot) : []), [lib, entries, today, slot]);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (date !== today || !picks.length) return null;
  return (
    <div className="stack-sm">
      <h3 className="picker-head">Right now · {SLOT_LABEL[slot]}</h3>
      <div className="chips wrap" role="list" aria-label={`Usual for ${SLOT_LABEL[slot].toLowerCase()}`}>
        {picks.map((p) => (
          <button key={p.id} role="listitem" className="chip suggestion-chip" disabled={done.has(p.id)}
            onClick={async () => { const e = await logPreset(p, 1, { slot, date, method: 'suggestion' }); if (e) setDone((s) => new Set(s).add(p.id)); }}>
            {done.has(p.id) ? <Icon name="check" size={16} /> : <Icon name="plus" size={16} />} {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** T13: save a day's slot as a one-tap template ("My typical breakfast"). */
export function SaveTemplateSheet({ entries, slot, onClose }: { entries: MealEntry[]; slot: MealSlot; onClose: () => void }) {
  const { journal, refresh, notify } = useJournal();
  const [name, setName] = useState(`My typical ${SLOT_LABEL[slot].toLowerCase()}`);
  const save = async () => {
    try {
      const t = templateFromEntries(entries, name, journal.ownerId, new Date().toISOString(), newId);
      await journal.commit('presets', t);
      refresh();
      track('template_created', { items: t.items.length, slot });
      notify({ kind: 'info', message: `Saved “${t.name}”. It’s one tap from now on.` });
      onClose();
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };
  return (
    <Sheet title="Save as a template" onClose={onClose} actions={<button className="btn block" onClick={() => void save()}>Save template</button>}>
      <div className="stack">
        <label className="field">Name<input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{entries.map((e) => <li key={e.id}>{e.name}</li>)}</ul>
        <p className="label">Includes restaurant and chain items too (e.g. “My Tim’s run”). Logging it later adds every item at once.</p>
      </div>
    </Sheet>
  );
}

// ---------- T15 voice logging ----------

interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
}
type RecognitionCtor = { new (): Recognition; prototype: object };
const Ctor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function VoiceSheet({ date, initialSlot, onClose }: { date: string; initialSlot: MealSlot; onClose: () => void }) {
  const { db } = useFoodDb();
  const { data: lib } = useLibrary();
  const { logPreset } = useMealLogging();
  const logDish = useDishLogger();
  const { notify } = useJournal();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<'local' | 'cloud-ask' | 'cloud' | 'none'>(() => {
    const C = Ctor();
    // Automated browsers have no speech service (and some builds crash on it): typed input only.
    if (!C || navigator.webdriver) return 'none';
    // On-device recognition (audio stays on the phone) where the browser offers it; otherwise ask first.
    return 'processLocally' in C.prototype ? 'local' : 'cloud-ask';
  });
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [items, setItems] = useState<VoiceItem[] | null>(null);
  const rec = useRef<Recognition | null>(null);

  const listen = () => {
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.lang = 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    if (mode === 'local') r.processLocally = true;
    r.onresult = (e) => setText([...Array.from(e.results)].map((x) => x[0]?.transcript ?? '').join(' '));
    r.onerror = (e) => {
      setListening(false);
      if (mode === 'local' && ['language-not-supported', 'service-not-allowed', 'network'].includes(e.error)) {
        setMode('cloud-ask'); // on-device speech isn't ready on this phone: ask before using the browser's service
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') notify({ kind: 'error', message: 'Couldn’t hear that. Try again or type it.' });
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    track('voice_used', { on_device: mode === 'local' });
    r.start();
  };
  useEffect(() => () => rec.current?.stop(), []);

  const understand = () => { if (db && lib) setItems(parseVoice(text, db, lib.presets)); };
  const logAll = async () => {
    if (!items || !db) return;
    let n = 0;
    for (const it of items) {
      if (!it.match) continue;
      const e = it.match.kind === 'preset'
        ? await logPreset(it.match.preset, it.match.multiplier, { slot, date, method: 'voice', quiet: true })
        : await logDish(it.match.dish, db, it.match.multiplier, { slot, date, method: 'voice', quiet: true });
      if (e) n++;
    }
    notify({ kind: 'info', message: `Logged ${n} item${n === 1 ? '' : 's'} for ${SLOT_LABEL[slot].toLowerCase()}.` });
    onClose();
  };

  const matched = items?.filter((i) => i.match) ?? [];
  return (
    <Sheet title="Say what you ate" onClose={onClose} actions={items ? (
      <button className="btn block" disabled={!matched.length} onClick={() => void logAll()}>Log {matched.length} item{matched.length === 1 ? '' : 's'}</button>
    ) : (
      <button className="btn block" disabled={!text.trim() || !db} onClick={understand}>Next</button>
    )}>
      <div className="stack">
        {!items ? (
          <>
            {mode === 'local' || mode === 'cloud' ? (
              <button className={`voice-btn${listening ? ' on' : ''}`} onClick={() => (listening ? rec.current?.stop() : listen())} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Start speaking'}>
                <Icon name="mic" size={34} />
                <span>{listening ? 'Listening…' : 'Tap and speak'}</span>
              </button>
            ) : mode === 'cloud-ask' ? (
              <div className="notice stack-sm" role="note">
                <span>This browser can’t recognise speech on the phone itself. It can use its own speech service (Google or Apple), which receives the audio.</span>
                <button className="btn sm secondary" onClick={() => setMode('cloud')}>Use the browser’s speech service</button>
              </div>
            ) : mode === 'none' ? <p className="small muted">Voice isn’t available in this browser. Type it instead — the same matching works.</p> : null}
            <label className="field">
              {mode === 'none' ? 'What did you eat?' : 'Or type it'}
              <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. rajma chawal and two rotis" />
            </label>
            <span className="label">{mode === 'local' ? 'Speech is recognised on this phone; audio never leaves it.' : 'Your words are matched against your meals and the TrainLuma food database on this phone.'}</span>
          </>
        ) : (
          <>
            <div className="card tight list-divided">
              {items.map((it, i) => (
                <div key={i} className="row voice-item">
                  <span className="grow" style={{ minWidth: 0 }}>
                    {it.match ? <><strong>{it.match.kind === 'preset' ? it.match.preset.name : it.match.dish.name}</strong><span className="small muted"> · {it.match.multiplier === 1 ? '1 serving' : `${it.match.multiplier} × serving`}</span></>
                      : <><strong>“{it.phrase}”</strong><span className="small muted"> · not found — search for it or quick-add after</span></>}
                  </span>
                  <button className="icon-btn plain" aria-label={`Remove ${it.phrase}`} onClick={() => setItems((x) => x!.filter((_, k) => k !== i))}><Icon name="close" size={18} /></button>
                </div>
              ))}
            </div>
            <Segmented label="Meal" value={slot} onChange={setSlot} full options={SLOTS.map((x) => ({ value: x, label: SLOT_LABEL[x] }))} />
            <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setItems(null)}>Change what I said</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Notification action target `#/quicklog/<presetId>/<slot>`: logs the usual in one tap, then shows Today. */
export function QuickLogScreen({ param }: { param: string | null }) {
  const { data: lib } = useLibrary();
  const { logPreset, ready } = useMealLogging();
  const done = useRef(false);
  useEffect(() => {
    if (!lib || !ready || done.current) return;
    done.current = true;
    const [id, slot] = (param ?? '').split('/');
    const preset = lib.presets.find((p) => p.id === id && !p.deleted_at);
    const s = (SLOTS as string[]).includes(slot ?? '') ? (slot as MealSlot) : undefined;
    const go = async () => {
      if (preset) await logPreset(preset, 1, { slot: s, method: 'notification' });
      navigate('today');
    };
    void go();
  }, [lib, ready, param, logPreset]);
  return <div className="skeleton" style={{ height: 120 }} />;
}

