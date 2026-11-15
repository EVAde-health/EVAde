import { useEffect, useState, type ReactNode } from 'react';
import { MissionContext, type DailyGoals, type MealEntry, type MissionContextValue, type MissionState } from '../context/MissionContext';
import { NUTRITION_GOALS, WATER_GOAL_ML } from '../data/tasks';
import { usePersistentState } from '../hooks/usePersistentState';
import { api, userPath, type SessionUser } from '../services/api';

type ApiMeal = Omit<MealEntry, 'loggedAt'> & { ts: string };
type LocalProgress = Omit<MissionState, 'meals' | 'waterMl'>;

const FALLBACK_GOALS: DailyGoals = { ...NUTRITION_GOALS, waterMl: WATER_GOAL_ML };
const toMeal = ({ ts, ...entry }: ApiMeal): MealEntry => ({ ...entry, loggedAt: Date.parse(ts) });

function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

function today(now = new Date()) {
  return {
    since: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    until: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
  };
}

function initialState(user: SessionUser): LocalProgress {
  return { day: todayKey(), xp: user.points, streak: user.streak_days, completed: [], watchedTutorials: [] };
}

function rollOver(state: LocalProgress): LocalProgress {
  if (state.day === todayKey()) return state;
  return { ...state, day: todayKey(), streak: state.completed.length ? state.streak + 1 : 0, completed: [] };
}

export default function MissionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [stored, setStored] = usePersistentState<LocalProgress>('evade:mission', () => initialState(user));
  const state = rollOver(stored);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const demo = user.demo;
  const [waterMl, setWaterMl] = useState(demo ? 750 : 0);
  const [goals, setGoals] = useState<DailyGoals>(FALLBACK_GOALS);
  const [loading, setLoading] = useState(!demo);
  const [nutritionUnavailable, setNutritionUnavailable] = useState(false);
  const { since, until } = today();
  const id = user.user_id;

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ since, until });
    const options = { signal: controller.signal };
    void Promise.allSettled([
      api<ApiMeal[]>(userPath(id, `meals?${query}`), options),
      api<{ total_ml: number }>(userPath(id, `hydration?${query}`), options),
      api<{ goals: { metric: string; target: number }[] }>(userPath(id, 'goals'), options),
    ]).then(([mealResult, waterResult, goalResult]) => {
      if (controller.signal.aborted) return;
      if (mealResult.status === 'fulfilled') setMeals(mealResult.value.map(toMeal));
      if (waterResult.status === 'fulfilled') setWaterMl(Math.max(0, waterResult.value.total_ml));
      if (goalResult.status === 'fulfilled') {
        const target = (metric: string, fallback: number) => goalResult.value.goals.find(goal => goal.metric === metric)?.target ?? fallback;
        setGoals({
          kcal: target('kcal_intake', FALLBACK_GOALS.kcal),
          protein: target('protein_intake_g', FALLBACK_GOALS.protein),
          carbs: target('carbs_intake_g', FALLBACK_GOALS.carbs),
          fat: target('fat_intake_g', FALLBACK_GOALS.fat),
          waterMl: target('water_intake_ml', FALLBACK_GOALS.waterMl),
        });
      }
      setNutritionUnavailable(mealResult.status === 'rejected' || waterResult.status === 'rejected');
      setLoading(false);
    });
    return () => controller.abort();
  }, [demo, id, since, until]);

  // The Journal and Missions share the existing synchronous completion contract.
  function toggleTask(taskId: string, xp: number) {
    const isDone = state.completed.includes(taskId);
    setStored(previous => {
      const progress = rollOver(previous);
      return {
        ...progress,
        xp: Math.max(0, progress.xp + (isDone ? -xp : xp)),
        completed: isDone ? progress.completed.filter(item => item !== taskId) : [...progress.completed, taskId],
      };
    });
    return !isDone;
  }

  async function addWater(ml: number, xp: number) {
    const timestamp = new Date();
    const amount = demo ? ml : (await api<{ amount_ml: number }>('/hydration', {
      method: 'POST', body: { id: crypto.randomUUID(), user_id: id, amount_ml: ml, ts: timestamp.toISOString(), ...today(timestamp) },
    })).amount_ml;
    setWaterMl(previous => Math.max(0, previous + amount));
    setStored(previous => ({ ...rollOver(previous), xp: Math.max(0, previous.xp + (ml > 0 ? xp : -xp)) }));
    return Math.max(0, waterMl + amount);
  }

  async function addMeal(meal: Parameters<MissionContextValue['addMeal']>[0], xp: number) {
    const mealId = crypto.randomUUID();
    const saved = demo
      ? { ...meal, id: mealId, loggedAt: Date.now() }
      : toMeal(await api<ApiMeal>('/meals', { method: 'POST', body: { id: mealId, user_id: id, ...meal } }));
    setMeals(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
    setStored(previous => ({ ...rollOver(previous), xp: previous.xp + xp }));
  }

  async function removeMeal(mealId: string) {
    if (!demo) await api(`/meals/${encodeURIComponent(mealId)}`, { method: 'DELETE' });
    setMeals(previous => previous.filter(meal => meal.id !== mealId));
  }

  function completeTutorial(tutorialId: string, xp: number) {
    if (state.watchedTutorials.includes(tutorialId)) return false;
    setStored(previous => ({
      ...rollOver(previous), watchedTutorials: [...previous.watchedTutorials, tutorialId], xp: previous.xp + xp,
    }));
    return true;
  }

  const value: MissionContextValue = {
    ...state, user, meals, waterMl, goals, loading, nutritionUnavailable,
    toggleTask, addWater, addMeal, removeMeal, completeTutorial,
  };
  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}
