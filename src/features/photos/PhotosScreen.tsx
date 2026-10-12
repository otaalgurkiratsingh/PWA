import { useState } from 'react';
import { useJournal } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { Icon } from '@/core/design/icons';
import { EmptyState } from '@/core/design/ui';
import { PhotoGuidance, PhotoPermissions, PhotoSlots, type SessionPhoto } from './PhotoSlots';

/** Settings → Optional progress photos. Everything here can be skipped or deleted. */
export function PhotosScreen() {
  const { mode } = useJournal();
  const [session, setSession] = useState<SessionPhoto[]>([]);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('settings')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Optional progress photos</h1>
      </div>
      {mode === 'demo' ? (
        <div className="card flat">
          <EmptyState icon="photo" tone="neutral" title="Photos are for signed-in accounts">The demo never stores or sends photos.</EmptyState>
        </div>
      ) : (
        <>
          <PhotoGuidance />
          <PhotoPermissions />
          <PhotoSlots session={session} onSessionChange={setSession} />
          <p className="label">
            Deleting a photo removes it from your storage now. Provider backups expire on their own schedule. AI Coach never estimates body fat,
            posture or health from photos, and never compares you with anyone.
          </p>
        </>
      )}
    </div>
  );
}
