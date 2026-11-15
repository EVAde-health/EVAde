import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { ArrowPathIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { EmergencyBanner } from '../components/EmergencyButton';
import NutritionPanel from '../components/NutritionPanel';
import PageHeader from '../components/PageHeader';
import SectionTitle from '../components/SectionTitle';
import StatusBadge from '../components/StatusBadge';
import { levelInfo, useMission } from '../context/MissionContext';
import { api, userPath, type ApiTask } from '../services/api';
import './css/DashboardPage.css';

type Level = 'green' | 'yellow' | 'red';
type Indicator = { metric: string; label?: string; value: number; unit: string; ts: string; level: Level | null };
type Dashboard = {
  risk: { r: number; band: string };
  indicators: Indicator[];
  alerts: { id: number; message: string; level: Level; ts: string }[];
  tasks: ApiTask[];
};

const status = { green: 'nominal', yellow: 'caution', red: 'critical' } as const;

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user, xp, streak, reload } = useMission();
  const [data, setData] = useState<Dashboard>();
  const [updated, setUpdated] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const userId = user.user_id;

  useEffect(() => {
    const controller = new AbortController();
    api<Dashboard>(userPath(userId, 'dashboard'), { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setData(result);
        setUpdated(new Date().toISOString());
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, revision]);

  function refresh() {
    setLoading(true);
    setRevision(previous => previous + 1);
    reload();
  }

  const missionStart = Date.parse(user.mission_start ?? '');
  const missionDay = updated && Number.isFinite(missionStart) ? Math.max(1, Math.floor((Date.parse(updated) - missionStart) / 864e5) + 1) : null;
  const completed = data?.tasks.filter(task => task.completed_at).length ?? 0;
  const taskTotal = data?.tasks.length ?? 0;
  const { level, rank } = levelInfo(xp);

  return (
    <VStack gap={8} padding={6} className="page dashboard">
      <PageHeader
        eyebrow={[user.mission_name, missionDay && `Mission day ${missionDay}`].filter(Boolean).join(' · ') || 'Mission control'}
        title={`${greeting()}, ${user.display_name.split(' ')[0]}`}
        description="Your latest readings, assigned tasks, and nutrition logs."
        actions={
          <HStack gap={2} vAlign="center" className="dashboard__sync">
            {updated && <Timestamp value={updated} />}
            <Button label="Refresh" variant="secondary" icon={<Icon icon={ArrowPathIcon} />} onClick={refresh} isLoading={loading} />
          </HStack>
        }
      />
      <EmergencyBanner />
      {loading && !data && <Text role="status">Loading your dashboard…</Text>}
      {failed && <Text role="alert">Dashboard data could not refresh. Use Refresh to try again.</Text>}
      {data && (
        <>
          <Card padding={6} className="dashboard__overview rise-in">
            <Grid columns={{ minWidth: 260, max: 3 }} gap={6}>
              <VStack gap={2} vAlign="center">
                <Text type="label" color="secondary">EVAde risk band</Text>
                {data.indicators.length ? (
                  <>
                    <Heading level={2}>{data.risk.band}</Heading>
                    <Text type="supporting">Across {data.indicators.length} recorded signals</Text>
                  </>
                ) : <Text>Awaiting sensor readings.</Text>}
              </VStack>
              <VStack gap={3} vAlign="center">
                <HStack hAlign="between">
                  <Text type="label">Mission tasks</Text>
                  <Text type="supporting" hasTabularNumbers>{completed} / {taskTotal} done</Text>
                </HStack>
                {!!taskTotal && <ProgressBar label="Mission tasks" isLabelHidden value={completed} max={taskTotal} variant="success" />}
              </VStack>
              <VStack gap={3} vAlign="center" className="dashboard__rank">
                <Text type="label" color="secondary">Crew rank</Text>
                <Heading level={2} className="text-gradient">Lv {level} · {rank}</Heading>
                <Text type="supporting">{xp.toLocaleString()} XP · {streak}-day streak</Text>
                <HStack>
                  <Button label="Mission tasks" variant="primary" href="/tasks" endContent={<Icon icon={ArrowRightIcon} />} />
                </HStack>
              </VStack>
            </Grid>
          </Card>

          <VStack gap={4}>
            <SectionTitle title="Vitals" caption="Latest readings recorded for your account" />
            {data.indicators.length ? (
              <Grid columns={{ minWidth: 200, max: 5 }} gap={3}>
                {data.indicators.map(indicator => (
                  <Card key={indicator.metric} padding={4}>
                    <VStack gap={2}>
                      <Text type="label">{indicator.label ?? indicator.metric}</Text>
                      <Text type="large" hasTabularNumbers>{indicator.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} {indicator.unit}</Text>
                      {indicator.level && <StatusBadge status={status[indicator.level]} />}
                      <Timestamp value={indicator.ts} />
                    </VStack>
                  </Card>
                ))}
              </Grid>
            ) : <Text type="supporting">No readings have been recorded yet.</Text>}
          </VStack>

          <VStack gap={4}>
            <SectionTitle title="Open alerts" />
            {data.alerts.length ? (
              <List hasDividers>
                {data.alerts.map(alert => (
                  <ListItem key={alert.id} label={alert.message}
                    description={<Timestamp value={alert.ts} />}
                    endContent={<StatusBadge status={status[alert.level]} />} />
                ))}
              </List>
            ) : <Text type="supporting">No open alerts.</Text>}
          </VStack>
        </>
      )}
      <NutritionPanel />
    </VStack>
  );
}
