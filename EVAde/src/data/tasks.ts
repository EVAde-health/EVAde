import type { ComponentType, SVGProps } from 'react';
import {
  BeakerIcon,
  BoltIcon,
  CameraIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  FaceSmileIcon,
  FireIcon,
  GlobeAmericasIcon,
  HeartIcon,
  MoonIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
  SunIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';
import type { ApiTask, UserSettings } from '../services/healthApi';

export type TaskKind = 'protocol' | 'basic';

export interface MissionTask {
  id: string;
  key: string;
  kind: TaskKind;
  title: string;
  detail: string;
  xp: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tutorialId?: string;
  window?: string;
  metric: string | null;
}

export interface NutritionGoals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// XP the Worker grants per meal and per water pouch (capped per day server-side).
export const MEAL_XP = 10;
export const WATER_XP = 5;
export const SELFIE_TASK_KEY = 'b-selfie';

// Heroicon names stored in task_templates.icon, mapped to components.
const TASK_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  BeakerIcon, BoltIcon, CameraIcon, ChatBubbleLeftRightIcon, FaceSmileIcon, FireIcon, GlobeAmericasIcon,
  HeartIcon, MoonIcon, ShieldCheckIcon, SignalIcon, SparklesIcon, SunIcon, TrophyIcon,
};

// Converts a Worker task row into the shape the checklist renders.
export function toMissionTask(row: ApiTask): MissionTask {
  return {
    id: String(row.id),
    key: row.task_key,
    kind: row.kind,
    title: row.title,
    detail: row.detail ?? '',
    xp: row.points,
    icon: TASK_ICONS[row.icon ?? ''] ?? CheckCircleIcon,
    tutorialId: row.tutorial_id ?? undefined,
    window: row.time_window ?? undefined,
    metric: row.metric,
  };
}

// Daily macro goals from the user's settings.
export function nutritionGoals(settings: UserSettings): NutritionGoals {
  return { kcal: settings.kcal_goal, protein: settings.protein_goal_g, carbs: settings.carbs_goal_g, fat: settings.fat_goal_g };
}
