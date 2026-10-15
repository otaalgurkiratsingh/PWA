import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import raw from '@shared/data/exercise-library-v1.json';
import { findGuide, parseGuide } from '@shared/catalogue/exerciseGuide';

const all = parseGuide(raw);
const bench = findGuide(all, 'bench_press', 'barbell')!;
const burpee = all.find((x) => x.key === 'burpee')!;

/** Fresh module per test so the memoised manifest starts empty. */
async function load(manifest: unknown) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => (manifest === 'offline' ? Promise.reject(new TypeError('offline')) : { ok: true, json: async () => manifest })));
  return import('./FormDemo');
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('How-to sheet form demo', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the start and end photos with alt text and credit when the build has them', async () => {
    const { HowToSheet } = await load({ commit: 'x', ids: [bench.source_id] });
    render(<HowToSheet name={bench.name} exercise={bench} onClose={() => undefined} />);
    await settle();
    expect(screen.getByAltText('Bench press — start position').getAttribute('src')).toBe(`/exercise-img/${bench.source_id}/0.jpg`);
    expect(screen.getByAltText('Bench press — end position').getAttribute('src')).toBe(`/exercise-img/${bench.source_id}/1.jpg`);
    expect(screen.getByText('Photos: free-exercise-db (public domain)')).toBeTruthy();
    expect(document.querySelectorAll('ol.how-to li').length).toBe(bench.instructions.length);
  });

  it('marks the demo ready (animation on) only after both photos load', async () => {
    const { HowToSheet } = await load({ commit: 'x', ids: [bench.source_id] });
    render(<HowToSheet name={bench.name} exercise={bench} onClose={() => undefined} />);
    await settle();
    const demo = screen.getByTestId('form-demo');
    fireEvent.load(screen.getByAltText(/start position/));
    expect(demo.className).not.toContain('ready');
    fireEvent.load(screen.getByAltText(/end position/));
    expect(demo.className).toContain('ready');
  });

  it('a photo that fails to load hides the whole demo and keeps the steps', async () => {
    const { HowToSheet, NO_PHOTO_LINE } = await load({ commit: 'x', ids: [bench.source_id] });
    render(<HowToSheet name={bench.name} exercise={bench} onClose={() => undefined} />);
    await settle();
    fireEvent.error(screen.getByAltText(/end position/));
    expect(screen.queryByTestId('form-demo')).toBeNull();
    expect(document.querySelectorAll('img').length).toBe(0);
    expect(screen.getByText(NO_PHOTO_LINE)).toBeTruthy();
    expect(document.querySelectorAll('ol.how-to li').length).toBeGreaterThan(0);
  });

  it('TrainLuma-written exercise: neutral line and steps, no image', async () => {
    const { HowToSheet, NO_PHOTO_LINE } = await load({ commit: 'x', ids: [bench.source_id] });
    render(<HowToSheet name={burpee.name} exercise={burpee} onClose={() => undefined} />);
    await settle();
    expect(screen.getByText(NO_PHOTO_LINE)).toBeTruthy();
    expect(document.querySelectorAll('img').length).toBe(0);
  });

  it('custom exercise: neutral line and a kind note instead of steps', async () => {
    const { HowToSheet, NO_PHOTO_LINE } = await load({ commit: 'x', ids: [] });
    render(<HowToSheet name="Landmine press" exercise={null} custom onClose={() => undefined} />);
    await settle();
    expect(screen.getByText(NO_PHOTO_LINE)).toBeTruthy();
    expect(screen.getByText(/your own exercise/)).toBeTruthy();
    expect(document.querySelectorAll('img').length).toBe(0);
  });

  it('build without photos (empty manifest): neutral line', async () => {
    const { FormPreview, NO_PHOTO_LINE } = await load({ commit: 'x', ids: [] });
    render(<FormPreview sourceId={bench.source_id} name={bench.name} />);
    await settle();
    expect(screen.getByText(NO_PHOTO_LINE)).toBeTruthy();
  });

  it('manifest unreachable: still tries the photos (a failure falls back)', async () => {
    const { FormPreview } = await load('offline');
    render(<FormPreview sourceId={bench.source_id} name={bench.name} />);
    await settle();
    expect(document.querySelectorAll('img').length).toBe(2);
  });
});
