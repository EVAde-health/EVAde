import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { List, ListItem } from '@astryxdesign/core/List';
import { Icon } from '@astryxdesign/core/Icon';
import { ArrowPathIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import BehaviorPanel from '../components/BehaviorPanel';
import BonePanel from '../components/BonePanel';
import CardioPanel from '../components/CardioPanel';
import HealthDataProvider from '../components/HealthDataProvider';
import LogReadingButton from '../components/LogReadingButton';
import MetricExplorer from '../components/MetricExplorer';
import MoodPanel from '../components/MoodPanel';
import ModelResultsPanel from '../components/ModelResultsPanel';
import NoReadings from '../components/NoReadings';
import NutritionPanel from '../components/NutritionPanel';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import RadiationPanel from '../components/RadiationPanel';
import ReturnForecast from '../components/ReturnForecast';
import ScoreRing from '../components/ScoreRing';
import SectionTitle from '../components/SectionTitle';
import SleepPanel from '../components/SleepPanel';
import SpaceWeatherPanel from '../components/SpaceWeatherPanel';
import StatusBadge from '../components/StatusBadge';
import VitalTile from '../components/VitalTile';
import MetricModelDialog from '../components/MetricModelDialog';
import { hasAiInsight } from '../data/aiInsight';
import { useHealthData } from '../context/HealthDataContext';
import { crewGreetingName, levelInfo, useMission } from '../context/MissionContext';
import { behaviorAxes, behaviorIndex, classifyWith, healthScore, missionDay, sleepNights, weeklySleepAverage } from '../data/health';
import { EXPLORER_VITALS, LEVEL_STATUS, formatReading, getSnapshot, type Reading } from '../data/metrics';
import { STATUS_STYLES, classify, statusFromScore, worstStatus, type HealthStatus } from '../data/status';
import type { MetricDefinition } from '../services/healthApi';
import './css/DashboardPage.css';

interface Tile {
  id: string;
  label: string;
  value: string;
  unit: string;
  status: HealthStatus | null;
  delta?: number;
  spark?: number[];
}

// Morning/afternoon/evening greeting for the local time.
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}

// Status of the latest reading: the Worker's level, else the catalogue bands.
function readingStatus(reading: Reading | undefined, def: MetricDefinition | undefined) {
  if (!reading) return null;
  return reading.status ?? classifyWith(def, reading.value);
}

// One tile per explorer vital, empty when the metric has no readings yet.
function buildTiles(defs: Map<string, MetricDefinition>, readings: Map<string, Reading[]>): Tile[] {
  return EXPLORER_VITALS.map(vital => {
    const def = defs.get(vital.id);
    const decimals = def?.decimals ?? 0;
    const snap = getSnapshot(readings.get(vital.id) ?? [], decimals);
    const base = { id: vital.id, label: def?.label ?? vital.shortLabel, unit: def?.unit ?? '', value: '', status: null };
    if (!snap) return { ...base, label: vital.pair ? 'Blood pressure' : base.label };
    const status = readingStatus(snap.latest, def);
    if (!vital.pair) return { ...base, value: formatReading(snap.latest.value, decimals), status, delta: snap.delta, spark: snap.spark };
    const pairDef = defs.get(vital.pair);
    const pair = getSnapshot(readings.get(vital.pair) ?? [], pairDef?.decimals ?? 0);
    const pairStatus = readingStatus(pair?.latest, pairDef);
    const statuses = [status, pairStatus].filter((s): s is HealthStatus => s !== null);
    return {
      ...base,
      label: 'Blood pressure',
      value: pair ? `${Math.round(snap.latest.value)}/${Math.round(pair.latest.value)}` : formatReading(snap.latest.value, decimals),
      status: statuses.length ? worstStatus(statuses) : null,
      delta: snap.delta,
      spark: snap.spark,
    };
  });
}

