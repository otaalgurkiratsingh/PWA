import { useState } from 'react';
import type { MealPreset } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { navigate } from '@/app/router';
import { base64Of } from '@/core/ai/photo';
import { callAi, type FoodPhotoOutput } from '@/core/ai/client';
import { FoodArt } from '@/core/design/foodArt';
import { Icon } from '@/core/design/icons';
import { PhotoCropper, type CroppedPhoto } from '@/core/design/PhotoCropper';
import { Sheet } from '@/core/design/ui';
import { saveErrorMessage } from './useFood';

export const MEAL_DRAFT_KEY = 'rozana.mealDraft';

export function stashMealDraft(d: { name?: string; photo?: string | null }) {
  try {
    sessionStorage.setItem(MEAL_DRAFT_KEY, JSON.stringify(d));
  } catch {
    // draft prefill is a convenience
  }
}

export function PhotoSheet({ presets, onClose, onPickPreset }: { presets: MealPreset[]; onClose: () => void; onPickPreset: (p: MealPreset) => void }) {
  const { mode, profile, journal, refresh, notify } = useJournal();
  const [photo, setPhoto] = useState<CroppedPhoto | null>(null);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'result'; r: FoodPhotoOutput } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [pickFor, setPickFor] = useState(false);
  const aiReady = mode === 'account' && profile.consent.ai_processing;

  const suggest = async () => {
    if (!photo) return;
    setState({ kind: 'loading' });
    const res = await callAi({ operation: 'photo_suggest', kind: 'food', image_base64: base64Of(photo.analysis), presets: presets.slice(0, 60).map((p) => ({ id: p.id, name: p.name })) });
    if (res.status === 'ok' && res.operation === 'photo_suggest' && res.kind === 'food') setState({ kind: 'result', r: res.result });
    else setState({ kind: 'error', message: 'message' in res ? res.message : 'No suggestions right now.' });
  };

  const attachTo = async (p: MealPreset) => {
    if (!photo) return;
    try {
      const cur = await journal.db.get('presets', p.id);
      if (cur) await journal.commit('presets', { ...cur, photo: photo.thumb });
      refresh();
      notify({ kind: 'info', message: `Saved the picture for ${p.name}` });
      onClose();
    } catch (e) {
      notify({ kind: 'error', message: saveErrorMessage(e) });
    }
  };

  return (
    <Sheet title={pickFor ? 'Use as picture for…' : 'Photo'} onClose={onClose}>
      {!photo ? (
        <PhotoCropper onDone={setPhoto} hint={aiReady ? 'Frame just the food. You’ll get dish suggestions to confirm — never automatic calories.' : 'Frame just the food to use it as a meal picture.'} />
      ) : pickFor ? (
        <div className="list-divided">
          {presets.map((p) => (
            <button key={p.id} className="ex-row" onClick={() => void attachTo(p)}>
              <span className="ex-art" style={{ background: 'var(--food)', overflow: 'hidden' }}><FoodArt icon={p.icon} photo={p.photo} size={52} label={p.name} /></span>
              <span className="grow er-name">{p.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="stack">
          <div className="row" style={{ gap: 14 }}>
            <img src={photo.thumb} alt="Your cropped photo" width={88} height={88} style={{ borderRadius: 16 }} />
            <p className="small muted grow">Pictures you save stay private to your account. You can remove them by editing the meal.</p>
          </div>

          {aiReady ? (
            state.kind === 'idle' ? (
              <button className="btn" onClick={suggest}><Icon name="sparkle" /> Suggest dishes</button>
            ) : state.kind === 'loading' ? (
              <div className="row muted"><span className="spinner" /> Looking at your photo…</div>
            ) : state.kind === 'error' ? (
              <div className="notice warn" role="alert">{state.message}</div>
            ) : !state.r.is_food ? (
              <div className="notice">This doesn’t look like food. Try framing just the plate.</div>
            ) : (
              <div className="stack-sm">
                <div className="label">Is it one of these? Nothing is added until you confirm.</div>
                {state.r.candidates.map((c, i) => {
                  const match = presets.find((p) => p.id === c.matched_preset_id);
                  return (
                    <button key={i} className="choice" onClick={() => {
                      if (match) onPickPreset(match);
                      else { stashMealDraft({ name: c.name, photo: photo.thumb }); onClose(); navigate('meal', 'new'); }
                    }}>
                      <span className="grow">
                        <strong>{match ? match.name : c.name}</strong>
                        <br />
                        <span className="small muted">
                          {match ? 'Your saved meal' : 'New — you’ll set the nutrition'}
                          {c.portion_hint ? ` · looks like ${c.portion_hint}` : ''} · {c.confidence} confidence
                        </span>
                      </span>
                      <Icon name="chevronRight" />
                    </button>
                  );
                })}
                {state.r.questions.length ? <div className="notice">{state.r.questions.join(' ')}</div> : null}
              </div>
            )
          ) : (
            <div className="notice">
              {mode === 'demo' ? 'Dish suggestions work after signing in with your own account.' : 'Turn on AI help in Settings to get dish suggestions from photos.'}
            </div>
          )}

          <div className="row wrap">
            <button className="btn secondary grow" onClick={() => setPickFor(true)}>Use as picture for a meal</button>
            <button className="btn secondary grow" onClick={() => { stashMealDraft({ photo: photo.thumb }); onClose(); navigate('meal', 'new'); }}>New meal with this picture</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
