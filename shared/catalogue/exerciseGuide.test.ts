import { describe, expect, it } from 'vitest';
import raw from '../data/exercise-library-v1.json';
import { EXERCISE_LIBRARY, exerciseId } from '@shared/fixtures/exerciseLibrary';
import { ExerciseDefinition } from '@shared/contracts';
import { parseGuide, searchGuide } from './exerciseGuide';

const all = parseGuide(raw);

describe('exercise library', () => {
  it('has hundreds of exercises with unique ids; built-in ids are untouched and first', () => {
    expect(all.length).toBeGreaterThan(800);
    const ids = all.map(exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, EXERCISE_LIBRARY.length)).toEqual(EXERCISE_LIBRARY.map(exerciseId));
  });

  it('every entry fits the app’s exercise definition rules', () => {
    for (const x of all) {
      const def = { id: '00000000-0000-4000-8000-000000000001', owner_id: 'o', local_version: 0, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', deleted_at: null, synthetic: false,
        key: x.key, name: x.name, equipment: x.equipment, muscle_group: x.muscle_group, load_convention: x.load_convention, unilateral: x.unilateral, measurement: x.measurement };
      expect(ExerciseDefinition.safeParse(def).success, x.name).toBe(true);
    }
  });

  it('built-ins carry how-to steps; most entries have instructions', () => {
    expect(all.filter((x) => x.builtin).every((x) => x.instructions.length > 0)).toBe(true);
    expect(all.filter((x) => x.instructions.length > 0).length / all.length).toBeGreaterThan(0.9);
  });

  it('search by name, alias and filters', () => {
    expect(searchGuide(all, 'RDL').map((x) => x.name)).toContain('Romanian deadlift');
    expect(searchGuide(all, 'bulgarian').length).toBeGreaterThan(0);
    const chest = searchGuide(all, '', { muscle: 'chest', equipment: 'dumbbell' });
    expect(chest.length).toBeGreaterThan(5);
    expect(chest.every((x) => x.muscle_group === 'chest' && x.equipment === 'dumbbell')).toBe(true);
    expect(searchGuide(all, 'treadmill')[0]?.measurement).toBe('duration');
  });
});
