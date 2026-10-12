/**
 * Where nutrition numbers may come from (owner decision, 2026-10-12 build brief, hard rule 1):
 * the TrainLuma food database (indian_dishes.json) is the ONLY source of app-supplied dish numbers.
 * Exceptions the brief itself asks for: packaged products by barcode (Open Food Facts label values,
 * T16) and numbers the person types (labels, quick-add, their own recipe ingredients).
 *
 * The earlier reference values (Canadian Nutrient File / USDA on the 293-item food list, and the
 * CNF ingredient list for recipes) are therefore OFF. They stay in the repo, unused, so the owner
 * can switch them back on with this one flag if the rule changes. Foods people already saved keep
 * their values (the journal is never rewritten).
 */
export const LEGACY_REFERENCE_VALUES = false;
