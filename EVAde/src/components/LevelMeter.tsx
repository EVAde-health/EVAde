import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Icon } from '@astryxdesign/core/Icon';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { FireIcon } from '@heroicons/react/24/solid';
import { LEVEL_XP, levelInfo, useMission } from '../context/MissionContext';
import './css/LevelMeter.css';

// Compact rank, XP progress and streak readout for the nav.
export default function LevelMeter() {
  const { xp, streak } = useMission();
  const { level, rank, progress, toNext } = levelInfo(xp);

  return (
    <VStack gap={2} padding={3} className="level-meter">
      <HStack gap={2} vAlign="center" hAlign="between">
        <VStack gap={0.5}>
          <Text type="label" weight="semibold">Lv {level} · {rank}</Text>
          <Text type="supporting" hasTabularNumbers>{xp.toLocaleString()} XP</Text>
        </VStack>
        <Tooltip content={`${streak}-day check-in streak`}>
          <HStack gap={1} vAlign="center" className="level-meter__streak" tabIndex={0}>
            <Icon icon={FireIcon} size="sm" color="warning" />
            <Text type="label" hasTabularNumbers>{streak}</Text>
          </HStack>
        </Tooltip>
      </HStack>
      <ProgressBar label={`${toNext} XP to level ${level + 1}`} isLabelHidden value={progress} max={LEVEL_XP} />
    </VStack>
  );
}
