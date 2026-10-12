/**
 * Camera barcode scanning. Uses the browser's built-in BarcodeDetector where available (Chrome on
 * Android) and the ZXing library otherwise (Safari on iPhone), loaded only when someone scans.
 * Frames never leave the phone; only a decoded, check-digit-valid number is returned.
 */
import { normalizeBarcode } from './openFoodFacts';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  if (!cameraAvailable()) throw new Error('This browser can’t open the camera. Type the numbers under the barcode instead.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    const name = (e as DOMException).name;
    throw new Error(name === 'NotAllowedError'
      ? 'Camera access is off for TrainLuma. Allow it in your browser settings, or type the barcode numbers.'
      : 'Couldn’t open the camera. Type the numbers under the barcode instead.', { cause: e });
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play().catch(() => undefined);

  let stopped = false;
  let done = false;
  const found = (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code || done) return;
    done = true;
    onCode(code);
  };
  let stopZxing: (() => void) | null = null;
  const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  const nativeOk = Native ? await (Native.getSupportedFormats?.() ?? Promise.resolve(FORMATS)).then((f) => FORMATS.some((x) => f.includes(x)), () => false) : false;

  if (Native && nativeOk) {
    const detector = new Native({ formats: FORMATS });
    const tick = async () => {
      if (stopped || done) return;
      if (video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          for (const c of codes) found(c.rawValue);
        } catch {
          // a bad frame; keep trying
        }
      }
      window.setTimeout(() => void tick(), 180);
    };
    void tick();
  } else {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
    const controls = await reader.decodeFromVideoElement(video, (result) => { if (result) found(result.getText()); });
    stopZxing = () => controls.stop();
  }

  return () => {
    stopped = true;
    stopZxing?.();
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}
