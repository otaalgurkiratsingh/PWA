import { describe, expect, it } from 'vitest';
import { blendCuisines, cuisineOf, parseFoodDb, searchDishes, type Dish } from './foodDb';
import raw from '../../supabase/functions/_shared/data/indian-dishes-v1.json';


const db = parseFoodDb(raw);
const dish = (id: string, over: Partial<Dish> = {}): Dish => ({
  id, name: id, name_local: '', category: 'dals', aliases: [], serving_label: '1 bowl', serving_g: 100, per_100g: null, per_serving: null, source: 'x', tier: 1, needs_review: false, ...over,
});

describe('cuisine tags', () => {
  it('chains are Western, dal is Indian, milk/eggs/fruit are neutral, a file can say so itself', () => {
    expect(cuisineOf(dish('th', { brand: 'Tim Hortons', category: 'chain restaurants' }))).toBe('western');
    expect(cuisineOf(dish('dal'))).toBe('indian');
    expect(cuisineOf(dish('Boiled egg', { category: 'breakfast' }))).toBe('neutral');
    expect(cuisineOf(dish('Paneer', { category: 'dairy' }))).toBe('indian');
    expect(cuisineOf(dish('Oatmeal', { category: 'breakfast' }))).toBe('western');
    expect(cuisineOf(dish('x', { cuisine: 'Canadian' }))).toBe('western');
  });
});

describe('bicultural blend', () => {
  const hits = (list: Dish[]) => list.map((d, i) => ({ dish: d, score: 100 - i }));
  it('brings the best Western dishes into the top window without moving #1', () => {
    const indian = Array.from({ length: 10 }, (_, i) => dish(`i${i}`));
    const western = [dish('w0', { brand: 'X' }), dish('w1', { brand: 'X' })];
    const out = blendCuisines(hits([...indian, ...western]), () => true, { window: 6, minEach: 2 });
    expect(out[0]!.dish.id).toBe('i0');
    expect(out.slice(0, 6).filter((h) => cuisineOf(h.dish) === 'western')).toHaveLength(2);
    expect(out).toHaveLength(12); // nothing lost
  });
  it('never promotes an irrelevant dish', () => {
    const list = hits([dish('i0'), dish('i1'), dish('i2'), dish('w0', { brand: 'X' })]);
    expect(blendCuisines(list, (h) => h.dish.id !== 'w0', { window: 2 }).map((h) => h.dish.id)).toEqual(['i0', 'i1', 'i2', 'w0']);
  });
  it('real data: suggestions mix both sides at meal times; QA searches keep their #1', () => {
    for (const hour of [8, 13, 20]) {
      const top = searchDishes(db, '', { hour }).slice(0, 8).map((h) => cuisineOf(h.dish));
      expect(top).toContain('indian');
      expect(top).toContain('western');
    }
    expect(searchDishes(db, 'rajma')[0]!.dish.id).toBe('asc165');
    expect(searchDishes(db, 'double double')[0]!.dish.id).toBe('th-double-double-m');
    expect(searchDishes(db, 'roti', { blend: false }).map((h) => h.dish.id)).toEqual(searchDishes(db, 'roti').map((h) => h.dish.id));
  });
});
