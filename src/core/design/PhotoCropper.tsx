import { useEffect, useRef, useState } from 'react';
import { loadImage, renderCrop } from '@/core/ai/photo';
import { Icon } from './icons';

export interface CroppedPhoto {
  /** For analysis: 768 px square JPEG, metadata dropped by re-encoding. */
  analysis: string;
  /** For an opt-in meal picture: 240 px square JPEG. */
  thumb: string;
}

/**
 * Choose a photo, then drag/zoom to frame just the food (or notes). Only the cropped,
 * downsized re-encode leaves this component; the original file is never stored.
 */
export function PhotoCropper({ onDone, hint }: { onDone: (p: CroppedPhoto) => void; hint: string }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [frameSize, setFrameSize] = useState(320);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameSize(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  const choose = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith('image/') || f.size > 25_000_000) return setError('Please choose a photo (JPEG, PNG or HEIC up to 25 MB).');
    try {
      const im = await loadImage(f);
      setImg(im);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch {
      setError('This photo couldn’t be opened on this device. Try another one.');
    }
  };

  // Base scale = cover the square frame.
  const base = img ? Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : 0;
  const h = img ? img.naturalHeight * scale : 0;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(0, Math.max(frameSize - w, p.x)),
    y: Math.min(0, Math.max(frameSize - h, p.y)),
  });
  const pos = clamp({ x: (frameSize - w) / 2 + pan.x, y: (frameSize - h) / 2 + pan.y });

  const finish = () => {
    if (!img) return;
    const crop = { x: -pos.x / scale, y: -pos.y / scale, size: frameSize / scale };
    try {
      onDone({ analysis: renderCrop(img, crop, 768, 0.8), thumb: renderCrop(img, crop, 240, 0.78) });
    } catch {
      setError('Couldn’t prepare the photo on this device.');
    }
  };

  if (!img) {
    return (
      <div className="stack">
        <p className="small muted">{hint}</p>
        <label className="btn block" style={{ position: 'relative' }}>
          <Icon name="camera" /> Take or choose a photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
        </label>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
      </div>
    );
  }
  return (
    <div className="stack">
      <div
        ref={frame}
        className="photo-crop"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
        }}
        onPointerUp={() => (drag.current = null)}
        aria-label="Photo framing area. Drag to move, use the zoom slider to enlarge."
        role="img"
      >
        <img src={img.src} alt="" style={{ width: w, height: h, left: pos.x, top: pos.y }} />
      </div>
      <label className="field">
        Zoom
        <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </label>
      <div className="row">
        <button className="btn secondary" onClick={() => setImg(null)}>Choose another</button>
        <button className="btn grow" onClick={finish}>Use this photo</button>
      </div>
      <p className="label">Only this square is used. The original photo isn’t saved.</p>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
    </div>
  );
}
