import { describe, expect, it } from 'vitest';
import raw from '../data/exercise-library-v1.json';
import { findGuide, matchesMuscle, parseGuide, searchGuide } from './exerciseGuide';
import {
  FORM_PHOTO_COMMIT, isSafePhotoId, libraryPhotoIds, parsePhotoManifest, photoAvailability, photoPaths, sourcePhotoUrl,
} from './exerciseImages';

const all = parseGuide(raw);

describe('form photo ids and paths', () => {
  it('lists every free-exercise-db id the library points at, once', () => {
    const ids = libraryPhotoIds(raw);
    expect(ids.length).toBeGreaterThan(800);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isSafePhotoId)).toBe(true);
    for (const x of all) if (x.source_id) expect(ids).toContain(x.source_id);
  });

  it('TrainLuma-written exercises have no photo id; free-exercise-db ones do', () => {
    const rest = (raw as { exercises: { source_id?: string }[] }).exercises;
    expect(rest.filter((x) => !x.source_id).length).toBe(34);
    expect(all.find((x) => x.key === 'bench_press' && x.equipment === 'barbell')?.source_id).toBe('Barbell_Bench_Press_-_Medium_Grip');
    expect(all.find((x) => x.key === 'burpee')?.source_id).toBeNull();
  });

  it('downloads from the pinned commit; serves same-origin', () => {
    expect(sourcePhotoUrl('Band_Pull_Apart', 1)).toBe(`https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FORM_PHOTO_COMMIT}/exercises/Band_Pull_Apart/1.jpg`);
    expect(photoPaths('Band_Pull_Apart')).toEqual(['/exercise-img/Band_Pull_Apart/0.jpg', '/exercise-img/Band_Pull_Apart/1.jpg']);
  });

  it('rejects ids that could escape the photo folder', () => {
    for (const bad of ['../x', 'a/b', '', 'a b', 'x?.jpg', null, 3]) expect(isSafePhotoId(bad)).toBe(false);
  });
});

describe('photo availability (manifest + fallback)', () => {
  it('parses the manifest and ignores junk', () => {
    expect(parsePhotoManifest({ commit: FORM_PHOTO_COMMIT, ids: ['A_b', '../evil', 4] })).toEqual(new Set(['A_b']));
    expect(parsePhotoManifest(null)).toBeNull();
    expect(parsePhotoManifest({ ids: [] })).toBeNull();
    expect(parsePhotoManifest('nope')).toBeNull();
  });

  it('available only when the build vendored the photos; none for imageless or custom exercises; unknown without a manifest', () => {
    const m = new Set(['Band_Pull_Apart']);
    expect(photoAvailability('Band_Pull_Apart', m)).toBe('available');
    expect(photoAvailability('Kettlebell_Halo', m)).toBe('none');
    expect(photoAvailability(null, m)).toBe('none');
    expect(photoAvailability(undefined, null)).toBe('none');
    expect(photoAvailability('Band_Pull_Apart', new Set())).toBe('none'); // SKIP_EXERCISE_IMAGES build
    expect(photoAvailability('Band_Pull_Apart', null)).toBe('unknown');
  });
});

describe('session exercise → library entry', () => {
  it('finds by exercise key and equipment; custom exercises have none', () => {
    expect(findGuide(all, 'bench_press', 'barbell')?.name).toBe('Bench press');
    expect(findGuide(all, 'bench_press', 'kettlebell')).toBeNull();
    expect(findGuide(all, 'custom:abcd1234', 'cable')).toBeNull();
  });
});

describe('muscle filter (cards and chips)', () => {
  it('glutes matches exercises whose primary muscles include glutes', () => {
    const glutes = searchGuide(all, '', { muscle: 'glutes' });
    expect(glutes.length).toBeGreaterThan(10);
    expect(glutes.every((x) => x.primary_muscles.includes('glutes'))).toBe(true);
    expect(matchesMuscle({ muscle_group: 'legs' }, 'glutes')).toBe(false); // custom exercises have no muscle detail
  });

  it('other areas filter exactly like the chips (by muscle group)', () => {
    const chest = searchGuide(all, '', { muscle: 'chest' });
    expect(chest.length).toBeGreaterThan(20);
    expect(chest.every((x) => x.muscle_group === 'chest')).toBe(true);
    expect(matchesMuscle({ muscle_group: 'core' }, null)).toBe(true);
  });
});
