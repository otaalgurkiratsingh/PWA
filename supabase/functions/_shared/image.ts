/**
 * Bounded JPEG validation without native image libraries (Edge-runtime friendly).
 * The app crops, downsizes and re-encodes photos on the device, which drops metadata.
 * The server checks magic bytes, size, dimensions, structure, and rejects EXIF/GPS blocks.
 */
export const MAX_JPEG_BYTES = 1_500_000;
export const MAX_DIMENSION = 1600;

export type ImageCheck = { ok: true; width: number; height: number; bytes: number } | { ok: false; reason: string };

export function decodeBase64(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function checkJpeg(bytes: Uint8Array): ImageCheck {
  if (bytes.length < 128) return { ok: false, reason: 'too small' };
  if (bytes.length > MAX_JPEG_BYTES) return { ok: false, reason: 'too large' };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { ok: false, reason: 'not a JPEG' };
  let i = 2;
  let width = 0;
  let height = 0;
  let segments = 0;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return { ok: false, reason: 'malformed JPEG' };
    const marker = bytes[i + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // end / start of scan
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2 || i + 2 + len > bytes.length) return { ok: false, reason: 'malformed JPEG' };
    if (++segments > 64) return { ok: false, reason: 'too many segments' };
    if (marker === 0xe1) {
      // APP1 = EXIF/XMP: may contain GPS/camera data. The app strips it; reject anything that kept it.
      return { ok: false, reason: 'photo metadata must be removed' };
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 7) return { ok: false, reason: 'malformed JPEG' };
      height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
    }
    i += 2 + len;
  }
  if (!width || !height) return { ok: false, reason: 'missing dimensions' };
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return { ok: false, reason: 'image too large in pixels' };
  return { ok: true, width, height, bytes: bytes.length };
}
