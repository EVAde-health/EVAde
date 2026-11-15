import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import PageHeader from '../../components/PageHeader';
import { useResource } from '../../services/useResource';

interface HeaderUser {
  display_name: string;
  full_name: string | null;
  crew_role: string | null;
  mission_name: string | null;
}

const TABS = [
  ['', 'Overview'],
  ['/goals', 'Goals'],
  ['/vitals', 'Vitals'],
  ['/nutrition', 'Nutrition'],
  ['/sleep', 'Sleep'],
  ['/mood', 'Mood'],
  ['/alerts', 'Alerts'],
] as const;

export default function AstronautFrame({ children }: { children: ReactNode }) {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const { data, error, loading } = useResource<{ user: HeaderUser }>(id ? `/admin/astronauts/${id}` : null);
  const base = `/admin/astronauts/${id}`;
  const person = data?.user;

  return (
    <VStack gap={6} padding={6}>
      <PageHeader
        eyebrow={[person?.mission_name, person?.crew_role].filter(Boolean).join(' · ') || 'Astronaut'}
        title={person ? (person.full_name ? `${person.full_name}` : person.display_name) : 'Astronaut'}
        description={person?.full_name ? `Call sign ${person.display_name}` : 'Record from the crew database.'}
        actions={<Button label="All crew" variant="secondary" href="/admin" />}
      />
      <HStack gap={1} wrap="wrap">
        {TABS.map(([suffix, label]) => {
          const href = `${base}${suffix}`;
          return <Button key={suffix || 'overview'} label={label} size="sm" href={href} variant={pathname === href ? 'primary' : 'ghost'} />;
        })}
      </HStack>
      {loading && !data && <Text role="status">Loading this astronaut…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {children}
    </VStack>
  );
}
