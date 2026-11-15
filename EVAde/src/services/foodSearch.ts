import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead';
import { searchFoods, type ApiFood } from './healthApi';

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodData {
  per100g: Macros;
  brand?: string;
  source: 'Space pantry' | 'USDA' | 'Open Food Facts' | 'Custom';
}

export type FoodItem = SearchableItem<FoodData>;

const REQUEST_TIMEOUT_MS = 9000;
const SOURCE_LABELS: Record<ApiFood['source'], FoodData['source']> = {
  space_pantry: 'Space pantry',
  usda: 'USDA',
  open_food_facts: 'Open Food Facts',
  custom: 'Custom',
};

const resultCache = new Map<string, FoodItem[]>();

// Rounds macro values to one decimal.
function tidy(value: number) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

// Maps a Worker food row onto a Typeahead item.
function toFoodItem(food: ApiFood): FoodItem {
  return { id: food.id, label: food.label, auxiliaryData: { per100g: food.per100g, brand: food.brand ?? undefined, source: SOURCE_LABELS[food.source] } };
}

// Searches foods through the Worker (pantry in D1, then USDA / Open Food Facts), cached per query.
async function searchRemote(query: string, signal: AbortSignal) {
  const key = query.trim().toLowerCase();
  const cached = resultCache.get(key);
  if (cached) return cached;
  const timed = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  const results = (await searchFoods(query.trim(), { signal: timed })).map(toFoodItem);
  resultCache.set(key, results);
  return results;
}

// Scales per-100g macros to an eaten portion.
export function macrosForPortion(per100g: Macros, grams: number): Macros {
  const factor = grams / 100;
  return {
    kcal: Math.round(per100g.kcal * factor),
    protein: tidy(per100g.protein * factor),
    carbs: tidy(per100g.carbs * factor),
    fat: tidy(per100g.fat * factor),
  };
}

// Builds a Typeahead source backed by the Worker's /foods/search.
export function createFoodSearchSource(): SearchSource<FoodItem> {
  let controller: AbortController | null = null;
  return {
    cancel() {
      controller?.abort();
    },
    async search(query: string) {
      controller?.abort();
      controller = new AbortController();
      if (query.trim().length < 2) return [];
      try {
        return await searchRemote(query, controller.signal);
      } catch {
        return [];
      }
    },
    bootstrap() {
      return [];
    },
  };
}
