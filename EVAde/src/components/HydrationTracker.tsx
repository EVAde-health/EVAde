import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { useToast } from '@astryxdesign/core/Toast';
import { BeakerIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useMission } from '../context/MissionContext';
import { WATER_GOAL_ML, WATER_STEP_ML, WATER_XP } from '../data/tasks';
import PanelCard from './PanelCard';
import './css/HydrationTracker.css';

// Animated water tank with quick add/remove pouch buttons.
export default function HydrationTracker() {
  const { waterMl, addWater, loading, goals } = useMission();
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const waterGoal = goals.waterMl || WATER_GOAL_ML;
  const fill = Math.min(1, waterMl / waterGoal);
  const glasses = Math.round(waterMl / WATER_STEP_ML);
  const goalPouches = Math.max(1, Math.round(waterGoal / WATER_STEP_ML));

  // Adds one pouch and celebrates hitting the daily goal.
  async function adjust(amount: number) {
    if (saving) return;
    setSaving(true);
    try {
      const total = await addWater(amount, WATER_XP);
      if (waterMl < waterGoal && total >= waterGoal) showToast({ body: '💧 Hydration goal reached!' });
    } catch {
      showToast({ body: 'The water log could not be updated. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelCard title="Drink water" subtitle={`Goal ${waterGoal / 1000} L · +${WATER_XP} XP per pouch`} icon={BeakerIcon} status={fill >= 1 ? 'nominal' : 'caution'}>
      <HStack gap={5} vAlign="center">
        <Stack className="hydration__tank" role="img" aria-label={`${Math.round(fill * 100)}% of daily water goal`}>
          <Stack className="hydration__water" style={{ transform: `translateY(${(1 - fill) * 100}%)` }} />
          <Stack className="hydration__bubbles" aria-hidden="true" />
        </Stack>
        <VStack gap={3}>
          <VStack gap={0.5}>
            <Text type="display-3" hasTabularNumbers>{(waterMl / 1000).toFixed(2)} L</Text>
            <Text type="supporting" hasTabularNumbers>{glasses} of {goalPouches} pouches</Text>
          </VStack>
          <HStack gap={2}>
            <Button label="Remove pouch" isIconOnly icon={<Icon icon={MinusIcon} />} onClick={() => adjust(-WATER_STEP_ML)} isDisabled={loading || saving || waterMl < WATER_STEP_ML} />
            <Button label={`+${WATER_STEP_ML} ml`} variant="primary" icon={<Icon icon={PlusIcon} />} onClick={() => adjust(WATER_STEP_ML)} isDisabled={loading || saving} />
          </HStack>
        </VStack>
      </HStack>
    </PanelCard>
  );
}
