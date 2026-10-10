/** Re-export of the shared exercise catalogue (single source for the app and the AI function). */
import { EXERCISE_LIBRARY, type LibraryExercise } from '../../supabase/functions/_shared/exerciseCatalog';

export { EXERCISE_LIBRARY, exerciseId, type LibraryExercise } from '../../supabase/functions/_shared/exerciseCatalog';

export function searchLibrary(query: string, extra: readonly LibraryExercise[] = []): LibraryExercise[] {
  const q = query.trim().toLowerCase();
  const all = [...extra, ...EXERCISE_LIBRARY];
  if (!q) return all;
  return all.filter((x) => `${x.name} ${x.muscle_group} ${x.equipment}`.toLowerCase().includes(q));
}
