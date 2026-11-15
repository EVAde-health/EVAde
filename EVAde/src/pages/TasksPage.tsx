import { useSearchParams } from 'react-router-dom';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { CheckCircleIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import HydrationTracker from '../components/HydrationTracker';
import MealLogger from '../components/MealLogger';
import NutritionPanel from '../components/NutritionPanel';
import PageHeader from '../components/PageHeader';
import PanelCard from '../components/PanelCard';
import ScoreRing from '../components/ScoreRing';
import TaskChecklist from '../components/TaskChecklist';
import { levelInfo, useMission } from '../context/MissionContext';
import { type MissionTask } from '../data/tasks';
import { classify } from '../data/status';
import './css/TasksPage.css';

type TaskTab = 'protocols' | 'basic';

// Counts how many of the given tasks are done.
function doneCount(tasks: MissionTask[], completed: string[]) {
  return tasks.filter(t => completed.includes(t.id)).length;
}

// Daily mission board split into health protocols and basics.
export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tasks, completed, xp, streak, loading, loadError, reload } = useMission();
  const protocols = tasks.filter(task => task.kind === 'protocol');
  const basics = tasks.filter(task => task.kind === 'basic');
  const tab: TaskTab = searchParams.get('tab') === 'basic' ? 'basic' : 'protocols';
  const protocolsDone = doneCount(protocols, completed);
  const basicsDone = doneCount(basics, completed);
  const percent = tasks.length ? Math.round(((protocolsDone + basicsDone) / tasks.length) * 100) : 0;
  const { level, rank, toNext } = levelInfo(xp);

  return (
    <VStack gap={6} padding={6} className="page">
      <PageHeader eyebrow="Daily missions" title="Today’s mission board" description="Complete protocols and basics to earn XP, keep your streak and rank up." />

      {loading && <Text role="status">Loading missions and daily logs…</Text>}
      {loadError && <HStack gap={3} vAlign="center"><Text role="alert">Some mission data could not load.</Text><Button label="Retry" size="sm" onClick={reload} /></HStack>}

      <Card padding={5} className="tasks__summary rise-in">
        <HStack gap={6} wrap="wrap" vAlign="center">
          <ScoreRing value={percent} suffix="%" label="Missions complete" caption="complete" tone={classify(percent, [80, 100], [40, 100])} />
          <Grid columns={{ minWidth: 150, max: 4 }} gap={5} className="tasks__stats">
            <VStack gap={0.5}>
              <Text type="supporting">Protocols</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{protocolsDone}/{protocols.length}</Text>
            </VStack>
            <VStack gap={0.5}>
              <Text type="supporting">Basics</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{basicsDone}/{basics.length}</Text>
            </VStack>
            <VStack gap={0.5}>
              <Text type="supporting">Rank</Text>
              <Text type="large" weight="semibold">Lv {level} · {rank}</Text>
              <Text type="supporting" hasTabularNumbers>{toNext} XP to next level</Text>
            </VStack>
            <VStack gap={0.5}>
              <Text type="supporting">Streak</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>🔥 {streak} days</Text>
            </VStack>
          </Grid>
        </HStack>
      </Card>

      {protocols.length > 0 && protocolsDone === protocols.length && (
        <Banner status="success" title="All health protocols complete" description="Flight surgeons have everything they need today. Outstanding work, crew member." />
      )}

      <TabList role="tablist" value={tab} onChange={v => setSearchParams(v === 'basic' ? { tab: 'basic' } : {}, { replace: true })} hasDivider>
        <Tab value="protocols" label="Health protocols" endContent={<Badge variant="purple" label={String(protocols.length - protocolsDone)} />} />
        <Tab value="basic" label="Daily basics" endContent={<Badge variant="blue" label={String(basics.length - basicsDone)} />} />
      </TabList>

      {tab === 'protocols' ? (
        <PanelCard title="Health protocols" subtitle="Measurements that feed your dashboard and flight surgeon" icon={ClipboardDocumentListIcon} key="protocols" className="rise-in">
          {protocols.length ? <TaskChecklist label="Health protocols" tasks={protocols} /> : <Text type="supporting">No protocols assigned.</Text>}
        </PanelCard>
      ) : (
        <Grid columns={{ minWidth: 360, max: 2 }} gap={4} key="basic" className="rise-in">
          <VStack gap={4}>
            <HydrationTracker />
            <PanelCard title="Everyday habits" subtitle="Small wins that keep you human in orbit" icon={CheckCircleIcon}>
              {basics.length ? <TaskChecklist label="Everyday habits" tasks={basics} /> : <Text type="supporting">No basics assigned.</Text>}
            </PanelCard>
          </VStack>
          <VStack gap={4}>
            <NutritionPanel hasLogLink={false} />
            <MealLogger />
          </VStack>
        </Grid>
      )}
    </VStack>
  );
}
