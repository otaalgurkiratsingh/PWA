/**
 * Where nutrition numbers come from (owner decisions: 2026-10-12 build brief, updated 2026-10-13).
 *
 * 1. The TrainLuma food database (indian_dishes.json) comes first for every dish it covers. A list
 *    food that matches a database dish (by name or alias) is hidden, so one dish never shows two
 *    sets of numbers.
 * 2. Reference values (Canadian Nutrient File 2026 / USDA FNDDS) fill in list foods the database
 *    doesn't cover, and the CNF ingredient list stays available for recipes. Each value names its
 *    source and record. The owner asked to keep them (2026-10-13).
 * 3. Packaged products by barcode use Open Food Facts label values; numbers the person types are theirs.
 *
 * Nothing is ever guessed: a food with no sourced value stays "not set". Set this to false to make
 * the database the only app-supplied source again. Saved foods keep their values either way.
 */
export const LEGACY_REFERENCE_VALUES = true;
