import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { MissionContext, type MealEntry, type MissionContextValue } from '../context/MissionContext';
import { PROTOCOL_TASKS, type MissionTask } from '../data/tasks';
import { usePersistentState } from '../hooks/usePersistentState';
import { api, userPath, type ApiTask, type SessionUser } from '../services/api';

type ApiMeal = Omit<MealEntry, 'loggedAt'> & { ts: string };
type LocalProgress = { xp: number; selfieDay: string; watchedTutorials: string[] };

const tutorialByMetric: Record<string, string> = {
  systolic_bp: 'bp-cuff', hrv_rmssd: 'ecg-patch', body_temp: 'temp-sensor', blood_glucose: 'glucose-cgm',
  daily_radiation_msv: 'dosimeter', mood: 'mood-checkin', sleep_hours: 'sleep-setup',
};

function toTask(row: ApiTask): MissionTask {
  const tutorialId = tutorialByMetric[row.metric ?? ''];
  const related = tutorialId ? PROTOCOL_TASKS.find(task => task.tutorialId === tutorialId) : undefined;
  return {
    id: String(row.id),
    kind: row.metric || row.category === 'advanced' ? 'protocol' : 'basic',
    title: row.title,
    detail: related?.detail ?? '',
    xp: row.points,
    icon: related?.icon ?? CheckCircleIcon,
    tutorialId: related?.tutorialId,
    metric: row.metric,
  };
}

function today(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { since: midnight.toISOString(), until: tomorrow.toISOString() };
}

const toMeal = ({ ts, ...meal }: ApiMeal) => ({ ...meal, loggedAt: Date.parse(ts) });

export default function MissionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [progress, setProgress] = usePersistentState<LocalProgress>(`evade:progress:${user.user_id}`, {
    xp: 0, selfieDay: '', watchedTutorials: [],
  });
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [points, setPoints] = useState(user.points);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const taskWrites = useRef(new Map<string, Promise<boolean>>());
  const userId = user.user_id;
  const { since, until } = today();

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ since, until }).toString();
    const options = { signal: controller.signal };
    Promise.allSettled([
      api<ApiTask[]>(userPath(userId, 'tasks'), options),
      api<ApiMeal[]>(userPath(userId, 'meals?' + query), options),
      api<{ total_ml: number }>(userPath(userId, 'hydration?' + query), options),
    ]).then(([taskResult, mealResult, waterResult]) => {
      if (controller.signal.aborted) return;
      if (taskResult.status === 'fulfilled') setTasks(taskResult.value);
      if (mealResult.status === 'fulfilled') setMeals(mealResult.value.map(toMeal));
      if (waterResult.status === 'fulfilled') setWaterMl(Math.max(0, waterResult.value.total_ml));
      setLoadError([taskResult, mealResult, waterResult].some(result => result.status === 'rejected'));
      setLoading(false);
    });
    return () => controller.abort();
  }, [userId, since, until, revision]);

  function reload() {
    setLoading(true);
    setRevision(previous => previous + 1);
  }

  function toggleTask(id: string) {
    const pending = taskWrites.current.get(id);
    if (pending) return pending;
    const row = tasks.find(task => String(task.id) === id);
    if (!row) return Promise.resolve(false);
    const complete = !row.completed_at;
    const operation = complete ? 'complete' : 'reopen';
    const write = api<{ points_awarded?: number }>(`/tasks/${encodeURIComponent(id)}/${operation}`, { method: 'POST' })
      .then(result => {
        setTasks(previous => previous.map(task => String(task.id) === id
          ? { ...task, completed_at: complete ? new Date().toISOString() : null }
          : task));
        setPoints(previous => Math.max(0, previous + (result.points_awarded ?? 0)));
        return complete;
      })
      .finally(() => taskWrites.current.delete(id));
    taskWrites.current.set(id, write);
    return write;
  }

  async function addWater(amount: number, xp: number) {
    const timestamp = new Date();
    const saved = await api<{ amount_ml: number }>('/hydration', {
      method: 'POST', body: { id: crypto.randomUUID(), user_id: userId, amount_ml: amount, ts: timestamp.toISOString(), ...today(timestamp) },
    });
    setWaterMl(previous => Math.max(0, previous + saved.amount_ml));
    setProgress(previous => ({ ...previous, xp: Math.max(0, previous.xp + (amount > 0 ? xp : -xp)) }));
    return Math.max(0, waterMl + saved.amount_ml);
  }

  async function addMeal(meal: Omit<MealEntry, 'id' | 'loggedAt'>, xp: number) {
    const saved = toMeal(await api<ApiMeal>('/meals', { method: 'POST', body: { id: crypto.randomUUID(), user_id: userId, ...meal } }));
    setMeals(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
    setProgress(previous => ({ ...previous, xp: previous.xp + xp }));
  }

  async function removeMeal(id: string) {
    await api(`/meals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setMeals(previous => previous.filter(meal => meal.id !== id));
  }

  function completeTutorial(id: string, xp: number) {
    if (progress.watchedTutorials.includes(id)) return false;
    setProgress(previous => previous.watchedTutorials.includes(id) ? previous : {
      ...previous, xp: previous.xp + xp, watchedTutorials: [...previous.watchedTutorials, id],
    });
    return true;
  }

  function awardSelfie(xp: number) {
    const day = today().since;
    if (progress.selfieDay === day) return false;
    setProgress(previous => previous.selfieDay === day ? previous : { ...previous, selfieDay: day, xp: previous.xp + xp });
    return true;
  }

  const value: MissionContextValue = {
    user, xp: points + progress.xp, streak: user.streak_days, tasks: tasks.map(toTask),
    completed: tasks.filter(row => row.completed_at).map(row => String(row.id)),
    meals, waterMl, watchedTutorials: progress.watchedTutorials, loading, loadError,
    toggleTask, addWater, addMeal, removeMeal, reload, awardSelfie, completeTutorial,
  };
  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}
