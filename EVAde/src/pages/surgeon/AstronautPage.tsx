import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ChatBubbleLeftRightIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { Icon } from '@astryxdesign/core/Icon';
import AstronautPicker from '../../components/surgeon/AstronautPicker';
import StatusBadge from '../../components/StatusBadge';
import { useSurgeon } from '../../context/SurgeonContext';
import { bandStatus } from '../../services/clinic';
import { ago, formatValue, missionDayOf, personName, responseRows, type AstronautDetail } from '../../services/surgeon';
import { usePoll } from '../../hooks/usePoll';
import { GoalsSection, JournalSection, TasksSection, VitalsSection } from './AstronautSections';

const SECTIONS = [
  { value: 'vitals', label: 'Vitals & metrics' },
  { value: 'journal', label: 'Journal & check-ins' },
  { value: 'tasks', label: 'Tasks & XP' },
  { value: 'goals', label: 'Goals' },
] as const;
type Section = (typeof SECTIONS)[number]['value'];

export default function AstronautPage() {
  const { id, section: rawSection } = useParams();
  const navigate = useNavigate();
  const section: Section = SECTIONS.some(s => s.value === rawSection) ? rawSection as Section : 'vitals';
  const go = (userId: string, next: Section = section) => navigate(`/admin/astronauts/${userId}/${next}`);

  return (
    <VStack gap={5} padding={6} className="surgeon-page">
      <HStack gap={4} wrap="wrap" vAlign="center" className="page-header">
        <StackItem size="fill">
          <VStack gap={1}>
            <Text type="label" color="accent" className="page-header__eyebrow">Astronaut record</Text>
            <Heading level={1} className="page-header__title">{id ? 'Astronaut detail' : 'Choose an astronaut'}</Heading>
          </VStack>
        </StackItem>
        <div style={{ minInlineSize: 'min(26rem, 100%)' }}>
          <AstronautPicker value={id} onChange={userId => go(userId)} />
        </div>
      </HStack>
      {id ? <Record key={id} id={id} section={section} onSection={next => go(id, next)} /> : (
        <EmptyState
          icon={<Icon icon={UserGroupIcon} />}
          title="Pick someone from the list"
          description="Type a name in the drop-down above, or open an astronaut from the crew overview."
          actions={<Button label="Crew overview" href="/admin" variant="secondary" />}
        />
      )}
    </VStack>
  );
}

function Record({ id, section, onSection }: { id: string; section: Section; onSection: (next: Section) => void }) {
  const { notifications } = useSurgeon();
  const { data, error } = usePoll<AstronautDetail>(`/admin/astronauts/${id}`, 20000);
  const emergency = responseRows(notifications?.emergencies).find(item => item.user_id === id);
  if (error) return <Text role="alert">{error}</Text>;
  const user = data?.user;
  const missionDay = missionDayOf(user?.mission_start);
  const latest = responseRows(data?.latest);

  return (
    <VStack gap={5}>
      <Card padding={5} className="rise-in">
        <HStack gap={4} wrap="wrap" vAlign="center">
          <Avatar name={user ? personName(user) : '…'} />
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={2}>{user ? personName(user) : data ? 'Profile unavailable' : 'Loading…'}</Heading>
              <Text type="supporting">
                {[user?.crew_role, user?.display_name, user?.mission_name,
                  missionDay ? `day ${missionDay}${user?.mission_length_days ? ` of ${user.mission_length_days}` : ''}` : null].filter(Boolean).join(' · ')}
              </Text>
            </VStack>
          </StackItem>
          <HStack gap={2} wrap="wrap" vAlign="center">
            {emergency && <Badge variant={emergency.status === 'open' ? 'error' : 'warning'} label={emergency.status === 'open' ? 'Emergency open' : `Emergency · ${emergency.acknowledged_by_name ?? 'handled'}`} />}
            {data?.risk && <StatusBadge status={bandStatus(data.risk.band)} label={`Risk ${data.risk.band}`} />}
            {!!data?.open_alerts && <Badge variant="warning" label={`${data.open_alerts} open alert${data.open_alerts > 1 ? 's' : ''}`} />}
            <Button label="Message" variant="secondary" icon={<Icon icon={ChatBubbleLeftRightIcon} />} href={`/admin/messages/${id}`} />
          </HStack>
        </HStack>
        {data && (
          <Grid columns={{ minWidth: 150, max: 5 }} gap={3}>
            <Stat label="Last check-in" value={ago(data.last_checkin?.ts)} hint={data.last_checkin?.mood != null ? `mood ${data.last_checkin.mood}/5` : undefined} />
            <Stat label="XP" value={formatValue(user?.points, 0)} hint={user?.streak_days != null ? `${user.streak_days}-day streak` : undefined} />
            <Stat label="Last active" value={ago(user?.last_active)} />
            <Stat label="Escalations" value={formatValue(data.escalated_alerts, 0)} />
            <Stat label="Red signals" value={Array.isArray(data.latest) ? String(latest.filter(item => item.level === 'red').length) : '—'} />
          </Grid>
        )}
      </Card>
      <TabList value={section} onChange={value => onSection(value as Section)} hasDivider>
        {SECTIONS.map(item => <Tab key={item.value} value={item.value} label={item.label} />)}
      </TabList>
      <VStack key={section} gap={5} className="rise-in">
        {section === 'vitals' && <VitalsSection id={id} latest={latest} />}
        {section === 'journal' && <JournalSection id={id} />}
        {section === 'tasks' && <TasksSection id={id} />}
        {section === 'goals' && <GoalsSection id={id} name={user ? personName(user) : 'this astronaut'} />}
      </VStack>
    </VStack>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <VStack gap={0.5}>
      <Text type="supporting">{label}</Text>
      <Text type="large" hasTabularNumbers>{value}</Text>
      {hint && <Text type="supporting">{hint}</Text>}
    </VStack>
  );
}
