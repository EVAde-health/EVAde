import { useMemo, useState, type CSSProperties } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { usePoll } from '../../hooks/usePoll';
import { ago, personName, type CrewRow } from '../../services/surgeon';

type Filter = 'all' | 'attention' | 'unread';
const STATUS_ORDER = { critical: 0, caution: 1, nominal: 2 } as const;

export default function CrewPage() {
  const { data, error, loading } = usePoll<CrewRow[]>('/admin/crew', 15000);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter(row => !q || [row.display_name, row.full_name, row.crew_role].some(v => v?.toLowerCase().includes(q)))
      .filter(row => filter === 'all' || (filter === 'unread' ? row.unread_messages > 0 : row.status !== 'nominal' || !!row.emergency))
      .sort((a, b) => Number(!!b.emergency) - Number(!!a.emergency) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || personName(a).localeCompare(personName(b)));
  }, [data, query, filter]);

  const counts = useMemo(() => ({
    attention: (data ?? []).filter(row => row.status !== 'nominal' || row.emergency).length,
    unread: (data ?? []).filter(row => row.unread_messages > 0).length,
  }), [data]);

  return (
    <VStack gap={5} padding={6} className="surgeon-page">
      <PageHeader
        eyebrow="Flight surgeon console"
        title="Crew overview"
        description="Today’s goal progress, latest vitals, last check-in and emergencies for every astronaut. Refreshes on its own."
      />
      <HStack gap={3} wrap="wrap" vAlign="end">
        <StackItem size="fill">
          <TextInput label="Find an astronaut" isLabelHidden placeholder="Search by name or role" startIcon={MagnifyingGlassIcon}
            value={query} onChange={setQuery} hasClear />
        </StackItem>
        <SegmentedControl label="Filter crew" value={filter} onChange={value => setFilter(value as Filter)} size="sm">
          <SegmentedControlItem value="all" label={`All${data ? ` (${data.length})` : ''}`} />
          <SegmentedControlItem value="attention" label={`Needs attention (${counts.attention})`} />
          <SegmentedControlItem value="unread" label={`Unread (${counts.unread})`} />
        </SegmentedControl>
      </HStack>
      {error && <Text role="alert">{error}</Text>}
      {loading && !data && (
        <Grid columns={{ minWidth: 300, max: 4 }} gap={4}>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={260} />)}
        </Grid>
      )}
      {data && !data.length && <EmptyState title="No astronauts yet" description="Astronauts appear here after their first sign-in." />}
      {data && !!data.length && !rows.length && <EmptyState title="Nobody matches" description="Try another name or clear the filter." isCompact />}
      <Grid columns={{ minWidth: 300, max: 4 }} gap={4}>
        {rows.map((row, index) => <CrewCard key={row.user_id} row={row} index={index} />)}
      </Grid>
    </VStack>
  );
}

function CrewCard({ row, index }: { row: CrewRow; index: number }) {
  const { vitals, progress } = row;
  const bp = vitals.systolic_bp && vitals.diastolic_bp
    ? { value: `${Math.round(vitals.systolic_bp.value)}/${Math.round(vitals.diastolic_bp.value)}`, level: worst(vitals.systolic_bp.level, vitals.diastolic_bp.level) }
    : null;
  const tiles = [
    { label: 'HR', value: vitals.heart_rate ? `${Math.round(vitals.heart_rate.value)}` : '—', unit: 'bpm', level: vitals.heart_rate?.level },
    { label: 'BP', value: bp?.value ?? '—', unit: 'mmHg', level: bp?.level },
    { label: 'SpO₂', value: vitals.spo2 ? `${Math.round(vitals.spo2.value)}` : '—', unit: '%', level: vitals.spo2?.level },
  ];
  return (
    <div className={`crew-card hover-lift${row.status === 'critical' ? ' crew-card--critical' : ''}`} style={{ '--i': index } as CSSProperties}>
      <Link to={`/admin/astronauts/${row.user_id}/vitals`} aria-label={`Open ${personName(row)}`}>
        <Card padding={4} height="100%">
          <VStack gap={3}>
            <HStack gap={3} vAlign="center">
              <Avatar name={personName(row)} />
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Text weight="semibold" maxLines={1}>{personName(row)}</Text>
                  <Text type="supporting" maxLines={1}>{row.crew_role ?? 'Astronaut'} · {row.display_name}</Text>
                </VStack>
              </StackItem>
              <div className="goal-ring" style={{ '--p': row.goal_progress ?? 0 } as CSSProperties} title="Today’s goal progress">
                {row.goal_progress ?? '—'}%
              </div>
            </HStack>
            <HStack gap={1.5} wrap="wrap">
              {row.emergency
                ? <Badge variant={row.emergency.status === 'open' ? 'error' : 'warning'}
                    label={row.emergency.status === 'open' ? 'Emergency open' : `Handled by ${row.emergency.acknowledged_by_name ?? 'surgeon'}`} />
                : <StatusBadge status={row.status} />}
              {row.red_alerts > 0 && <Badge variant="error" label={`${row.red_alerts} red alert${row.red_alerts > 1 ? 's' : ''}`} />}
              {row.unread_messages > 0 && <Badge variant="purple" label={`${row.unread_messages} unread`} />}
            </HStack>
            <div className="crew-vitals">
              {tiles.map(tile => (
                <div key={tile.label} className="crew-vital" data-level={tile.level ?? undefined}>
                  <Text type="supporting">{tile.label}</Text>
                  <Text weight="semibold" hasTabularNumbers>{tile.value} <Text type="supporting" as="span">{tile.unit}</Text></Text>
                </div>
              ))}
            </div>
            <VStack gap={1.5}>
              <ProgressBar label={`Calories ${progress.calories.value} / ${progress.calories.target} kcal`} value={progress.calories.value} max={progress.calories.target || 1} variant="accent" />
              <ProgressBar label={`Water ${progress.water_ml.value} / ${progress.water_ml.target} ml`} value={progress.water_ml.value} max={progress.water_ml.target || 1} variant="success" />
              <ProgressBar label={`Tasks ${progress.tasks.value} / ${progress.tasks.target}`} value={progress.tasks.value} max={progress.tasks.target || 1} variant="neutral" />
            </VStack>
            <Text type="supporting">
              Check-in {ago(row.last_checkin?.ts)}{row.last_checkin?.mood != null ? ` · mood ${row.last_checkin.mood}/5` : ''} · vitals {ago(vitals.heart_rate?.ts)}
            </Text>
          </VStack>
        </Card>
      </Link>
    </div>
  );
}

function worst(a: string | null | undefined, b: string | null | undefined) {
  if (a === 'red' || b === 'red') return 'red';
  if (a === 'yellow' || b === 'yellow') return 'yellow';
  return a ?? b ?? null;
}
