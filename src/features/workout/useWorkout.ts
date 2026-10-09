import { useCallback } from 'react';
import type { ProgramDay, ProgramVersion, WorkoutSession } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { startSession } from '@/domain/training/session';
import { startTimer } from '@/domain/training/timer';
import { saveErrorMessage } from '@/features/food/useFood';
import { newId } from '@/core/ids';

export function useWorkout() {
  const { journal, profile, today, refresh, notify, setTimer } = useJournal();

  /** Apply a pure change to the LATEST stored copy, then save atomically. */
  const mutate = useCallback(
    async (sessionId: string, fn: (s: WorkoutSession) => WorkoutSession): Promise<WorkoutSession | null> => {
      try {
        const current = await journal.db.get('workout_sessions', sessionId);
        if (!current) throw new Error('Session not found');
        const next = { ...fn(current), updated_at: new Date().toISOString() };
        await journal.commit('workout_sessions', next);
        refresh();
        return next;
      } catch (e) {
        notify({ kind: 'error', message: e instanceof Error && e.message.startsWith('Session') ? e.message : saveErrorMessage(e) });
        return null;
      }
    },
    [journal, refresh, notify],
  );

  const start = useCallback(
    async (program: ProgramVersion, day: ProgramDay) => {
      const active = await journal.activeSession();
      if (active) {
        notify({ kind: 'error', message: `Finish “${active.day_name}” first.` });
        return null;
      }
      const history = await journal.sessions();
      const s = startSession({
        id: newId(),
        ownerId: journal.ownerId,
        program,
        day,
        localDate: today,
        timezone: profile.timezone,
        now: new Date().toISOString(),
        newId: () => newId(),
        history,
        unit: profile.units,
        synthetic: profile.synthetic,
      });
      try {
        await journal.commit('workout_sessions', s);
        refresh();
        return s;
      } catch (e) {
        notify({ kind: 'error', message: saveErrorMessage(e) });
        return null;
      }
    },
    [journal, today, profile, refresh, notify],
  );

  const startRest = useCallback(
    async (sessionId: string, setId: string, seconds: number) => {
      if (seconds > 0) await setTimer(startTimer(sessionId, setId, seconds, Date.now()));
    },
    [setTimer],
  );

  return { mutate, start, startRest, setTimer };
}
