import { createContext, useContext } from 'react';
import type { Macros } from '../services/foodSearch';
import type { SessionUser, UserSettings } from '../services/healthApi';
import type { MissionTask, NutritionGoals } from '../data/tasks';

export interface MealEntry {
  id: string;
  name: string;
  grams: number;
  macros: Macros;
  loggedAt: number;
}

export interface MissionState {
  user: SessionUser;
  xp: number;
  streak: number;
  tasks: MissionTask[];
  completed: string[];
  waterMl: number;
  meals: MealEntry[];
  watchedTutorials: string[];
  settings: UserSettings | null;
  goals: NutritionGoals;
  waterGoalMl: number;
  waterStepMl: number;
  loading: boolean;
  loadError: boolean;
}

export interface MissionActions {
  toggleTask: (id: string) => Promise<boolean>;
  completeTaskByKey: (key: string) => Promise<number>;
  addWater: (ml: number) => Promise<{ total: number; xp: number }>;
  addMeal: (meal: Omit<MealEntry, 'id' | 'loggedAt'>) => Promise<number>;
  removeMeal: (id: string) => Promise<void>;
  completeTutorial: (id: string) => Promise<number>;
  logMood: (score: number) => Promise<void>;
  /** Re-reads today's tasks, points and streak (after the Worker completed tasks on its own). */
  refreshToday: () => Promise<void>;
  reload: () => void;
}

export type MissionContextValue = MissionState & MissionActions;

export const LEVEL_XP = 400;
export const RANKS = ['Cadet', 'Specialist', 'Flight Engineer', 'Mission Specialist', 'Commander', 'Station Legend'];

export const MissionContext = createContext<MissionContextValue | null>(null);

// Reads mission state; must be used under MissionProvider.
export function useMission() {
  const value = useContext(MissionContext);
  if (!value) throw new Error('useMission must be used inside MissionProvider');
  return value;
}

export function crewGreetingName(user: Pick<SessionUser, 'display_name' | 'full_name'>) {
  return user.display_name?.trim() || user.full_name?.trim().split(/\s+/)[0] || 'crew';
}

// Converts total XP into level, rank and progress.
export function levelInfo(xp: number) {
  const level = Math.floor(xp / LEVEL_XP) + 1;
  return {
    level,
    rank: RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))],
    progress: xp % LEVEL_XP,
    toNext: LEVEL_XP - (xp % LEVEL_XP),
  };
}

// Sums macros across all logged meals.
export function totalMacros(meals: MealEntry[]): Macros {
  return meals.reduce(
    (sum, m) => ({
      kcal: sum.kcal + m.macros.kcal,
      protein: sum.protein + m.macros.protein,
      carbs: sum.carbs + m.macros.carbs,
      fat: sum.fat + m.macros.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}