// Dashboard body; reads live data from the surrounding HealthDataProvider.
function DashboardContent() {
  const [selectedVital, setSelectedVital] = useState(EXPLORER_VITALS[0].id);
  const { status, defs, readings, summary, updatedAt, reload } = useHealthData();
  const { user, xp, streak, tasks, completed, reload: reloadMission } = useMission();
  const [riskMetric, setRiskMetric] = useState<{ metric: string; label: string } | null>(null);
  const tiles = buildTiles(defs, readings);
  const sleepAverage = weeklySleepAverage(sleepNights(readings));
  const behavior = behaviorIndex(readings, behaviorAxes(readings));
  const signalStatuses: HealthStatus[] = [
    ...tiles.flatMap(t => (t.status ? [t.status] : [])),
    ...(sleepAverage !== null ? [classify(sleepAverage, [7, 10], [6, 10])] : []),
    ...(behavior !== null ? [classify(behavior, [65, 100], [50, 100])] : []),
  ];
  const score = healthScore(signalStatuses);
  const counts = signalStatuses.reduce<Record<HealthStatus, number>>((acc, s) => ({ ...acc, [s]: acc[s] + 1 }), { nominal: 0, caution: 0, critical: 0 });
  const day = missionDay(user);
  const missionLength = user.mission_length_days;
  const alerts = summary?.alerts ?? [];
  const { level, rank } = levelInfo(xp);

  // Selects a vital and scrolls the explorer into view.
  function exploreVital(id: string) {
    setSelectedVital(id);
    document.getElementById('metric-explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Re-fetches health data and today's missions from the API.
  function refresh() {
    reload();
    reloadMission();
  }

  if (status === 'loading') return <PageLoader />;
  return (
    <VStack gap={8} padding={6} className="page dashboard">
      <PageHeader
        eyebrow={[user.mission_name, day && (missionLength ? `Mission day ${day} of ${missionLength}` : `Mission day ${day}`)].filter(Boolean).join(' · ') || 'Mission control'}
        title={`${greeting()}, ${crewGreetingName(user)}`}
        description="Here’s how your body and mind are adapting to orbit today."
        actions={
          <>
            {updatedAt && (
              <HStack gap={2} vAlign="center" className="dashboard__sync">
                <StatusDot variant={status === 'error' ? 'error' : 'success'} label={status === 'error' ? 'Sync failed' : 'Synced'} isPulsing={status !== 'error'} />
                <Text type="supporting">Synced <Timestamp value={updatedAt} /></Text>
              </HStack>
            )}
            <Button label="Refresh" variant="secondary" icon={<Icon icon={ArrowPathIcon} />} onClick={refresh} />
            <LogReadingButton variant="primary" size="md" />
          </>
        }
      />

      {status === 'error' && (
        <Card padding={4} role="alert">
          <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
            <Text>Your health data could not be loaded from the EVAde API.</Text>
            <Button label="Try again" size="sm" onClick={reload} />
          </HStack>
        </Card>
      )}

      <Card padding={6} className="dashboard__overview rise-in">
        <Grid columns={{ minWidth: 260, max: 3 }} gap={6}>
          <HStack gap={5} vAlign="center">
            {score !== null ? (
              <>
                <ScoreRing value={score} label="Overall health score" tone={statusFromScore(score)} size="lg" />
                <VStack gap={2}>
                  <Text type="label" color="secondary">Overall health score</Text>
                  <HStack gap={2} wrap="wrap">
                    {(['nominal', 'caution', 'critical'] as const).map(s =>
                      counts[s] > 0 ? <StatusBadge key={s} status={s} label={`${counts[s]} ${STATUS_STYLES[s].label.toLowerCase()}`} /> : null,
                    )}
                  </HStack>
                  <Text type="supporting">
                    Across {signalStatuses.length} monitored {signalStatuses.length === 1 ? 'signal' : 'signals'}
                    {summary?.risk.band ? ` · EVAde risk: ${summary.risk.band}` : ''}
                  </Text>
                </VStack>
              </>
            ) : (
              <NoReadings what="Your health score" hint="Your health score appears once your first sensor readings sync." />
            )}
          </HStack>

          <VStack gap={3} vAlign="center">
            {day && missionLength && (
              <>
                <HStack hAlign="between">
                  <Text type="label">Mission progress</Text>
                  <Text type="supporting" hasTabularNumbers>Day {Math.min(day, missionLength)} / {missionLength}</Text>
                </HStack>
                <ProgressBar label="Mission progress" isLabelHidden value={Math.min(day, missionLength)} max={missionLength} />
              </>
            )}
            <HStack hAlign="between">
              <Text type="label">Today’s missions</Text>
              <Text type="supporting" hasTabularNumbers>{completed.length} / {tasks.length} done</Text>
            </HStack>
            <ProgressBar label="Today's missions" isLabelHidden value={completed.length} max={Math.max(1, tasks.length)} variant="success" />
          </VStack>

          <VStack gap={3} vAlign="center" className="dashboard__rank">
            <Text type="label" color="secondary">Crew rank</Text>
            <Heading level={2} className="text-gradient">Lv {level} · {rank}</Heading>
            <Text type="supporting">{xp.toLocaleString()} XP · {streak}-day streak{streak > 0 ? ' 🔥' : ''}</Text>
            <HStack>
              <Button label="Today’s missions" variant="primary" href="/tasks" endContent={<Icon icon={ArrowRightIcon} />} />
            </HStack>
          </VStack>
        </Grid>
      </Card>

      <ReturnForecast userId={user.user_id} />

      {alerts.length > 0 && (
        <VStack gap={4}>
          <SectionTitle title="Open alerts" caption="Flagged by the EVAde models — follow the suggested action" />
          <Card padding={2}>
            <List hasDividers edge="flush">
              {alerts.map(alert => (
                <ListItem
                  key={alert.id}
                  label={alert.message}
                  description={
                    <VStack gap={0.5}>
                      {alert.action && <Text type="supporting">{alert.action}</Text>}
                      <Timestamp value={alert.ts} />
                    </VStack>
                  }
                  endContent={<StatusBadge status={LEVEL_STATUS[alert.level]} label={alert.escalate ? 'Flight surgeon notified' : undefined} />}
                />
              ))}
            </List>
          </Card>
        </VStack>
      )}

      <VStack gap={4}>
        <SectionTitle title="Mind & rest" caption="Behavioral health, mood and sleep — the earliest signs of mission strain" />
        <Grid columns={{ minWidth: 340, max: 3 }} gap={4}>
          <BehaviorPanel />
          <MoodPanel />
          <SleepPanel />
        </Grid>
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="Vitals" caption="Tiles marked AI insight open the matching model. Use the explorer below for any vital's history" />
        <Grid columns={{ minWidth: 200, max: 4 }} gap={3}>
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
              hasAiInsight={hasAiInsight(tile.id)}
              onSelect={hasAiInsight(tile.id) ? () => { exploreVital(tile.id); setRiskMetric({ metric: tile.id, label: tile.label }); } : undefined}
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
          <SpaceWeatherPanel />
          <ModelResultsPanel />
          <BonePanel />
          <CardioPanel />
          <NutritionPanel />
        </Grid>
      </VStack>
      {riskMetric && (
        <MetricModelDialog userId={user.user_id} metric={riskMetric.metric} label={riskMetric.label} onClose={() => setRiskMetric(null)} />
      )}
    </VStack>
  );
}

// Main health dashboard, loaded from D1 for the signed-in astronaut.
export default function DashboardPage() {
  const { user } = useMission();

  return (
    <HealthDataProvider key={user.user_id} userId={user.user_id}>
      <DashboardContent />
    </HealthDataProvider>
  );
}
