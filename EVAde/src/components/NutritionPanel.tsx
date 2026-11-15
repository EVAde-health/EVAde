import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Icon } from '@astryxdesign/core/Icon';
import { ArrowRightIcon, CakeIcon } from '@heroicons/react/24/outline';
import { totalMacros, useMission } from '../context/MissionContext';
import { NUTRITION_GOALS, WATER_GOAL_ML } from '../data/tasks';
import { classify } from '../data/status';
import PanelCard from './PanelCard';

const MACRO_ROWS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;

// Picks a bar color: green on track, amber when lagging.
function progressVariant(share: number) {
  if (share > 1.15) return 'error';
  return share >= 0.6 ? 'success' : 'warning';
}

// Today's intake against goals, fed by the Missions page meal log.
export default function NutritionPanel({ hasLogLink = true }: { hasLogLink?: boolean }) {
  const { meals, waterMl } = useMission();
  const totals = totalMacros(meals);
  const dayFraction = Math.max(0.25, new Date().getHours() / 22);
  const status = classify(totals.kcal / NUTRITION_GOALS.kcal / dayFraction, [0.7, 1.3], [0.4, 1.6]);

  return (
    <PanelCard
      title="Nutrition & hydration"
      subtitle={`${meals.length} meals logged today`}
      icon={CakeIcon}
      status={meals.length ? status : 'caution'}
      actions={hasLogLink && <Button label="Log food" size="sm" variant="ghost" href="/tasks?tab=basic" endContent={<Icon icon={ArrowRightIcon} />} />}>
      <Grid columns={{ minWidth: 200, max: 2 }} gap={4}>
        {MACRO_ROWS.map(row => {
          const share = totals[row.key] / NUTRITION_GOALS[row.key];
          return (
            <VStack key={row.key} gap={1}>
              <HStack hAlign="between">
                <Text type="label">{row.label}</Text>
                <Text type="supporting" hasTabularNumbers>
                  {Math.round(totals[row.key])} / {NUTRITION_GOALS[row.key]} {row.unit}
                </Text>
              </HStack>
              <ProgressBar label={`${row.label} progress`} isLabelHidden value={Math.min(totals[row.key], NUTRITION_GOALS[row.key])} max={NUTRITION_GOALS[row.key]} variant={progressVariant(share)} />
            </VStack>
          );
        })}
        <VStack gap={1}>
          <HStack hAlign="between">
            <Text type="label">Water</Text>
            <Text type="supporting" hasTabularNumbers>{(waterMl / 1000).toFixed(2)} / {WATER_GOAL_ML / 1000} L</Text>
          </HStack>
          <ProgressBar label="Water progress" isLabelHidden value={Math.min(waterMl, WATER_GOAL_ML)} max={WATER_GOAL_ML} variant={waterMl / WATER_GOAL_ML >= 0.6 ? 'success' : 'warning'} />
        </VStack>
      </Grid>
    </PanelCard>
  );
}
