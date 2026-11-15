import type { SearchableItem, SearchContext, SearchSource } from '@astryxdesign/core/Typeahead';

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodData {
  per100g: Macros;
  brand?: string;
  source: 'Space pantry' | 'USDA' | 'Open Food Facts';
}

export type FoodItem = SearchableItem<FoodData>;

interface UsdaNutrient {
  nutrientNumber?: string;
  value?: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  foodNutrients?: UsdaNutrient[];
}

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Record<string, number | string | undefined>;
}

const USDA_KEY = import.meta.env.VITE_USDA_API_KEY as string | undefined;
const REQUEST_TIMEOUT_MS = 7000;
const MAX_RESULTS = 8;

// Offline pantry so search still works without a downlink.
const SPACE_PANTRY: Array<[string, Macros]> = [
  ['Thermostabilized beef brisket', { kcal: 210, protein: 24, carbs: 2, fat: 12 }],
  ['Rehydratable scrambled eggs', { kcal: 155, protein: 12, carbs: 2, fat: 11 }],
  ['Tortilla (flour)', { kcal: 310, protein: 8, carbs: 52, fat: 8 }],
  ['Oatmeal with raisins', { kcal: 370, protein: 11, carbs: 66, fat: 6 }],
  ['Shrimp cocktail', { kcal: 105, protein: 20, carbs: 4, fat: 1 }],
  ['Macaroni and cheese', { kcal: 165, protein: 7, carbs: 20, fat: 6 }],
  ['Chicken teriyaki', { kcal: 140, protein: 18, carbs: 8, fat: 4 }],
  ['Dried apricots', { kcal: 240, protein: 3, carbs: 63, fat: 0.5 }],
  ['Peanut butter', { kcal: 590, protein: 25, carbs: 20, fat: 50 }],
  ['Granola bar', { kcal: 470, protein: 10, carbs: 64, fat: 20 }],
  ['Fresh apple', { kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 }],
  ['Salmon (thermostabilized)', { kcal: 180, protein: 22, carbs: 0, fat: 10 }],
  ['Protein shake', { kcal: 120, protein: 20, carbs: 5, fat: 2 }],
  ['Brownie', { kcal: 405, protein: 5, carbs: 60, fat: 16 }],
  ['Rice pilaf', { kcal: 130, protein: 3, carbs: 28, fat: 1 }],
  ['Coffee with cream', { kcal: 30, protein: 1, carbs: 2, fat: 2 }],
];

const PANTRY_ITEMS: FoodItem[] = SPACE_PANTRY.map(([label, per100g], i) => ({
  id: `pantry-${i}`,
  label,
  auxiliaryData: { per100g, source: 'Space pantry' },
}));

const remoteCache = new Map<string, FoodItem[]>();

// Rounds macro values to one decimal.
function tidy(value: unknown) {
  const number = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

// Matches pantry foods whose name contains the query.
function searchPantry(query: string) {
  const needle = query.trim().toLowerCase();
  return PANTRY_ITEMS.filter(item => item.label.toLowerCase().includes(needle)).slice(0, 4);
}

// Picks one USDA nutrient value by its standard number.
function usdaNutrient(food: UsdaFood, number: string) {
  return tidy(food.foodNutrients?.find(n => n.nutrientNumber === number)?.value);
}

// Queries USDA FoodData Central when an API key is configured.
async function searchUsda(query: string, signal: AbortSignal): Promise<FoodItem[]> {
  const params = new URLSearchParams({ api_key: USDA_KEY ?? '', query, pageSize: String(MAX_RESULTS), dataType: 'Foundation,SR Legacy,Branded' });
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, { signal });
  if (!response.ok) throw new Error(`USDA ${response.status}`);
  const body = (await response.json()) as { foods?: UsdaFood[] };
  return (body.foods ?? []).map(food => ({
    id: `usda-${food.fdcId}`,
    label: food.description,
    auxiliaryData: {
      brand: food.brandOwner,
      source: 'USDA',
      per100g: { kcal: usdaNutrient(food, '208'), protein: usdaNutrient(food, '203'), carbs: usdaNutrient(food, '205'), fat: usdaNutrient(food, '204') },
    },
  }));
}

// Queries the keyless Open Food Facts product search.
async function searchOpenFoodFacts(query: string, signal: AbortSignal): Promise<FoodItem[]> {
  const params = new URLSearchParams({
    search_terms: query, search_simple: '1', action: 'process', json: '1',
    page_size: String(MAX_RESULTS), fields: 'code,product_name,brands,nutriments',
  });
  const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { signal });
  if (!response.ok) throw new Error(`Open Food Facts ${response.status}`);
  const body = (await response.json()) as { products?: OffProduct[] };
  return (body.products ?? [])
    .filter(p => p.product_name && p.nutriments)
    .map(p => ({
      id: `off-${p.code ?? p.product_name}`,
      label: p.product_name ?? 'Unknown food',
      auxiliaryData: {
        brand: p.brands?.split(',')[0],
        source: 'Open Food Facts',
        per100g: {
          kcal: tidy(p.nutriments?.['energy-kcal_100g']),
          protein: tidy(p.nutriments?.proteins_100g),
          carbs: tidy(p.nutriments?.carbohydrates_100g),
          fat: tidy(p.nutriments?.fat_100g),
        },
      },
    }));
}

// Fetches remote foods with caching, timeout and provider fallback.
async function searchRemote(query: string, signal: AbortSignal) {
  const key = query.trim().toLowerCase();
  const cached = remoteCache.get(key);
  if (cached) return cached;
  const timed = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  const results = USDA_KEY ? await searchUsda(query, timed) : await searchOpenFoodFacts(query, timed);
  remoteCache.set(key, results);
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

// Builds a Typeahead source: pantry instantly, then the remote API.
export function createFoodSearchSource(): SearchSource<FoodItem> {
  let controller: AbortController | null = null;
  return {
    cancel() {
      controller?.abort();
    },
    async search(query: string, context?: SearchContext<FoodItem>) {
      controller?.abort();
      controller = new AbortController();
      const local = searchPantry(query);
      context?.update(local);
      try {
        const remote = await searchRemote(query, controller.signal);
        return [...local, ...remote.filter(r => !local.some(l => l.label === r.label))];
      } catch {
        return local;
      }
    },
    bootstrap() {
      return PANTRY_ITEMS.slice(0, 6);
    },
  };
}
