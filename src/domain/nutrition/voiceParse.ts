/**
 * T15 voice logging: "I had rajma chawal and two rotis" → items to confirm.
 * Matches the person's own meals first, then the TrainLuma food database (aliases, Punjabi/Hindi
 * spellings). Never invents a dish: unmatched phrases stay unmatched for the person to fix.
 */
import type { MealPreset } from '@shared/contracts';
import { searchDishes, tokens, type Dish, type FoodDb } from '@shared/fooddb/foodDb';

export interface VoiceItem {
  phrase: string;
  /** Servings of the matched meal or dish. */
  quantity: number;
  match: { kind: 'preset'; preset: MealPreset; multiplier: number } | { kind: 'dish'; dish: Dish; multiplier: number } | null;
}

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, ek: 1, single: 1, two: 2, do: 2, couple: 2, three: 3, teen: 3, four: 4, char: 4, chaar: 4, five: 5, panj: 5, paanch: 5,
  six: 6, half: 0.5, aadha: 0.5, adha: 0.5,
};
const FILLER = new Set(['i', 'had', 'have', 'ate', 'eaten', 'drank', 'just', 'some', 'my', 'for', 'breakfast', 'lunch', 'dinner', 'snack', 'today', 'of', 'the', 'with', 'log', 'add', 'please', 'mein', 'maine', 'khaya', 'khadi', 'khade', 'piya']);
const UNITS = new Set(['bowl', 'bowls', 'katori', 'katoris', 'plate', 'plates', 'cup', 'cups', 'glass', 'glasses', 'piece', 'pieces', 'pc', 'slice', 'slices', 'serving', 'servings', 'scoop', 'scoops']);

/** Split a sentence into food phrases on "and", commas, "with", "plus", "aur", "te", "then". */
export function splitPhrases(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.!?]/g, ',')
    .split(/,|\band\b|\bplus\b|\bwith\b|\baur\b|\bte\b|\bthen\b|&|\+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function quantityOf(words: string[]): { qty: number; rest: string[] } {
  let qty = 1;
  let set = false;
  const rest: string[] = [];
  for (const w of words) {
    if (/^\d+(\.\d+)?$/.test(w)) { qty = Number(w); set = true; }
    else if (w in NUMBERS && rest.length === 0) { if (!set) qty = NUMBERS[w]!; set = true; } // "half a katori" stays ½
    else if (!FILLER.has(w) && !UNITS.has(w)) rest.push(w);
  }
  return { qty: Math.min(Math.max(qty, 0.25), 20), rest };
}

const COUNT_UNITS = /^(roti|rotis|chapati|egg|eggs|piece|paratha|parathas|slice|naan|idli|dosa)$/;

export function parseVoice(text: string, db: FoodDb, presets: readonly MealPreset[]): VoiceItem[] {
  const out: VoiceItem[] = [];
  for (const phrase of splitPhrases(text)) {
    const { qty, rest } = quantityOf(phrase.split(/\s+/));
    const q = rest.join(' ');
    if (!q) continue;
    const qt = tokens(q);
    // 1) The person's own meals ("my usual chai").
    // Closest name wins: "rotis" → "Roti" rather than "Ghee on roti".
    const mine = presets
      .filter((p) => !p.deleted_at && p.kind !== 'quick')
      .map((p) => ({ p, w: tokens(p.name) }))
      .filter(({ w }) => qt.length > 0 && qt.every((t) => w.some((x) => x.startsWith(t))))
      .sort((a, b) => (a.w.length - qt.length) - (b.w.length - qt.length))[0]?.p;
    if (mine) {
      const it = mine.items[0]!;
      // "two rotis" with a usual of "2 rotis" is one usual serving; otherwise it's servings.
      const counted = mine.items.length === 1 && COUNT_UNITS.test(it.unit_label) && it.default_quantity > 0;
      out.push({ phrase, quantity: qty, match: { kind: 'preset', preset: mine, multiplier: counted ? qty / it.default_quantity : qty } });
      continue;
    }
    // 2) The food database (exact alias / name / prefix only — a vague guess is left unmatched).
    const hit = searchDishes(db, q, { limit: 1 })[0];
    out.push({ phrase, quantity: qty, match: hit && hit.score >= 60 ? { kind: 'dish', dish: hit.dish, multiplier: qty } : null });
  }
  return out;
}
