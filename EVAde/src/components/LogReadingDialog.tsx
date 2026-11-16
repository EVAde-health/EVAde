import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useHealthData } from '../context/HealthDataContext';
import { useMission } from '../context/MissionContext';
import { LEVEL_STATUS } from '../data/metrics';
import { STATUS_STYLES } from '../data/status';
import { postReadings, type MetricDefinition } from '../services/healthApi';
import { useToast } from '../context/ToastCenterContext';

// Computed scores and meal/water totals are not typed in: models and the meal/water loggers produce them.
// Diastolic is logged together with systolic under "Blood pressure".
const NOT_LOGGABLE = new Set([
  'health_score', 'behavior_index', 'stress_index', 'diastolic_bp',
  'kcal_intake', 'protein_intake_g', 'carbs_intake_g', 'fat_intake_g', 'water_intake_ml',
]);
const GROUP_LABELS: Record<string, string> = {
  vitals: 'Vitals', sleep: 'Sleep', mind: 'Mind', bone: 'Bone', immune: 'Immune', radiation: 'Radiation', nutrition: 'Body',
};

// Every metric a person can log by hand, grouped like the dashboard.
function loggableMetrics(defs: Map<string, MetricDefinition>) {
  return [...defs.values()].filter(def => !NOT_LOGGABLE.has(def.metric))
    .sort((a, b) => (a.ui_group ?? '').localeCompare(b.ui_group ?? '') || a.label.localeCompare(b.label));
}

// Normal range of a metric as readable text.
function normalText(def: MetricDefinition) {
  if (def.green_min === null && def.green_max === null) return null;
  const openTop = def.green_max === null || (def.display_max !== null && def.green_max >= def.display_max) || (def.unit === '%' && def.green_max >= 100);
  if (openTop) return `at least ${def.green_min} ${def.unit}`;
  if (def.green_min === null) return `up to ${def.green_max} ${def.unit}`;
  return `${def.green_min}–${def.green_max} ${def.unit}`;
}

// Dialog that logs one reading (or a blood-pressure pair) at the current time.
export default function LogReadingDialog({ initialMetric, onClose }: { initialMetric?: string; onClose: () => void }) {
  const { defs, reload } = useHealthData();
  const { reload: reloadMission } = useMission();
  const showToast = useToast();
  const options = loggableMetrics(defs);
  const start = initialMetric === 'diastolic_bp' ? 'systolic_bp' : initialMetric;
  const [metric, setMetric] = useState(start && defs.has(start) ? start : options[0]?.metric ?? '');
  const [value, setValue] = useState<number | null>(null);
  const [diastolic, setDiastolic] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [now] = useState(() => new Date().toISOString());
  const def = defs.get(metric);
  const isBloodPressure = metric === 'systolic_bp' && defs.has('diastolic_bp');
  const valid = value !== null && Number.isFinite(value) && (!isBloodPressure || (diastolic !== null && Number.isFinite(diastolic)));
  const selectorOptions = options.map(item => ({
    value: item.metric,
    label: `${GROUP_LABELS[item.ui_group ?? ''] ?? 'Other'} · ${item.metric === 'systolic_bp' ? 'Blood pressure' : item.label}`,
  }));

  // Switches the metric and clears the typed values.
  function chooseMetric(next: string) {
    setMetric(next);
    setValue(null);
    setDiastolic(null);
  }

  // Saves the reading(s), confirms with a toast and refreshes the dashboard.
  async function save() {
    if (!valid || !def || value === null) return;
    setSaving(true);
    const readings = isBloodPressure && diastolic !== null
      ? [{ metric, value }, { metric: 'diastolic_bp', value: diastolic }]
      : [{ metric, value }];
    try {
      const result = await postReadings(readings);
      const worst = result.stored.some(r => r.level === 'red') ? 'red' : result.stored.some(r => r.level === 'yellow') ? 'yellow' : 'green';
      const label = isBloodPressure ? 'Blood pressure' : def.label;
      const shown = isBloodPressure ? `${value}/${diastolic} mmHg` : `${value} ${def.unit}`;
      const xp = result.points_awarded ? ` · +${result.points_awarded} XP` : '';
      const note = worst === 'red' ? ' The flight surgeon has been alerted.' : '';
      showToast({ body: `${label} ${shown} logged · ${STATUS_STYLES[LEVEL_STATUS[worst]].label}${xp}.${note}`, type: worst === 'red' ? 'error' : 'info' });
      reload();
      reloadMission();
      window.dispatchEvent(new Event('evade:reading-logged'));
      onClose();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The reading was not saved. Try again.', type: 'error' });
      setSaving(false);
    }
  }

  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} purpose="form" width={480}>
      <VStack gap={4} padding={2}>
        <VStack gap={1}>
          <Heading level={2}>Log a reading</Heading>
          <Text color="secondary">Saved at <Timestamp value={now} format="auto" /> and added to your charts and forecast.</Text>
        </VStack>
        <Selector label="Metric" options={selectorOptions} value={metric} onChange={next => next && chooseMetric(next)} hasSearch />
        {def && (
          <HStack gap={3} wrap="wrap">
            <NumberInput label={isBloodPressure ? 'Systolic (mmHg)' : `${def.label} (${def.unit})`} value={value} onChange={setValue} hasAutoFocus />
            {isBloodPressure && <NumberInput label="Diastolic (mmHg)" value={diastolic} onChange={setDiastolic} />}
          </HStack>
        )}
        {def && (
          <VStack gap={1}>
            {normalText(def) && <Text type="supporting">Normal range: {normalText(def)}</Text>}
            <Text type="supporting">{def.how_to_measure}</Text>
          </VStack>
        )}
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="secondary" onClick={onClose} isDisabled={saving} />
          <Button label={saving ? 'Saving…' : 'Log reading'} variant="primary" onClick={save} isDisabled={!valid || saving} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
