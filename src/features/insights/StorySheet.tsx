import { useEffect, useState } from 'react';
import { Icon } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';
import { renderStoryPng, shareStory, type StoryCard } from './story';
import './insights.css';

type Shot = { kind: 'loading' } | { kind: 'ready'; blob: Blob; url: string } | { kind: 'error' };

function canShareFiles(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return typeof nav.share === 'function' && !!nav.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** Draw the story image once and keep a preview URL for it (revoked on unmount). */
function useStoryImage(card: StoryCard): Shot {
  const [shot, setShot] = useState<Shot>({ kind: 'loading' });
  const key = JSON.stringify(card);
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    renderStoryPng(JSON.parse(key) as StoryCard).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setShot({ kind: 'ready', blob, url });
      },
      () => live && setShot({ kind: 'error' }),
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [key]);
  return shot;
}

/** Preview of the story image plus a Share/Save button. Used inside a sheet. */
export function StoryPreview({ card, filename, onDone }: {
  card: StoryCard;
  filename: string;
  /** Called after the image was shared or saved (not when the share sheet was dismissed). */
  onDone?: (result: 'shared' | 'downloaded') => void;
}) {
  const shot = useStoryImage(card);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const sharable = canShareFiles();

  const go = async () => {
    if (shot.kind !== 'ready') return;
    setBusy(true);
    const r = await shareStory(shot.blob, filename);
    setBusy(false);
    if (r === 'cancelled') return;
    setStatus(r === 'shared' ? 'Shared. Nice one!' : 'Saved to your downloads.');
    onDone?.(r);
  };

  return (
    <div className="stack ins-preview">
      <div className="ins-preview-frame">
        {shot.kind === 'ready' ? (
          <img src={shot.url} alt={`Story card: ${card.headline}. ${card.stats.map((s) => `${s.label}: ${s.value}`).join('. ')}.`} />
        ) : shot.kind === 'loading' ? (
          <div className="ins-preview-loading" role="status">Drawing your card…</div>
        ) : (
          <div className="ins-preview-loading" role="alert">This browser can’t draw the image. Your recap is still here in the app.</div>
        )}
      </div>
      <button className="btn block" onClick={() => void go()} disabled={shot.kind !== 'ready' || busy}>
        <Icon name={sharable ? 'upload' : 'download'} />
        {sharable ? 'Share' : 'Save image'}
      </button>
      <p className="label ins-center" aria-live="polite">{status ?? 'Nothing is shared unless you choose to.'}</p>
    </div>
  );
}

/** Bottom sheet wrapper around the preview. */
export function StorySheet({ card, filename, onClose, onDone }: {
  card: StoryCard;
  filename: string;
  onClose: () => void;
  onDone?: (result: 'shared' | 'downloaded') => void;
}) {
  return (
    <Sheet title="Share as story" onClose={onClose}>
      <StoryPreview card={card} filename={filename} onDone={onDone} />
    </Sheet>
  );
}
