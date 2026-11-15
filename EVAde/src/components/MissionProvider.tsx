import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MissionContext, type MealEntry, type MissionContextValue } from '../context/MissionContext';
import { nutritionGoals, toMissionTask } from '../data/tasks';
import {
  completeTutorialRequest,
  deleteMeal,
  fetchHydration,
  fetchMeals,
  fetchSettings,
  fetchToday,
  fetchTutorialProgress,
  postHydration,
  postMeal,
  postSelfReport,
  setTaskDone,
  type ApiMeal,
  type ApiTask,
  type SessionUser,
  type UserSettings,
} from '../services/healthApi';

const DEFAULT_SETTINGS: UserSettings = {
  kcal_goal: 2800, protein_goal_g: 110, carbs_goal_g: 360, fat_goal_g: 95, water_goal_ml: 2500, water_step_ml: 250,
  sleep_target_h: 8, timezone: 'UTC', color_mode: null, reduced_motion: false,
};

// Converts a Worker meal row into a meal entry.
function toMeal({ ts, ...meal }: ApiMeal): MealEntry {
  return { id: meal.id, name: meal.name, grams: meal.grams, macros: meal.macros, loggedAt: Date.parse(ts) };
}

// Loads today's missions, logs and progress from D1 and exposes the actions that write them.
export default function MissionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [points, setPoints] = useState(user.points);
  const [streak, setStreak] = useState(user.streak_days);
  const [watchedTutorials, setWatchedTutorials] = useState<string[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const taskWrites = useRef(new Map<string, Promise<boolean>>());

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    Promise.allSettled([
      fetchToday(user.user_id, options),
      fetchMeals(user.user_id, options),
      fetchHydration(user.user_id, options),
      fetchTutorialProgress(user.user_id, options),
      fetchSettings(user.user_id, options),
    ]).then(([today, mealRows, water, progress, prefs]) => {
      if (controller.signal.aborted) return;
      if (today.status === 'fulfilled') {
        setTasks(today.value.tasks);
        setPoints(today.value.points);
        setStreak(today.value.streak_days);
      }
      if (mealRows.status === 'fulfilled') setMeals(mealRows.value.map(toMeal));
      if (water.status === 'fulfilled') setWaterMl(Math.max(0, water.value.total_ml));
      if (progress.status === 'fulfilled') setWatchedTutorials(progress.value.map(p => p.tutorial_id));
      if (prefs.status === 'fulfilled') setSettings(prefs.value);
      setLoadError([today, mealRows, water, progress, prefs].some(result => result.status === 'rejected'));
      setLoading(false);
    });
    return () => controller.abort();
  }, [user.user_id, user.demo, revision]);

  // Re-fetches everything from the Worker.
  const reload = useCallback(() => {
    setLoading(true);
    setRevision(previous => previous + 1);
  }, []);

  // Completes or reopens a task once at a time; resolves true when now complete.
  const toggleTask = useCallback((id: string) => {
    const pending = taskWrites.current.get(id);
    if (pending) return pending;
    const row = tasks.find(task => String(task.id) === id);
    if (!row) return Promise.resolve(false);
    const complete = !row.completed_at;
    const write = setTaskDone(id, complete)
      .then(result => {
        setTasks(previous => previous.map(task => (String(task.id) === id ? { ...task, completed_at: complete ? new Date().toISOString() : null } : task)));
        setPoints(previous => Math.max(0, previous + (result.points_awarded ?? 0)));
        return complete;
      })
      .finally(() => taskWrites.current.delete(id));
    taskWrites.current.set(id, write);
    return write;
  }, [tasks]);

  // Completes today's task with a template key (e.g. the selfie); returns XP earned.
  const completeTaskByKey = useCallback(async (key: string) => {
    const row = tasks.find(task => task.task_key === key);
    if (!row || row.completed_at) return 0;
    const result = await setTaskDone(String(row.id), true);
    setTasks(previous => previous.map(task => (task.id === row.id ? { ...task, completed_at: new Date().toISOString() } : task)));
    setPoints(previous => previous + (result.points_awarded ?? 0));
    return result.points_awarded ?? 0;
  }, [tasks]);

  // Logs water for today; returns the new total and XP earned.
  const addWater = useCallback(async (amount: number) => {
    if (user.demo) {
      const total = Math.max(0, waterMl + amount);
      setWaterMl(total);
      return { total, xp: 0 };
    }
    const saved = await postHydration(amount);
    const total = Math.max(0, waterMl + saved.amount_ml);
    setWaterMl(total);
    setPoints(previous => previous + (saved.points_awarded ?? 0));
    return { total, xp: saved.points_awarded ?? 0 };
  }, [user.demo, waterMl]);

  // Saves a meal portion; returns XP earned.
  const addMeal = useCallback(async (meal: Omit<MealEntry, 'id' | 'loggedAt'>) => {
    if (user.demo) {
      const entry = { ...meal, id: crypto.randomUUID(), loggedAt: Date.now() };
      setMeals(previous => [entry, ...previous]);
      return 0;
    }
    const saved = await postMeal(meal);
    setMeals(previous => [toMeal(saved), ...previous.filter(item => item.id !== saved.id)]);
    setPoints(previous => previous + (saved.points_awarded ?? 0));
    return saved.points_awarded ?? 0;
  }, [user.demo]);

  // Deletes a logged meal.
  const removeMeal = useCallback(async (id: string) => {
    if (!user.demo) await deleteMeal(id);
    setMeals(previous => previous.filter(meal => meal.id !== id));
  }, [user.demo]);

  // Marks a tutorial complete; returns XP earned (0 if already done).
  const completeTutorial = useCallback(async (id: string) => {
    const result = await completeTutorialRequest(id);
    setWatchedTutorials(previous => (previous.includes(id) ? previous : [...previous, id]));
    setPoints(previous => previous + result.points_awarded);
    return result.points_awarded;
  }, []);

  // Saves a mood check-in, then refreshes tasks the Worker auto-completed.
  const logMood = useCallback(async (score: number) => {
    await postSelfReport({ mood: score });
    const today = await fetchToday(user.user_id);
    setTasks(today.tasks);
    setPoints(today.points);
    setStreak(today.streak_days);
  }, [user.user_id]);

  const value = useMemo<MissionContextValue>(() => {
    // The Worker resolves goals into settings: the latest flight-surgeon (or own) goal, then saved settings, then defaults.
    const prefs = settings ?? DEFAULT_SETTINGS;
    const goals = nutritionGoals(prefs);
    return {
      user, xp: points, streak, tasks: tasks.map(toMissionTask),
      completed: tasks.filter(row => row.completed_at).map(row => String(row.id)),
      meals, waterMl, watchedTutorials, settings,
      goals,
      waterGoalMl: prefs.water_goal_ml,
      waterStepMl: prefs.water_step_ml, loading, loadError,
      toggleTask, completeTaskByKey, addWater, addMeal, removeMeal, completeTutorial, logMood, reload,
    };
  }, [user, points, streak, tasks, meals, waterMl, watchedTutorials, settings, loading, loadError,
    toggleTask, completeTaskByKey, addWater, addMeal, removeMeal, completeTutorial, logMood, reload]);

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}
