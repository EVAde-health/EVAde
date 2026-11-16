export function formatModelId(value: string): string {
  return value.replace(/\bEVA-([1-9])\b/g, 'EVA-0$1');
}

type ModelAvailability = {
  model_id?: string | null;
  task?: string;
  available?: boolean;
  state?: string;
  source?: string;
};
export type ModelCatalog = {
  data?: {
    models?: ModelAvailability[];
    unavailable?: ModelAvailability[];
    deep_models?: ModelAvailability[];
  };
};

export function isModelPlaceholder(entry: ModelAvailability) {
  return entry.state === 'mock' || entry.source === 'mock';
}
