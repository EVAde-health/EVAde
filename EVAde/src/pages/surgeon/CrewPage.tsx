import { useMemo, useState, type CSSProperties } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import CrewGridSkeleton from '../../components/surgeon/CrewCardSkeleton';
import StatusBadge from '../../components/StatusBadge';
import { usePoll } from '../../hooks/usePoll';
import { ago, personName, responseRows, splitIssue, type CrewRow, type CrewStatus } from '../../services/surgeon';
import { hasSimulatedData } from '../../services/simulation';

type Filter = 'all' | 'attention' | 'unread';
const STATUS_ORDER = { critical: 0, caution: 1, nominal: 2 } as const;

function crewStatus(row: CrewRow): CrewStatus | null {
  if (row.status === 'critical' || row.status === 'caution' || row.status === 'nominal') return row.status;
  if (row.emergency?.status === 'open' || (row.red_alerts ?? 0) > 0 || (row.red_indicators ?? 0) > 0 || ['high', 'critical', 'red'].includes(row.last_band ?? '')) return 'critical';
  if (row.emergency || row.open_alerts > 0 || ['guarded', 'elevated', 'moderate', 'yellow'].includes(row.last_band ?? '')) return 'caution';
  return row.last_band === 'nominal' || row.last_band === 'green' ? 'nominal' : null;
}

export default function CrewPage() {
  const { data, error, loading } = usePoll<CrewRow[]>('/admin/crew', 15000);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const crew = useMemo(() => responseRows(data)
    .filter(row => typeof row.user_id === 'string' && typeof row.display_name === 'string')
    .map(row => ({ row, status: crewStatus(row) })), [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return crew
      .filter(({ row }) => !q || [row.display_name, row.full_name, row.crew_role].some(v => typeof v === 'string' && v.toLowerCase().includes(q)))
      .filter(({ row, status }) => filter === 'all' || (filter === 'unread' ? (row.unread_messages ?? 0) > 0 : status === 'critical' || status === 'caution'))
      .sort((a, b) => Number(!!b.row.emergency) - Number(!!a.row.emergency) ||
        (a.status ? STATUS_ORDER[a.status] : 3) - (b.status ? STATUS_ORDER[b.status] : 3)
        || personName(a.row).localeCompare(personName(b.row)));
  }, [crew, query, filter]);

  const counts = useMemo(() => ({
    attention: crew.filter(({ status }) => status === 'critical' || status === 'caution').length,
    unread: crew.filter(({ row }) => (row.unread_messages ?? 0) > 0).length,
  }), [crew]);

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
          <SegmentedControlItem value="all" label={`All${data ? ` (${crew.length})` : ''}`} />
          <SegmentedControlItem value="attention" label={`Needs attention (${counts.attention})`} />
          <SegmentedControlItem value="unread" label={`Unread (${counts.unread})`} />
        </SegmentedControl>
      </HStack>
      {error && <Text role="alert">{error}</Text>}
      {loading && !data && (
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" className="crew-sync">
            <StatusDot variant="accent" label="Syncing" isPulsing />
            <Text type="supporting">Syncing crew telemetry…</Text>
          </HStack>
          <CrewGridSkeleton />
        </VStack>
      )}
      {data && !crew.length && <EmptyState title="No crew records available" description="Astronauts appear here after their first sign-in." />}
      {!!crew.length && !rows.length && <EmptyState title="Nobody matches" description="Try another name or clear the filter." isCompact />}
      <Grid columns={{ minWidth: 300, max: 4 }} gap={4}>
        {rows.map(({ row, status }, index) => <CrewCard key={row.user_id} row={row} status={status} index={index} />)}
      </Grid>
    </VStack>
  );
}

