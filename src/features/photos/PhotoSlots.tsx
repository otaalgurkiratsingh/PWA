import { useCallback, useEffect, useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { Icon } from '@/core/design/icons';
import { PhotoCropper } from '@/core/design/PhotoCropper';
import { Sheet, Toggle } from '@/core/design/ui';
import { deletePhoto, listPhotos, photoObjectUrl, SLOTS, uploadPhoto, type PhotoSlot, type StoredPhoto } from '@/core/photos/progressPhotos';

/** A photo the person chose not to store: kept in memory for this session only. */
export interface SessionPhoto { slot: PhotoSlot; dataUrl: string }

const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label])) as Record<PhotoSlot, string>;

/** Thumbnail from private storage via the person's own session; the URL is revoked on unmount. */
function StoredThumb({ photo, label }: { photo: StoredPhoto; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    photoObjectUrl(photo.object_path).then((u) => { made = u; if (live) setUrl(u); else URL.revokeObjectURL(u); }, () => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [photo.object_path]);
  if (failed) return <span className="small muted">Couldn’t load</span>;
  return url ? <img src={url} alt={`${label} photo`} /> : <span className="spinner" />;
}

export function PhotoPermissions() {
  const { profile, updateProfile } = useJournal();
  const set = (patch: Partial<typeof profile.consent>) => void updateProfile({ ...profile, consent: { ...profile.consent, ...patch, updated_at: new Date().toISOString() } });
  return (
    <div className="card flat stack-sm">
      <Toggle label="Keep my photos in private storage" checked={profile.consent.photo_storage}
        onChange={(v) => set({ photo_storage: v })}
        description="Saved in your private, owner-only storage to compare progress over time. Off: photos stay on this screen only and disappear when you leave." />
      <Toggle label="Let AI Coach see the photos I add when drafting my plan" checked={profile.consent.ai_images}
        onChange={(v) => set({ ai_images: v })}
        description="Sent once through TrainLuma’s backend to Google’s Gemini API for limited context. Not needed for a plan. Google may keep requests briefly for abuse monitoring." />
    </div>
  );
}

export function PhotoSlots({ session, onSessionChange }: { session: SessionPhoto[]; onSessionChange: (p: SessionPhoto[]) => void }) {
  const { journal, profile, notify, flushConsents } = useJournal();
  const store = profile.consent.photo_storage;
  const [stored, setStored] = useState<StoredPhoto[] | null>(null);
  const [adding, setAdding] = useState<PhotoSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listPhotos().then(setStored, () => setStored([]));
  }, []);
  useEffect(() => {
    const t = window.setTimeout(reload, 0);
    return () => window.clearTimeout(t);
  }, [reload]);

  const latest = (slot: PhotoSlot) => stored?.find((p) => p.slot === slot) ?? null;
  const inSession = (slot: PhotoSlot) => session.find((p) => p.slot === slot) ?? null;

  const save = async (slot: PhotoSlot, dataUrl: string) => {
    setAdding(null);
    setError(null);
    if (!store) {
      onSessionChange([...session.filter((p) => p.slot !== slot), { slot, dataUrl }]);
      return;
    }
    setBusy(true);
    try {
      await flushConsents(); // the storage permission must be on record before the upload is allowed
      const prev = latest(slot);
      await uploadPhoto(journal.ownerId, slot, dataUrl, 768);
      if (prev) await deletePhoto(prev); // replace: keep one current photo per slot
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const remove = async (slot: PhotoSlot) => {
    const s = inSession(slot);
    if (s) onSessionChange(session.filter((p) => p.slot !== slot));
    const p = latest(slot);
    if (!p) return;
    setBusy(true);
    try {
      for (const x of (stored ?? []).filter((q) => q.slot === slot)) await deletePhoto(x);
      notify({ kind: 'info', message: `${SLOT_LABEL[slot]} photo deleted.` });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      <div className="photo-grid">
        {SLOTS.map(({ slot, label }) => {
          const p = latest(slot);
          const s = inSession(slot);
          return (
            <div key={slot} className={`photo-slot${slot === 'inspiration' ? ' wide' : ''}`}>
              <div className="ps-frame">
                {s ? <img src={s.dataUrl} alt={`${label} photo (not saved)`} /> : p ? <StoredThumb photo={p} label={label} /> : <Icon name="photo" size={28} />}
              </div>
              <div className="ps-meta">
                <strong>{label}</strong>
                <span className="label">{s ? 'This screen only' : p ? 'Saved privately' : 'Optional'}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm secondary" disabled={busy} onClick={() => setAdding(slot)}>{p || s ? 'Replace' : 'Add'}</button>
                {p || s ? <button className="icon-btn plain" aria-label={`Delete ${label} photo`} disabled={busy} onClick={() => void remove(slot)}><Icon name="trash" size={18} /></button> : null}
              </div>
            </div>
          );
        })}
      </div>
      {busy ? <div className="row muted small"><span className="spinner" /> Working…</div> : null}
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {adding ? (
        <Sheet title={`${SLOT_LABEL[adding]} photo`} onClose={() => setAdding(null)}>
          <PhotoCropper
            hint={adding === 'inspiration'
              ? 'Any image of a goal you like. It helps describe your goal; it does not predict your results. Crop out faces if you prefer.'
              : 'Stand in the same spot with similar light each time. Crop out your face if you like. Only the square you choose is kept, and location data is removed.'}
            onDone={(c) => void save(adding, c.analysis)}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

export function PhotoGuidance() {
  return (
    <div className="stack-sm">
      <p className="muted" style={{ margin: 0 }}>Wear whatever feels comfortable. Photos are not needed to create your plan.</p>
      <p className="small muted" style={{ margin: 0 }}>An inspiration photo helps describe your goal; it does not predict your results.</p>
    </div>
  );
}
