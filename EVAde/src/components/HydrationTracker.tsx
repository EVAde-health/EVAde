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

const GLASSES = WATER_GOAL_ML / WATER_STEP_ML;

// Animated water tank with quick add/remove pouch buttons.
export default function HydrationTracker() {
  const { waterMl, addWater } = useMission();
  const showToast = useToast();
  const fill = Math.min(1, waterMl / WATER_GOAL_ML);
  const glasses = Math.round(waterMl / WATER_STEP_ML);

  // Adds one pouch and celebrates hitting the daily goal.
  function drink() {
    addWater(WATER_STEP_ML, WATER_XP);
    if (waterMl < WATER_GOAL_ML && waterMl + WATER_STEP_ML >= WATER_GOAL_ML) {
      showToast({ body: '💧 Hydration goal reached!' });
    }
  }

  return (
    <PanelCard title="Drink water" subtitle={`Goal ${WATER_GOAL_ML / 1000} L · +${WATER_XP} XP per pouch`} icon={BeakerIcon} status={fill >= 1 ? 'nominal' : 'caution'}>
      <HStack gap={5} vAlign="center">
        <Stack className="hydration__tank" role="img" aria-label={`${Math.round(fill * 100)}% of daily water goal`}>
          <Stack className="hydration__water" style={{ transform: `translateY(${(1 - fill) * 100}%)` }} />
          <Stack className="hydration__bubbles" aria-hidden="true" />
        </Stack>
        <VStack gap={3}>
          <VStack gap={0.5}>
            <Text type="display-3" hasTabularNumbers>{(waterMl / 1000).toFixed(2)} L</Text>
            <Text type="supporting" hasTabularNumbers>{glasses} of {GLASSES} pouches</Text>
          </VStack>
          <HStack gap={2}>
            <Button label="Remove pouch" isIconOnly icon={<Icon icon={MinusIcon} />} onClick={() => addWater(-WATER_STEP_ML, WATER_XP)} isDisabled={waterMl === 0} />
            <Button label={`+${WATER_STEP_ML} ml`} variant="primary" icon={<Icon icon={PlusIcon} />} onClick={drink} />
          </HStack>
        </VStack>
      </HStack>
    </PanelCard>
  );
}
