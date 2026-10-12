import { useMemo } from 'react';
import { useJournal, useQuery } from '@/app/JournalContext';
import {
  loggingStreak, milestoneToday, shiftDate, workoutWeekStreak, type Milestone, type Streak,
} from '../../../supabase/functions/_shared/retention';
import { loggedDates } from './recap';

export interface StreakState {
  /** False until the journal has been read (values are then empty). */
  ready: boolean;
  logging: Streak;
  /** Consecutive weeks with at least one finished workout. */
  workoutWeeks: number;
  /** 7, 30 or 100 when that milestone was reached exactly today. */
  milestone: Milestone | null;
}

const EMPTY: Streak = { current: 0, best: 0, frozen: [], broken: false, loggedToday: false };

/** Logging streak (meals or finished workouts) and workout-week streak over the last 400 days. */
export function useStreak(): StreakState {
  const { today } = useJournal();
  const meals = useQuery((j) => j.mealsBetween(shiftDate(today, -400), today), [today]);
  const sessions = useQuery((j) => j.sessions(), []);
  return useMemo(() => {
    if (!meals || !sessions) return { ready: false, logging: EMPTY, workoutWeeks: 0, milestone: null };
    const floor = shiftDate(today, -400);
    const finished = sessions.filter((s) => s.status === 'finished' && s.local_date >= floor);
    const logging = loggingStreak(loggedDates(meals, finished), today);
    return {
      ready: true,
      logging,
      workoutWeeks: workoutWeekStreak(finished.map((s) => s.local_date), today),
      milestone: milestoneToday(logging),
    };
  }, [meals, sessions, today]);
}
