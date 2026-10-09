/**
 * On-device photo preparation: square crop, downscale, re-encode as JPEG.
 * Re-encoding through a canvas drops EXIF/GPS metadata. The original file is never stored or sent.
 */
export interface Crop {
  /** Crop square in source pixels. */
  x: number;
  y: number;
  size: number;
}

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Revoke after decode; the decoded bitmap stays in memory for drawing.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function centerCrop(w: number, h: number): Crop {
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

/** Returns a data URL (image/jpeg). */
export function renderCrop(img: HTMLImageElement, crop: Crop, outSize: number, quality = 0.82): string {
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, outSize, outSize);
  return canvas.toDataURL('image/jpeg', quality);
}

export const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);
