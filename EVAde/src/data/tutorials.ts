import type { ApiTutorial } from '../services/healthApi';

export type TutorialCategory = 'Vitals' | 'Blood' | 'Musculoskeletal' | 'Radiation' | 'Mind & sleep';

export interface Tutorial {
  id: string;
  title: string;
  summary: string;
  category: TutorialCategory;
  minutes: number;
  xp: number;
  videoSrc: string | null;
  posterSrc: string | null;
  steps: string[];
}

export const TUTORIAL_CATEGORIES: TutorialCategory[] = ['Vitals', 'Blood', 'Musculoskeletal', 'Radiation', 'Mind & sleep'];

export const CATEGORY_COLORS: Record<TutorialCategory, 'blue' | 'pink' | 'orange' | 'yellow' | 'purple'> = {
  Vitals: 'blue',
  Blood: 'pink',
  Musculoskeletal: 'orange',
  Radiation: 'yellow',
  'Mind & sleep': 'purple',
};

// Maps a Worker tutorial row onto the UI shape.
export function toTutorial(row: ApiTutorial): Tutorial {
  const category = TUTORIAL_CATEGORIES.includes(row.category as TutorialCategory) ? (row.category as TutorialCategory) : 'Vitals';
  return {
    id: row.id, title: row.title, summary: row.summary, category, minutes: row.minutes, xp: row.points,
    videoSrc: row.video_url, posterSrc: row.poster_url, steps: row.steps,
  };
}
