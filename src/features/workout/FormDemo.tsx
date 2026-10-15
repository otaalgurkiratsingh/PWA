/**
 * Exercise form demos: the How-to sheet with the free-exercise-db start/end photos crossfading
 * on a loop (static side by side with reduced motion). Loaded on demand by FormButton.tsx, so
 * none of this is in the initial bundle. Photos are same-origin (vendored at build time) and
 * only requested while a sheet is open.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { GuideExercise } from '@shared/catalogue/exerciseGuide';
import { FORM_PHOTO_MANIFEST, parsePhotoManifest, photoAvailability, photoPaths } from '@shared/catalogue/exerciseImages';
import { Sheet } from '@/core/design/ui';

export const NO_PHOTO_LINE = 'No photo demo for this one yet — steps below.';

const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: 'barbell', dumbbell: 'dumbbells', cable: 'cable', machine: 'machine', bodyweight: 'bodyweight', kettlebell: 'kettlebell', band: 'band', other: 'other equipment',
};

let manifest: Promise<Set<string> | null> | null = null;
/** The build's list of exercises with photos; fetched once, on the first sheet that needs it. */
export function loadPhotoManifest(): Promise<Set<string> | null> {
  manifest ??= fetch(FORM_PHOTO_MANIFEST)
    .then((r) => (r.ok ? r.json() : null))
    .then(parsePhotoManifest)
    .catch(() => null)
    .then((m) => {
      if (!m) manifest = null; // try again next time (e.g. back online)
      return m;
    });
  return manifest;
}

/** Start and end photos crossfading on a loop; side by side with reduced motion. Hidden if a photo fails. */
export function FormPreview({ sourceId, name }: { sourceId: string | null; name: string }) {
  const [ids, setIds] = useState<Set<string> | null | undefined>(sourceId ? undefined : null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!sourceId) return;
    let live = true;
    void loadPhotoManifest().then((m) => live && setIds(m));
    return () => { live = false; };
  }, [sourceId]);

  const availability = photoAvailability(sourceId, ids ?? null);
  if (sourceId && ids === undefined) return <div className="form-demo-wait skeleton" aria-hidden="true" />;
  if (availability === 'none' || failed || !sourceId) return <p className="form-none">{NO_PHOTO_LINE}</p>;

  const [start, end] = photoPaths(sourceId);
  const onLoad = () => setLoaded((n) => n + 1);
  const onError = () => setFailed(true);
  return (
    <figure className={`form-demo${loaded >= 2 ? ' ready' : ''}`} data-testid="form-demo">
      <div className="form-frames">
        <figure className="form-frame start">
          <img src={start} alt={`${name} — start position`} width={850} height={567} decoding="async" onLoad={onLoad} onError={onError} />
          <figcaption>Start</figcaption>
        </figure>
        <figure className="form-frame end">
          <img src={end} alt={`${name} — end position`} width={850} height={567} decoding="async" onLoad={onLoad} onError={onError} />
          <figcaption>End</figcaption>
        </figure>
      </div>
      <figcaption className="form-credit">Photos: free-exercise-db (public domain)</figcaption>
    </figure>
  );
}

/** The How-to sheet: form photos first, then level, muscles, equipment and the steps. */
export function HowToSheet({ name, exercise, custom = false, onClose, actions }: {
  name: string; exercise: GuideExercise | null; custom?: boolean; onClose: () => void; actions?: ReactNode;
}) {
  const meta = exercise ? [exercise.level, ...exercise.primary_muscles, EQUIPMENT_LABEL[exercise.equipment]].filter(Boolean).join(' · ') : '';
  return (
    <Sheet title={name} onClose={onClose} actions={actions}>
      <div className="stack-sm">
        <FormPreview sourceId={exercise?.source_id ?? null} name={name} />
        {meta ? <span className="small muted">{meta}</span> : null}
        {exercise?.instructions.length ? (
          <ol className="how-to">{exercise.instructions.map((t, i) => <li key={i}>{t}</li>)}</ol>
        ) : (
          <p className="small muted">{custom ? 'This is your own exercise, so there are no written steps for it.' : 'No written steps for this one yet.'}</p>
        )}
        <p className="label">Steps from the public-domain free-exercise-db or written for TrainLuma. Stop if anything hurts; ask a qualified professional about pain or injuries.</p>
      </div>
    </Sheet>
  );
}
