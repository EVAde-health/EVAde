import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { bandStatus, type CrewMember } from '../../services/clinic';
import { useResource } from '../../services/useResource';

export default function CrewPage() {
  const { data, error, loading } = useResource<CrewMember[]>('/admin/crew');
  return (
    <VStack gap={6} padding={6}>
      <PageHeader
        eyebrow="Flight surgeon console"
        title="Crew"
        description="Every astronaut in the database, with open emergencies, alerts, and the latest signals."
      />
      {loading && !data && <Text role="status">Loading the crew…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && !data.length && <EmptyState title="No astronauts yet" description="Accounts appear here after a crew member signs in through Cloudflare Access." />}
      {data && !!data.length && (
        <List hasDividers>
          {data.map(member => {
            const status = member.open_emergencies > 0 || member.red_indicators > 0 ? 'critical' : member.open_alerts > 0 ? 'caution' : bandStatus(member.last_band);
            const label = member.open_emergencies > 0 ? 'Open emergency' : member.red_indicators > 0
              ? 'Red indicator' : member.open_alerts > 0 ? 'Open alert' : member.last_band;
            return (
              <ListItem
                key={member.user_id}
                href={`/admin/astronauts/${member.user_id}`}
                startContent={<Avatar name={member.full_name || member.display_name} size="md" />}
                label={member.display_name}
                description={
                  <VStack gap={0.5}>
                    <Text type="supporting">{member.full_name || member.crew_role || 'Astronaut'}</Text>
                    <HStack gap={2} wrap="wrap">
                      <Text type="supporting" hasTabularNumbers>HR {member.heart_rate ?? '—'}</Text>
                      <Text type="supporting" hasTabularNumbers>Sleep {member.sleep_hours ?? '—'} h</Text>
                      <Text type="supporting" hasTabularNumbers>Mood {member.mood ?? '—'}</Text>
                      {member.last_active && <Timestamp value={member.last_active} />}
                    </HStack>
                  </VStack>
                }
                endContent={
                  <HStack gap={2} wrap="wrap">
                    {label
                      ? <StatusBadge status={status} label={label} />
                      : <Text type="supporting">Awaiting readings</Text>}
                    {member.open_emergencies > 0 && <Badge variant="error" label={`${member.open_emergencies} emergency`} />}
                    {member.open_alerts > 0 && <Badge variant="warning" label={`${member.open_alerts} alerts`} />}
                  </HStack>
                }
              />
            );
          })}
        </List>
      )}
    </VStack>
  );
}
