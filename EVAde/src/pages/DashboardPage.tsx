import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Icon } from '@astryxdesign/core/Icon';
import { ArrowPathIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import BehaviorPanel from '../components/BehaviorPanel';
import BonePanel from '../components/BonePanel';
import CardioPanel from '../components/CardioPanel';
import MetricExplorer from '../components/MetricExplorer';
import MoodPanel from '../components/MoodPanel';
import NutritionPanel from '../components/NutritionPanel';
import PageHeader from '../components/PageHeader';
import RadiationPanel from '../components/RadiationPanel';
import ScoreRing from '../components/ScoreRing';
import SectionTitle from '../components/SectionTitle';
import SleepPanel from '../components/SleepPanel';
import StatusBadge from '../components/StatusBadge';
import VitalTile from '../components/VitalTile';
import { levelInfo, useMission } from '../context/MissionContext';
import { CREW, behaviorScore, weeklySleepAverage } from '../data/mission';
import { STATUS_STYLES, classify, type HealthStatus } from '../data/status';
import { BASIC_TASKS, PROTOCOL_TASKS } from '../data/tasks';
import { EXPLORER_VITALS, VITALS, formatReading, getSnapshot, type VitalId } from '../data/vitals';
import './css/DashboardPage.css';

const STATUS_POINTS: Record<HealthStatus, number> = { nominal: 100, caution: 72, critical: 35 };
const TASK_TOTAL = PROTOCOL_TASKS.length + BASIC_TASKS.length;

// Morning/afternoon/evening greeting for the local time.
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}

// Snapshot of every vital tile shown on the dashboard.
function buildTiles() {
  return EXPLORER_VITALS.map(id => {
    const snap = getSnapshot(id);
    if (id !== 'systolic') return { id, label: VITALS[id].label, value: formatReading(id, snap.latest), unit: VITALS[id].unit, ...snap };
    const dia = getSnapshot('diastolic');
    const status = STATUS_POINTS[dia.status] < STATUS_POINTS[snap.status] ? dia.status : snap.status;
    return { id, label: 'Blood pressure', value: `${snap.latest}/${dia.latest}`, unit: 'mmHg', ...snap, status };
  });
}

// Overall 0–100 health score from every signal's status.
function overallScore(statuses: HealthStatus[]) {
  return Math.round(statuses.reduce((sum, s) => sum + STATUS_POINTS[s], 0) / statuses.length);
}

// Main health dashboard: overview, mind & rest, vitals, long-term risks.
export default function DashboardPage() {
  const [selectedVital, setSelectedVital] = useState<VitalId>('heartRate');
  const { xp, completed, streak } = useMission();
  const tiles = buildTiles();
  const signalStatuses: HealthStatus[] = [
    ...tiles.map(t => t.status),
    classify(weeklySleepAverage(), [7, 10], [6, 10]),
    classify(behaviorScore(), [65, 100], [50, 100]),
  ];
  const score = overallScore(signalStatuses);
  const scoreStatus = classify(score, [85, 100], [65, 100]);
  const counts = signalStatuses.reduce<Record<HealthStatus, number>>((acc, s) => ({ ...acc, [s]: acc[s] + 1 }), { nominal: 0, caution: 0, critical: 0 });
  const { level, rank } = levelInfo(xp);

  // Selects a vital and scrolls the explorer into view.
  function exploreVital(id: VitalId) {
    setSelectedVital(id);
    document.getElementById('metric-explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <VStack gap={8} padding={6} className="page dashboard">
      <PageHeader
        eyebrow={`${CREW.mission} · Mission day ${CREW.missionDay} of ${CREW.missionLength}`}
        title={`${greeting()}, ${CREW.name.split(' ')[0]}`}
        description="Here’s how your body and mind are adapting to orbit today."
        actions={
          <>
            <HStack gap={2} vAlign="center" className="dashboard__sync">
              <StatusDot variant="success" label="Sensors synced" isPulsing />
              <Text type="supporting">Synced 2 min ago</Text>
            </HStack>
            <Button label="Refresh" variant="secondary" icon={<Icon icon={ArrowPathIcon} />} />
          </>
        }
      />

      <Card padding={6} className="dashboard__overview rise-in">
        <Grid columns={{ minWidth: 260, max: 3 }} gap={6}>
          <HStack gap={5} vAlign="center">
            <ScoreRing value={score} label="Overall health score" tone={scoreStatus} size="lg" />
            <VStack gap={2}>
              <Text type="label" color="secondary">Overall health score</Text>
              <HStack gap={2} wrap="wrap">
                {(['nominal', 'caution', 'critical'] as const).map(s =>
                  counts[s] > 0 ? <StatusBadge key={s} status={s} label={`${counts[s]} ${STATUS_STYLES[s].label.toLowerCase()}`} /> : null,
                )}
              </HStack>
              <Text type="supporting">Across {signalStatuses.length} monitored signals</Text>
            </VStack>
          </HStack>

          <VStack gap={3} vAlign="center">
            <HStack hAlign="between">
              <Text type="label">Mission progress</Text>
              <Text type="supporting" hasTabularNumbers>Day {CREW.missionDay} / {CREW.missionLength}</Text>
            </HStack>
            <ProgressBar label="Mission progress" isLabelHidden value={CREW.missionDay} max={CREW.missionLength} />
            <HStack hAlign="between">
              <Text type="label">Today’s missions</Text>
              <Text type="supporting" hasTabularNumbers>{completed.length} / {TASK_TOTAL} done</Text>
            </HStack>
            <ProgressBar label="Today's missions" isLabelHidden value={completed.length} max={TASK_TOTAL} variant="success" />
          </VStack>

          <VStack gap={3} vAlign="center" className="dashboard__rank">
            <Text type="label" color="secondary">Crew rank</Text>
            <Heading level={2} className="text-gradient">Lv {level} · {rank}</Heading>
            <Text type="supporting">{xp.toLocaleString()} XP · {streak}-day streak 🔥</Text>
            <HStack>
              <Button label="Today’s missions" variant="primary" href="/tasks" endContent={<Icon icon={ArrowRightIcon} />} />
            </HStack>
          </VStack>
        </Grid>
      </Card>

      <VStack gap={4}>
        <SectionTitle title="Mind & rest" caption="Behavioral health, mood and sleep — the earliest signs of mission strain" />
        <Grid columns={{ minWidth: 340, max: 3 }} gap={4}>
          <BehaviorPanel />
          <MoodPanel />
          <SleepPanel />
        </Grid>
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="Vitals" caption="Select a vital to explore its history below" />
        <Grid columns={{ minWidth: 200, max: 5 }} gap={3}>
          {tiles.map((tile, i) => (
            <VitalTile
              key={tile.id}
              index={i}
              label={tile.label}
              value={tile.value}
              unit={tile.unit}
              status={tile.status}
              delta={tile.delta}
              spark={tile.spark}
              isSelected={selectedVital === tile.id}
              onSelect={() => exploreVital(tile.id)}
            />
          ))}
        </Grid>
        <StackItem id="metric-explorer" className="dashboard__explorer">
          <MetricExplorer vital={selectedVital} onVitalChange={setSelectedVital} />
        </StackItem>
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="Long-term risks" caption="Slow-moving threats of spaceflight, tracked across the mission" />
        <Grid columns={{ minWidth: 380, max: 2 }} gap={4}>
          <RadiationPanel />
          <BonePanel />
          <CardioPanel />
          <NutritionPanel />
        </Grid>
      </VStack>
    </VStack>
  );
}
