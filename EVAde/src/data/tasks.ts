import type { ComponentType, SVGProps } from 'react';
import {
  BeakerIcon,
  CameraIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
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

export type TaskKind = 'protocol' | 'basic';

export interface MissionTask {
  id: string;
  kind: TaskKind;
  title: string;
  detail: string;
  xp: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tutorialId?: string;
  window?: string;
  metric?: string | null;
}

export interface NutritionGoals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const WATER_GOAL_ML = 2500;
export const WATER_STEP_ML = 250;
export const NUTRITION_GOALS: NutritionGoals = { kcal: 2800, protein: 110, carbs: 360, fat: 95 };

export const PROTOCOL_TASKS: MissionTask[] = [
  { id: 'p-bp', kind: 'protocol', title: 'Morning blood pressure', detail: 'Seated cuff reading after waking', xp: 30, icon: HeartIcon, tutorialId: 'bp-cuff', window: '07:00' },
  { id: 'p-ecg', kind: 'protocol', title: 'ECG patch check', detail: 'Confirm clean signal for the cardio model', xp: 40, icon: SignalIcon, tutorialId: 'ecg-patch', window: '07:15' },
  { id: 'p-temp', kind: 'protocol', title: 'Body temperature', detail: 'Verify core temp sensor calibration', xp: 20, icon: FireIcon, tutorialId: 'temp-sensor', window: '07:20' },
  { id: 'p-glucose', kind: 'protocol', title: 'Glucose calibration', detail: 'Fingerstick to calibrate the CGM', xp: 35, icon: BeakerIcon, tutorialId: 'glucose-cgm', window: '08:30' },
  { id: 'p-dose', kind: 'protocol', title: 'Dosimeter download', detail: 'Log today’s radiation dose', xp: 15, icon: ShieldCheckIcon, tutorialId: 'dosimeter', window: '12:00' },
  { id: 'p-immune', kind: 'protocol', title: 'Immune panel blood draw', detail: 'Weekly sample for immune markers', xp: 80, icon: SparklesIcon, tutorialId: 'blood-draw', window: 'Weekly' },
  { id: 'p-bone', kind: 'protocol', title: 'Bone ultrasound scan', detail: 'Heel + hip density capture', xp: 60, icon: BoltIcon, tutorialId: 'ultrasound-bone', window: 'Weekly' },
  { id: 'p-mood', kind: 'protocol', title: 'Behavioral health check-in', detail: 'Five-question survey + mood rating', xp: 25, icon: FaceSmileIcon, tutorialId: 'mood-checkin', window: '20:00' },
  { id: 'p-sleep', kind: 'protocol', title: 'Start sleep session', detail: 'EEG headband on, lights to amber', xp: 25, icon: MoonIcon, tutorialId: 'sleep-setup', window: '22:30' },
];

export const BASIC_TASKS: MissionTask[] = [
  { id: 'b-exercise', kind: 'basic', title: 'Exercise 2 hours', detail: 'ARED + treadmill or CEVIS bike', xp: 40, icon: TrophyIcon },
  { id: 'b-earth', kind: 'basic', title: 'Window time', detail: '10 minutes of Earth observation', xp: 15, icon: GlobeAmericasIcon },
  { id: 'b-call', kind: 'basic', title: 'Call home', detail: 'Connect with family or friends', xp: 20, icon: ChatBubbleLeftRightIcon },
  { id: 'b-selfie', kind: 'basic', title: 'Daily selfie', detail: 'Visual check-in on the Selfies page', xp: 15, icon: CameraIcon },
  { id: 'b-light', kind: 'basic', title: 'Blue-light morning', detail: 'Bright lighting profile for 30 min', xp: 10, icon: SunIcon },
];

export const WATER_XP = 5;
export const MEAL_XP = 10;