function CrewCard({ row, status, index }: { row: CrewRow; status: CrewStatus | null; index: number }) {
  const vitals = row.vitals ?? {};
  const bp = vitals.systolic_bp && vitals.diastolic_bp && Number.isFinite(vitals.systolic_bp.value) && Number.isFinite(vitals.diastolic_bp.value)
    ? { value: `${Math.round(vitals.systolic_bp.value)}/${Math.round(vitals.diastolic_bp.value)}`, level: worst(vitals.systolic_bp.level, vitals.diastolic_bp.level) }
    : null;
  const tiles = [
    { label: 'HR', value: vitals.heart_rate && Number.isFinite(vitals.heart_rate.value) ? `${Math.round(vitals.heart_rate.value)}` : '—', unit: 'bpm', level: vitals.heart_rate?.level },
    { label: 'BP', value: bp?.value ?? '—', unit: 'mmHg', level: bp?.level },
    { label: 'SpO₂', value: vitals.spo2 && Number.isFinite(vitals.spo2.value) ? `${Math.round(vitals.spo2.value)}` : '—', unit: '%', level: vitals.spo2?.level },
  ];
  const bars = [
    { label: 'Calories', item: row.progress?.calories, variant: 'accent' },
    { label: 'Water', item: row.progress?.water_ml, variant: 'success' },
    { label: 'Tasks', item: row.progress?.tasks, variant: 'neutral' },
  ] as const;
  const redAlerts = row.red_alerts ?? 0;
  const unread = row.unread_messages ?? 0;
  const issue = row.critical_issue ?? (row.emergency?.message ? { message: row.emergency.message, ts: row.emergency.created_at, kind: 'emergency' as const } : null);
  const issueText = issue ? splitIssue(issue.message) : null;
  const percent = typeof row.goal_progress === 'number' && Number.isFinite(row.goal_progress) ? row.goal_progress : null;
  return (
    <div className={`crew-card hover-lift${status === 'critical' ? ' crew-card--critical' : ''}`} style={{ '--i': index } as CSSProperties}>
      <Link to={`/admin/astronauts/${encodeURIComponent(row.user_id)}/vitals`} aria-label={`Open ${personName(row)}`}>
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
              <div className="goal-ring" style={{ '--p': percent ?? 0 } as CSSProperties} title="Today’s goal progress">
                {percent == null ? '—' : `${percent}%`}
              </div>
            </HStack>
            <HStack gap={1.5} wrap="wrap">
              {hasSimulatedData(row) && <Badge variant="purple" label="Simulated data" />}
              {row.emergency
                ? <Badge variant={row.emergency.status === 'open' ? 'error' : 'warning'}
                    label={row.emergency.status === 'open' ? 'Emergency open' : `Handled by ${row.emergency.acknowledged_by_name ?? 'surgeon'}`} />
                : status ? <StatusBadge status={status} /> : <Text type="supporting">Status unavailable</Text>}
              {redAlerts > 0 && <Badge variant="error" label={`${redAlerts} red alert${redAlerts > 1 ? 's' : ''}`} />}
              {unread > 0 && <Badge variant="purple" label={`${unread} unread`} />}
            </HStack>
            {issue && (
              <HStack gap={2} vAlign="start" className="crew-issue" data-kind={issue.kind} role="note">
                <Icon icon={ExclamationTriangleIcon} size="sm" />
                <StackItem size="fill">
                  <VStack gap={0.5}>
                    <Text weight="semibold" maxLines={3}>{issueText?.text}</Text>
                    <Text type="supporting">
                      {[issue.kind === 'emergency' ? 'Emergency' : 'Red alert', issueText?.source, ago(issue.ts)].filter(Boolean).join(' · ')}
                    </Text>
                  </VStack>
                </StackItem>
              </HStack>
            )}
            <div className="crew-vitals">
              {tiles.map(tile => (
                <div key={tile.label} className="crew-vital" data-level={tile.level ?? undefined}>
                  <Text type="supporting">{tile.label}</Text>
                  <Text weight="semibold" hasTabularNumbers>{tile.value} <Text type="supporting" as="span">{tile.unit}</Text></Text>
                </div>
              ))}
            </div>
            <VStack gap={1.5}>
              {bars.map(({ label, item, variant }) => item && Number.isFinite(item.value) && Number.isFinite(item.target)
                ? <ProgressBar key={label} label={`${label} ${item.value} / ${item.target}${variant === 'neutral' || !item.unit ? '' : ` ${item.unit}`}`} value={item.value} max={item.target || 1} variant={variant} />
                : <Text key={label} type="supporting">{label} unavailable</Text>)}
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
