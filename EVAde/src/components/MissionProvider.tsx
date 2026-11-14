import { useMemo, type ReactNode } from 'react';
import { MissionContext, type MissionContextValue, type MissionState } from '../context/MissionContext';
import { usePersistentState } from '../hooks/usePersistentState';

// Local calendar date key, e.g. 2026-11-14.
function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

// Seed state so the demo shows progress on first launch.
function initialState(): MissionState {
  return { day: todayKey(), xp: 1240, streak: 12, completed: [], waterMl: 750, meals: [], watchedTutorials: ['bp-cuff'] };
}

// Starts a fresh day while keeping XP, streak and tutorials.
function rollOver(state: MissionState): MissionState {
  if (state.day === todayKey()) return state;
  const keptStreak = state.completed.length > 0 ? state.streak + 1 : 0;
  return { ...state, day: todayKey(), streak: keptStreak, completed: [], waterMl: 0, meals: [] };
}

// Provides persisted gamification state to every page.
export default function MissionProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = usePersistentState<MissionState>('evade:mission', initialState);
  const state = rollOver(stored);

  const value = useMemo<MissionContextValue>(() => {
    // Completes or reopens a task, adjusting XP; returns new completion.
    function toggleTask(id: string, xp: number) {
      const isDone = state.completed.includes(id);
      setStored({
        ...state,
        xp: Math.max(0, state.xp + (isDone ? -xp : xp)),
        completed: isDone ? state.completed.filter(c => c !== id) : [...state.completed, id],
      });
      return !isDone;
    }

    // Logs water intake and awards XP per glass.
    function addWater(ml: number, xp: number) {
      const waterMl = Math.max(0, state.waterMl + ml);
      if (waterMl === state.waterMl) return;
      setStored({ ...state, waterMl, xp: Math.max(0, state.xp + (ml > 0 ? xp : -xp)) });
    }

    // Adds a meal entry and its XP.
    function addMeal(meal: Parameters<MissionContextValue['addMeal']>[0], xp: number) {
      const entry = { ...meal, id: crypto.randomUUID(), loggedAt: Date.now() };
      setStored({ ...state, meals: [entry, ...state.meals], xp: state.xp + xp });
    }

    // Deletes a logged meal.
    function removeMeal(id: string) {
      setStored({ ...state, meals: state.meals.filter(m => m.id !== id) });
    }

    // Marks a tutorial watched once; returns true on first completion.
    function completeTutorial(id: string, xp: number) {
      if (state.watchedTutorials.includes(id)) return false;
      setStored({ ...state, watchedTutorials: [...state.watchedTutorials, id], xp: state.xp + xp });
      return true;
    }

    return { ...state, toggleTask, addWater, addMeal, removeMeal, completeTutorial };
  }, [state, setStored]);

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}
