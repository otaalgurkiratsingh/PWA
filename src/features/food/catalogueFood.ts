/**
 * Turn a catalogue food into the person's own meal (preset + one food version).
 *
 * - The catalogue supplies the name, the usual unit and the picture. Nothing else.
 * - Nutrition per 100 g is all null (unknown) with source "unknown" and a note saying why.
 *   The person adds a label or recipe later; until then logged entries show nutrition as partial.
 * - Grams per unit are null unless the person weighed their usual serving.
 * - Nothing is written into anyone's journal until they pick the food.
 */
import type { FoodIcon, FoodVersion, MealPreset, PreparationState } from '@shared/contracts';
import type { CatalogueFood, CatalogueIndex } from '@shared/catalogue/catalogue';
import { legacyMatch } from '@shared/catalogue/catalogue';

const FAMILY_ICON: Record<CatalogueFood['illustration']['family'], FoodIcon> = {
  flatbread: 'roti', rice_bowl: 'rice', dal_bowl: 'dal', sabzi_bowl: 'sabzi', paneer_bowl: 'paneer', eggs_plate: 'egg',
  protein_plate: 'curry', dairy_bowl: 'dahi', drink_cup: 'chai', breakfast_bowl: 'oats', snack_plate: 'plate',
  sweet_plate: 'plate', fruit: 'fruit', nuts_bowl: 'bowl', side_bowl: 'salad', canadian_plate: 'sandwich',
};

/** Prepared dishes are "cooked"; things eaten as bought or raw are "as sold". Only matters inside recipes. */
function stateFor(f: CatalogueFood): PreparationState {
  return ['fruit', 'nuts_seeds', 'drinks', 'dairy', 'sides_addons'].includes(f.category_id) ? 'as_sold' : 'cooked';
}

/** Steps of ½ for bowls/servings/cups, whole steps for pieces, eggs, scoops and teaspoons. */
function stepFor(unit: CatalogueFood['portion']['display_unit']): number {
  return unit === 'bowl' || unit === 'serving' || unit === 'cup' ? 0.5 : 1;
}

export interface CatalogueChoice {
  /** Grams in ONE unit, if the person weighed it; null = not weighed yet. */
  grams_per_unit: number | null;
  default_quantity: number;
  favorite: boolean;
}

export function presetFromCatalogue(args: {
  food: CatalogueFood;
  seedVersion: string;
  choice: CatalogueChoice;
  ownerId: string;
  now: string;
  newId: () => string;
}): { food: FoodVersion; preset: MealPreset } {
  const { food: c, choice } = args;
  if (choice.grams_per_unit !== null && !(choice.grams_per_unit > 0)) throw new Error('Grams must be more than 0.');
  if (!(choice.default_quantity > 0)) throw new Error('Usual amount must be more than 0.');
  const base = (id: string) => ({ id, owner_id: args.ownerId, local_version: 0, created_at: args.now, updated_at: args.now, deleted_at: null, synthetic: false });
  const food: FoodVersion = {
    ...base(args.newId()),
    food_id: args.newId(),
    revision: 1,
    name: c.name,
    preparation_state: stateFor(c),
    per_100g: { energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
    source: { kind: 'unknown', ref: c.id, version: args.seedVersion, license: null, note: 'Food list identity only; nutrition not verified. Add a label or your recipe.' },
    assumptions: [],
  };
  const preset: MealPreset = {
    ...base(args.newId()),
    name: c.name.slice(0, 60),
    icon: FAMILY_ICON[c.illustration.family],
    items: [{ kind: 'food', food_version_id: food.id, unit_label: c.portion.display_unit, grams_per_unit: choice.grams_per_unit, default_quantity: choice.default_quantity }],
    quantity_step: stepFor(c.portion.display_unit),
    favorite: choice.favorite,
    photo: null,
    catalogue_id: c.id,
    catalogue_version: args.seedVersion,
  };
  return { food, preset };
}

/**
 * The person's existing meal for a catalogue food: one created from it, or (for meals saved before
 * the catalogue existed) an exact, unique name match such as "Roti" → whole-wheat-roti.
 */
export function existingPresetFor(index: CatalogueIndex, presets: readonly MealPreset[], foodId: string): MealPreset | null {
  const live = presets.filter((p) => p.deleted_at === null);
  return live.find((p) => p.catalogue_id === foodId)
    ?? live.find((p) => !p.catalogue_id && legacyMatch(index, p.name)?.id === foodId)
    ?? null;
}

/** Catalogue id to use for a meal's picture/identity (explicit link, else exact legacy name match). */
export function catalogueIdOf(index: CatalogueIndex | null, preset: Pick<MealPreset, 'catalogue_id' | 'name'>): string | null {
  if (preset.catalogue_id) return preset.catalogue_id;
  return index ? legacyMatch(index, preset.name)?.id ?? null : null;
}

/** Hide meat/fish/egg suggestions according to the person's own stated choices (browse only). */
export function visibleFor(food: CatalogueFood, prefs: { pattern: string; meatless_weekdays: number[] }, weekday: number): boolean {
  const meatless = prefs.meatless_weekdays.includes(weekday);
  const hint = food.dietary_hint;
  if (prefs.pattern === 'vegetarian' || meatless) return hint !== 'meat' && hint !== 'fish' && hint !== 'egg';
  if (prefs.pattern === 'eggetarian') return hint !== 'meat' && hint !== 'fish';
  if (prefs.pattern === 'pescatarian') return hint !== 'meat';
  return true;
}
