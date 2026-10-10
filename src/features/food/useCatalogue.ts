import { useEffect, useState } from 'react';
import { loadCatalogue, type CatalogueIndex } from '@shared/catalogue/catalogue';

/** The shared food list, loaded on first use (a separate cached file, works offline after first load). */
export function useCatalogue(): { index: CatalogueIndex | null; failed: boolean } {
  const [state, setState] = useState<{ index: CatalogueIndex | null; failed: boolean }>({ index: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadCatalogue().then(
      (index) => alive && setState({ index, failed: false }),
      () => alive && setState({ index: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export const CATEGORY_SHORT: Record<string, string> = {
  breads: 'Roti & breads', rice_grains: 'Rice', dals_beans: 'Dal & beans', vegetables: 'Sabzi', paneer: 'Paneer & tofu',
  eggs: 'Eggs', meat_fish: 'Meat & fish', dairy: 'Dahi & milk', drinks: 'Chai & drinks', breakfast: 'Breakfast',
  snacks: 'Snacks & chaat', sweets: 'Sweets', fruit: 'Fruit', nuts_seeds: 'Nuts & seeds', sides_addons: 'Sides & extras',
  canadian_meals: 'Canadian & takeout',
};
