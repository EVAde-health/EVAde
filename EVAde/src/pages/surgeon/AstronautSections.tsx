import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Dialog } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '../../context/ToastCenterContext';
import ChartTooltip from '../../components/ChartTooltip';
import SectionTitle from '../../components/SectionTitle';
import StatusBadge from '../../components/StatusBadge';
import { useSurgeon } from '../../context/SurgeonContext';
import { AXIS_TICK, BAR_CURSOR, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from '../../components/chartConfig';
import { useResource } from '../../services/useResource';
import { apiBlob } from '../../services/api';
import type { ApiMedia } from '../../services/healthApi';
import MetricModelDialog from '../../components/MetricModelDialog';
import DeepModelResults, { type DeepModelCatalog, type StaffDeepModelResults } from './DeepModelResults';
import {
  correctObservation, formatValue, hasTimestamp, levelStatus, responseRows, setGoals,
  type AstronautDetail, type Correction, type GoalHistoryRow, type GoalType, type GoalTypeInfo, type JournalData, type JournalOverview,
  type NutritionData, type Observation, type ResolvedGoal, type SeriesMetric, type SleepData, type TasksData,
} from '../../services/surgeon';

const GROUPS = [
  { value: 'vitals', label: 'Vitals' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'mind', label: 'Mind' },
  { value: 'radiation', label: 'Radiation' },
  { value: 'bone', label: 'Bone' },
  { value: 'immune', label: 'Immune' },
  { value: 'score', label: 'Score' },
];
const CORRECTABLE = ['heart_rate', 'systolic_bp', 'diastolic_bp', 'spo2', 'respiration_rate', 'body_temp', 'blood_glucose', 'hrv_rmssd'];
const shortDay = (day: string | number) => String(day).slice(5);

function Loading({ height = 220 }: { height?: number }) {
  return <Skeleton height={height} />;
}

// ---------------------------------------------------------------- vitals
export function VitalsSection({ id, latest }: { id: string; latest: AstronautDetail['latest'] }) {
  const [group, setGroup] = useState('vitals');
  const [days, setDays] = useState('30');
  const series = useResource<{ metrics: SeriesMetric[] }>(group === 'sleep' ? null : `/admin/astronauts/${id}/series?group=${group}&days=${days}`);
  const sleep = useResource<SleepData>(group === 'sleep' ? `/admin/astronauts/${id}/sleep?days=${Math.min(Number(days), 30)}` : null);
  const models = useResource<StaffDeepModelResults>(`/admin/astronauts/${encodeURIComponent(id)}/deep-model-results`);
  const catalog = useResource<DeepModelCatalog>(models.data && Object.values(models.data).some(row => !row) ? '/models' : null);
  const charted = responseRows(series.data?.metrics).filter(metric => Array.isArray(metric.points) && metric.points.length);
  const reds = responseRows(latest).filter(item => item.level === 'red');

  return (
    <VStack gap={5}>
      {!!reds.length && (
        <HStack gap={2} wrap="wrap">
          {reds.map(item => <Badge key={item.metric} variant="error" label={`${item.label}: ${formatValue(item.value)} ${item.unit}`} />)}
        </HStack>
      )}
      <HStack gap={3} wrap="wrap" hAlign="between" vAlign="center">
        <SegmentedControl label="Metric group" value={group} onChange={setGroup} size="sm">
          {GROUPS.map(item => <SegmentedControlItem key={item.value} value={item.value} label={item.label} />)}
        </SegmentedControl>
        <SegmentedControl label="Range" value={days} onChange={setDays} size="sm">
          <SegmentedControlItem value="7" label="7 d" />
          <SegmentedControlItem value="30" label="30 d" />
          <SegmentedControlItem value="90" label="90 d" />
        </SegmentedControl>
      </HStack>
      {group === 'sleep' ? <SleepChart data={sleep.data} error={sleep.error} /> : (
        <>
          {series.error && <Text role="alert">{series.error}</Text>}
          {series.loading && !series.data && <Grid columns={{ minWidth: 320, max: 2 }} gap={4}><Loading /><Loading /></Grid>}
          {series.data && !charted.length && <EmptyState isCompact title="No readings in this range" description="Pick a longer range or another group." />}
          <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
            {charted.map((metric, index) => <MetricChart key={metric.metric} metric={metric} index={index} userId={id} />)}
          </Grid>
        </>
      )}
      {models.loading && <Loading height={180} />}
      {models.error && <Text role="alert">Deep model results could not load.</Text>}
      {models.data && <DeepModelResults results={models.data} catalog={catalog.data} />}
      <Readings id={id} />
    </VStack>
  );
}

function MetricChart({ metric, index, userId }: { metric: SeriesMetric; index: number; userId: string }) {
  const latest = metric.latest;
  const [open, setOpen] = useState(false);
  return (
    <div className="rise-in" style={{ ['--i' as string]: Math.min(index, 8) }}>
      <Card padding={4}>
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="start">
            <VStack gap={0.5}>
              <Text type="label">{metric.label}</Text>
              <Text type="large" hasTabularNumbers>{latest ? `${formatValue(latest.value, metric.decimals)} ${metric.unit}` : 'No reading'}</Text>
              {hasTimestamp(latest?.ts) && <Timestamp value={latest.ts} format="relative" type="supporting" />}
            </VStack>
            <VStack gap={1} hAlign="end">
              {latest?.level && <StatusBadge status={levelStatus(latest.level)} />}
              <Button label="Adverse-event chance" size="sm" variant="secondary" onClick={() => setOpen(true)} />
            </VStack>
          </HStack>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={metric.points} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              {metric.green_min != null && metric.green_max != null && (
                <ReferenceArea y1={metric.green_min} y2={metric.green_max} fill="var(--color-data-categorical-green)" fillOpacity={0.08} />
              )}
              <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip unit={metric.unit} />} />
              <Line dataKey="value" name="Daily average" stroke={SERIES.primary} strokeWidth={2} dot={false} animationDuration={700} />
              <Line dataKey="max" name="Max" stroke={SERIES.secondary} strokeOpacity={0.45} strokeWidth={1} dot={false} animationDuration={700} />
            </LineChart>
          </ResponsiveContainer>
          {open && <MetricModelDialog userId={userId} metric={metric.metric} label={metric.label} onClose={() => setOpen(false)} />}
        </VStack>
      </Card>
    </div>
  );
}

function SleepChart({ data, error }: { data?: SleepData; error: string | null }) {
  if (error) return <Text role="alert">{error}</Text>;
  if (!data) return <Loading height={300} />;
  const nights = responseRows(data.nights);
  if (!nights.length) return <EmptyState isCompact title="No sleep recorded" description="Sleep sessions appear after the astronaut logs them." />;
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Text type="label">Sleep stages{Number.isFinite(data.target) ? ` (target ${data.target} h)` : ''}</Text>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={nights} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip unit="h" />} cursor={BAR_CURSOR} />
            <Legend />
            {Number.isFinite(data.target) && <ReferenceLine y={data.target} stroke={SERIES.baseline} strokeDasharray="4 4" />}
            <Bar dataKey="deep" name="Deep" stackId="s" fill={SERIES.quaternary} />
            <Bar dataKey="rem" name="REM" stackId="s" fill={SERIES.primary} />
            <Bar dataKey="light" name="Light" stackId="s" fill={SERIES.tertiary} />
            <Bar dataKey="awake" name="Awake" stackId="s" fill={SERIES.secondary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </VStack>
    </Card>
  );
}

// Recent raw readings with the correction action, plus the audit trail.
function Readings({ id }: { id: string }) {
  const canCorrect = useSurgeon().user.role === 'flight_surgeon';
  const [metric, setMetric] = useState('heart_rate');
  const readings = useResource<Observation[]>(`/admin/astronauts/${id}/observations?metric=${metric}&days=7`);
  const audit = useResource<Correction[]>(`/admin/astronauts/${id}/corrections`);
  const [editing, setEditing] = useState<Observation | null>(null);
  const reload = () => { readings.reload(); audit.reload(); };
  const readingRows = responseRows(readings.data);
  const corrections = responseRows(audit.data);
  const label = readingRows[0]?.label;

  return (
    <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
      <Card padding={4}>
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
            <SectionTitle title="Recent readings" caption={canCorrect ? 'Last 7 days. Correct a vital only when the recorded value is wrong.' : 'Last 7 days.'} />
            <div style={{ minInlineSize: '12rem' }}>
              <Selector label="Vital" isLabelHidden size="sm" value={metric} onChange={value => value && setMetric(value)}
                options={CORRECTABLE.map(value => ({ value, label: value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) }))} />
            </div>
          </HStack>
          {readings.error && <Text role="alert">{readings.error}</Text>}
          {readings.loading && !readings.data && <Loading height={160} />}
          {readings.data && !readingRows.length && <Text type="supporting">No {label ?? 'readings'} in the last 7 days.</Text>}
          <div style={{ maxBlockSize: '24rem', overflowY: 'auto' }}>
            <List hasDividers density="compact">
              {readingRows.slice(0, 60).map(row => (
                <ListItem
                  key={row.id}
                  label={
                    <HStack gap={2} vAlign="center">
                      <Text weight="semibold" hasTabularNumbers>{formatValue(row.value, row.decimals)} {row.unit}</Text>
                      {row.original_value != null && <Text type="supporting" className="audit-strike">{formatValue(row.original_value, row.decimals)}</Text>}
                      {row.corrections > 0 && <Badge variant="info" label="Corrected" />}
                    </HStack>
                  }
                  description={hasTimestamp(row.ts) ? <Timestamp value={row.ts} format="auto" type="supporting" /> : 'Time unavailable'}
                  startContent={row.level ? <StatusBadge status={levelStatus(row.level)} label={row.level} /> : undefined}
                  endContent={canCorrect && audit.data && !audit.error && Number.isInteger(row.id) && Number.isFinite(row.value)
                    ? <Button label="Correct" size="sm" variant="ghost" onClick={() => setEditing(row)} /> : undefined}
                />
              ))}
            </List>
          </div>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3}>
          <SectionTitle title="Correction audit trail" caption="Original value, corrected value, who, when and why." />
          {audit.error && <Text role="alert">Correction history is unavailable.</Text>}
          {audit.data && !corrections.length && <Text type="supporting">No corrections yet.</Text>}
          <List hasDividers density="compact">
            {corrections.map(row => (
              <ListItem
                key={row.id}
                label={`${row.label}: ${formatValue(row.original_value)} → ${formatValue(row.corrected_value)} ${row.unit}`}
                description={
                  <VStack gap={0.5}>
                    <Text type="supporting">“{row.reason}”</Text>
                    <Text type="supporting">
                      {row.corrected_by_name ?? 'Unknown'}{hasTimestamp(row.created_at) && <> · <Timestamp value={row.created_at} format="auto" type="supporting" /></>}
                      {hasTimestamp(row.observed_at) && <> · reading from <Timestamp value={row.observed_at} format="date" type="supporting" /></>}
                    </Text>
                  </VStack>
                }
              />
            ))}
          </List>
        </VStack>
      </Card>
      {canCorrect && editing && <CorrectionDialog row={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </Grid>
  );
}

function CorrectionDialog({ row, onClose, onSaved }: { row: Observation; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<number | null>(row.value);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const valid = value != null && value !== row.value && reason.trim().length >= 3;

  async function save() {
    if (!valid || value == null) return;
    setSaving(true);
    try {
      await correctObservation(row.id, value, reason.trim());
      showToast({ body: `${row.label} corrected and logged.` });
      onSaved();
      onClose();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The correction was not saved.' });
      setSaving(false);
    }
  }

  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} purpose="form" width={460}>
      <VStack gap={4} padding={2}>
        <VStack gap={1}>
          <Heading level={2}>Correct {row.label.toLowerCase()}</Heading>
          <Text color="secondary">
            Recorded {formatValue(row.value, row.decimals)} {row.unit} on {new Date(row.ts).toLocaleString()}. The original value stays in the audit trail.
          </Text>
        </VStack>
        <NumberInput label={`Corrected value (${row.unit})`} value={value} onChange={setValue} min={0} hasAutoFocus />
        <TextArea label="Reason" description="Required. For example: sensor motion artifact, typo, wrong cuff size." value={reason} onChange={setReason} maxLength={300} isRequired />
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="secondary" onClick={onClose} isDisabled={saving} />
          <Button label="Save correction" variant="primary" onClick={save} isLoading={saving} isDisabled={!valid} />
        </HStack>
      </VStack>
    </Dialog>
  );
}

// ---------------------------------------------------------------- journal & check-ins
const MOOD_TREND_BADGE = {
  improving: { variant: 'success', label: 'Mood improving' },
  stable: { variant: 'neutral', label: 'Mood stable' },
  declining: { variant: 'warning', label: 'Mood declining' },
  unclear: { variant: 'neutral', label: 'Mood trend unclear' },
} as const;

// Staff-only AI overview of the astronaut's condition from journal entries and check-ins.
function JournalOverviewCard({ id }: { id: string }) {
  const [runs, setRuns] = useState(0);
  const { data, error, loading } = useResource<JournalOverview>(`/admin/astronauts/${id}/journal/overview?days=14${runs ? `&refresh=1&run=${runs}` : ''}`);
  const overview = data?.overview;
  const trendBadge = overview ? MOOD_TREND_BADGE[overview.mood_trend] : null;

  return (
    <Card padding={5}>
      <VStack gap={3}>
        <SectionTitle
          title="Condition overview"
          caption="From the journal and check-ins over the last 14 days. Visible to staff only; the astronaut never sees it."
          end={data && <Button label={loading ? 'Analyzing…' : 'Re-run'} size="sm" variant="ghost" onClick={() => setRuns(value => value + 1)} isDisabled={loading} />}
        />
        {error && <Text role="alert">{error}</Text>}
        {loading && !data && <Loading height={140} />}
        {data && (
          <HStack gap={2} wrap="wrap" vAlign="center">
            {trendBadge && <Badge variant={trendBadge.variant} label={trendBadge.label} />}
            {data.high_concern > 0 && <StatusBadge status="critical" label={`${data.high_concern} high-concern ${data.high_concern === 1 ? 'entry' : 'entries'}`} />}
            {data.moderate_concern > 0 && <StatusBadge status="caution" label={`${data.moderate_concern} moderate-concern`} />}
            <Text type="supporting">{data.entries} journal {data.entries === 1 ? 'entry' : 'entries'} · {data.checkins} check-ins</Text>
          </HStack>
        )}
        {data && !data.entries && !data.checkins && <Text type="supporting">No journal entries or check-ins in the last 14 days.</Text>}
        {data && (data.entries > 0 || data.checkins > 0) && !overview && (
          <Text type="supporting">The AI overview is unavailable right now; the entries below are still complete.</Text>
        )}
        {overview && (
          <>
            <Text>{overview.overview}</Text>
            <Grid columns={{ minWidth: 260, max: 2 }} gap={4}>
              {!!overview.concerns.length && (
                <VStack gap={1}>
                  <Text type="label">Worth attention</Text>
                  <List density="compact" edge="flush">
                    {overview.concerns.map(item => <ListItem key={item} label={item} />)}
                  </List>
                </VStack>
              )}
              {!!overview.follow_up.length && (
                <VStack gap={1}>
                  <Text type="label">Topics for the next private conference</Text>
                  <List density="compact" edge="flush">
                    {overview.follow_up.map(item => <ListItem key={item} label={item} />)}
                  </List>
                </VStack>
              )}
            </Grid>
            <Text type="supporting">
              AI overview (Grok) · verify against the entries below, not a diagnosis · <Timestamp value={data!.generated_at} />
            </Text>
          </>
        )}
      </VStack>
    </Card>
  );
}

export function JournalSection({ id }: { id: string }) {
  const { data, error, loading } = useResource<JournalData>(`/admin/astronauts/${id}/journal?days=35`);
  const checkins = responseRows(data?.checkins);
  const journal = responseRows(data?.journal);
  const trend = checkins.filter(row => hasTimestamp(row.ts)).reverse().map(row => ({
    day: row.ts.slice(0, 10), mood: row.mood, stress: row.stress, sleep: row.sleep_hours,
  }));
  if (error) return <Text role="alert">{error}</Text>;
  if (loading && !data) return <Loading height={320} />;
  if (!data) return null;
  return (
    <VStack gap={4}>
      <JournalOverviewCard id={id} />
      {!!trend.length && (
        <Card padding={4}>
          <VStack gap={2}>
            <Text type="label">Mood and stress from check-ins (1–5)</Text>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} domain={[1, 5]} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line dataKey="mood" name="Mood" stroke={SERIES.quaternary} strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="stress" name="Stress" stroke={SERIES.secondary} strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </VStack>
        </Card>
      )}
      <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
        <Card padding={4}>
          <VStack gap={3}>
            <SectionTitle title="Check-ins" caption={`${checkins.length} in the last 35 days (app and voice).`} />
            {!checkins.length && <Text type="supporting">No check-ins available.</Text>}
            <div style={{ maxBlockSize: '32rem', overflowY: 'auto' }}>
              <List hasDividers density="compact">
                {checkins.map(row => (
                  <ListItem
                    key={row.id}
                    align="start"
                    startContent={row.checkin_level ? <StatusBadge status={levelStatus(row.checkin_level)} label={row.source === 'app' ? 'App' : row.source ? 'Voice' : 'Source unavailable'} /> : undefined}
                    label={[row.mood != null && `Mood ${row.mood}/5`, row.stress != null && `stress ${row.stress}/5`, row.sleep_hours != null && `${row.sleep_hours} h sleep`].filter(Boolean).join(' · ')}
                    description={
                      <VStack gap={1}>
                        {Array.isArray(row.symptoms) && !!row.symptoms.length && <HStack gap={1} wrap="wrap">{row.symptoms.filter(s => typeof s === 'string').map(s => <Badge key={s} variant="warning" label={s} />)}</HStack>}
                        {hasTimestamp(row.ts) && <Timestamp value={row.ts} format="auto" type="supporting" />}
                      </VStack>
                    }
                  />
                ))}
              </List>
            </div>
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={3}>
            <SectionTitle title="Journal summaries" caption="Mood, concerns and assistant summaries." />
            {!journal.length && <Text type="supporting">No journal summaries available.</Text>}
            <div style={{ maxBlockSize: '32rem', overflowY: 'auto' }}>
              <VStack gap={3}>
                {journal.map((entry, index) => (
                  <VStack key={`${entry.ts}:${entry.source}:${index}`} gap={1}>
                    <HStack gap={2} wrap="wrap" vAlign="center">
                      {hasTimestamp(entry.ts) && <Timestamp value={entry.ts} format="auto" type="label" />}
                      {entry.mood_label && <Badge variant="purple" label={entry.mood_label} />}
                      {entry.concern_level && entry.concern_level !== 'none' && (
                        <Badge variant={entry.concern_level === 'high' ? 'error' : entry.concern_level === 'moderate' ? 'warning' : 'neutral'} label={`concern: ${entry.concern_level}`} />
                      )}
                      {entry.source && <Badge variant="neutral" label={entry.source} />}
                    </HStack>
                    {entry.ai_summary && <Text type="supporting">Summary: {entry.ai_summary}</Text>}
                  </VStack>
                ))}
              </VStack>
            </div>
          </VStack>
        </Card>
      </Grid>
    </VStack>
  );
}

// ---------------------------------------------------------------- tasks & XP
export function TasksSection({ id }: { id: string }) {
  const { data, error, loading } = useResource<TasksData>(`/admin/astronauts/${id}/tasks`);
  if (error) return <Text role="alert">{error}</Text>;
  if (loading && !data) return <Loading height={320} />;
  if (!data) return null;
  const today = responseRows(data.today);
  const tutorials = responseRows(data.tutorials);
  const done = today.filter(task => task.completed_at).length;
  return (
    <VStack gap={4}>
      <Grid columns={{ minWidth: 180, max: 4 }} gap={3}>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Total XP</Text><Text type="large" hasTabularNumbers>{formatValue(data.points, 0)}</Text></VStack></Card>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Streak</Text><Text type="large" hasTabularNumbers>{data.streak_days == null ? '—' : `${data.streak_days} days`}</Text></VStack></Card>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Today</Text><Text type="large" hasTabularNumbers>{done} / {today.length} tasks</Text></VStack></Card>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Tutorials</Text><Text type="large" hasTabularNumbers>{tutorials.length} watched</Text></VStack></Card>
      </Grid>
      <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
        <Card padding={4}>
          <VStack gap={3}>
            <SectionTitle title={data.day ? `Today’s task board (${data.day})` : 'Today’s task board'} caption="What the astronaut sees on their Missions page." />
            <ProgressBar label="Completed today" value={done} max={today.length || 1} hasValueLabel variant="success" />
            <List hasDividers density="compact">
              {today.map(task => (
                <ListItem
                  key={task.id}
                  label={<Text hasStrikethrough={!!task.completed_at}>{task.title}</Text>}
                  description={task.detail ?? undefined}
                  startContent={<Badge variant={task.completed_at ? 'success' : 'neutral'} label={task.completed_at ? 'Done' : 'Open'} />}
                  endContent={<Text type="supporting" hasTabularNumbers>{task.points} XP</Text>}
                />
              ))}
            </List>
          </VStack>
        </Card>
        <VStack gap={4}>
          <Card padding={4}>
            <VStack gap={2}>
              <Text type="label">Last 14 days</Text>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={responseRows(data.history)} margin={CHART_MARGIN}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={BAR_CURSOR} />
                  <Bar dataKey="done" name="Done" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="total" name="Assigned" fill={SERIES.baseline} fillOpacity={0.35} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </VStack>
          </Card>
          <Card padding={4}>
            <VStack gap={2}>
              <SectionTitle title="Tutorials watched" />
              {!tutorials.length && <Text type="supporting">None available.</Text>}
              <List density="compact">
                {tutorials.map(t => (
                  <ListItem key={t.tutorial_id} label={t.title} description={hasTimestamp(t.completed_at) ? <Timestamp value={t.completed_at} format="date" type="supporting" /> : undefined}
                    endContent={<Text type="supporting">+{t.points_awarded} XP</Text>} />
                ))}
              </List>
            </VStack>
          </Card>
        </VStack>
      </Grid>
    </VStack>
  );
}

// ---------------------------------------------------------------- goals
export function GoalsSection({ id, name }: { id: string; name: string }) {
  const goals = useResource<{ goals: ResolvedGoal[]; history: GoalHistoryRow[]; types?: Partial<Record<GoalType, GoalTypeInfo>> }>(`/admin/astronauts/${id}/goals`);
  const nutrition = useResource<NutritionData>(`/admin/astronauts/${id}/nutrition?days=14`);
  const [draft, setDraft] = useState<Partial<Record<GoalType, number | null>>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  const types = goals.data?.types ?? {};
  const current = responseRows(goals.data?.goals).filter(goal => Number.isFinite(goal.target));
  const history = responseRows(goals.data?.history);
  const changes = current.flatMap(goal => {
    const target = draft[goal.goal_type];
    return types[goal.goal_type] && typeof target === 'number' && target !== goal.target ? [{ goal_type: goal.goal_type, target }] : [];
  });

  async function save() {
    if (!changes.length) return;
    setSaving(true);
    try {
      const result = await setGoals(id, changes, note);
      showToast({ body: result.changed?.length === 0 ? 'Nothing changed.' : `Goals saved for ${name}.` });
      setDraft({});
      setNote('');
      goals.reload();
      nutrition.reload();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'Goals were not saved.' });
    } finally {
      setSaving(false);
    }
  }

  if (goals.error) return <Text role="alert">{goals.error}</Text>;
  if (!goals.data) return <Loading height={320} />;

  return (
    <VStack gap={4}>
      <Card padding={4}>
        <VStack gap={4}>
          <SectionTitle title="Daily goals" caption="The most recent saved target for each goal is in force." />
          {!current.length && <Text type="supporting">No daily goals available.</Text>}
          <Grid columns={{ minWidth: 220, max: 4 }} gap={3}>
            {current.map(goal => {
              const info = types[goal.goal_type];
              if (!info) return <Text key={goal.goal_type ?? goal.label} type="supporting">{goal.label ?? 'Goal'} · {formatValue(goal.target)} {goal.unit}</Text>;
              return (
                <VStack key={goal.goal_type} gap={1.5}>
                  <NumberInput
                    label={`${goal.label} (${goal.unit})`}
                    value={draft[goal.goal_type] ?? goal.target}
                    onChange={value => setDraft(previous => ({ ...previous, [goal.goal_type]: value }))}
                    min={info.min}
                    max={info.max}
                    step={goal.goal_type === 'sleep_h' ? 0.5 : goal.goal_type === 'water_ml' ? 100 : 10}
                    hasNumberSteppers
                  />
                  <Text type="supporting">
                    {goal.source === 'surgeon' || goal.source === 'set' ? `Set by ${goal.set_by_name ?? 'a flight surgeon'}` : goal.source === 'self' ? 'Set by the astronaut'
                      : goal.source === 'settings' ? 'From their settings' : 'Default'}
                    {hasTimestamp(goal.set_at) ? ` · ${new Date(goal.set_at).toLocaleDateString()}` : ''}
                  </Text>
                </VStack>
              );
            })}
          </Grid>
          <TextArea label="Note to the astronaut" isOptional value={note} onChange={setNote} maxLength={300}
            placeholder="Why the change, e.g. “Headaches last week, push fluids.”" />
          <HStack gap={2} hAlign="end">
            <Button label="Reset" variant="secondary" onClick={() => { setDraft({}); setNote(''); }} isDisabled={saving || !changes.length} />
            <Button label={changes.length ? `Save ${changes.length} change${changes.length > 1 ? 's' : ''}` : 'Save'} variant="primary"
              onClick={save} isLoading={saving} isDisabled={!changes.length} />
          </HStack>
        </VStack>
      </Card>
      <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
        <Card padding={4}>
          <VStack gap={2}>
            <Text type="label">Intake vs goal, last 14 days</Text>
            {nutrition.data ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={responseRows(nutrition.data.days)} margin={CHART_MARGIN}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="kcal" tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="ml" orientation="right" tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={BAR_CURSOR} />
                  <Legend />
                  {nutrition.data.goals?.kcal && <ReferenceLine yAxisId="kcal" y={nutrition.data.goals.kcal} stroke={SERIES.primary} strokeDasharray="4 4" />}
                  {nutrition.data.goals?.water_ml && <ReferenceLine yAxisId="ml" y={nutrition.data.goals.water_ml} stroke={SERIES.tertiary} strokeDasharray="4 4" />}
                  <Bar yAxisId="kcal" dataKey="kcal" name="kcal" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="ml" dataKey="water_ml" name="water ml" fill={SERIES.tertiary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Loading height={240} />}
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={2}>
            <SectionTitle title="Goal history" caption="Newest first. The first row per goal is in force." />
            {!history.length && <Text type="supporting">No goal changes available.</Text>}
            <div style={{ maxBlockSize: '20rem', overflowY: 'auto' }}>
              <List hasDividers density="compact">
                {history.map(row => (
                  <ListItem
                    key={row.id}
                    label={`${types[row.goal_type]?.label ?? row.goal_type ?? 'Goal'}: ${formatValue(row.target)} ${row.unit ?? ''}`}
                    description={
                      <VStack gap={0.5}>
                        {row.note && <Text type="supporting">“{row.note}”</Text>}
                        <Text type="supporting">{row.set_by === id ? 'Astronaut' : row.set_by_name ?? 'Unknown'}{hasTimestamp(row.created_at) ? ` · ${new Date(row.created_at).toLocaleString()}` : ''}</Text>
                      </VStack>
                    }
                  />
                ))}
              </List>
            </div>
          </VStack>
        </Card>
      </Grid>
      <StackItem />
    </VStack>
  );
}

// Photos the astronaut saved, each with the Workers AI assessment stored beside it.
export function SelfiesSection({ id }: { id: string }) {
  const media = useResource<ApiMedia[]>(`/users/${encodeURIComponent(id)}/media`);
  const photos = (media.data ?? []).filter(item => item.kind === 'photo');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<ApiMedia | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const created: string[] = [];
    const list = (media.data ?? []).filter(item => item.kind === 'photo');
    list.forEach(photo => {
      apiBlob(photo.url, controller.signal).then(blob => {
        const url = URL.createObjectURL(blob);
        created.push(url);
        setUrls(current => ({ ...current, [photo.id]: url }));
      }, () => undefined);
    });
    return () => {
      controller.abort();
      created.forEach(url => URL.revokeObjectURL(url));
    };
  }, [media.data]);

  if (media.loading && !media.data) return <Loading height={180} />;
  if (media.error) return <Text role="alert">{media.error}</Text>;
  if (!photos.length) return <EmptyState isCompact title="No selfies yet" description="When this astronaut saves a selfie, it shows up here with the vision model's assessment." />;

  return (
    <VStack gap={4}>
      <Grid columns={{ minWidth: 220, max: 4 }} gap={3}>
        {photos.map(photo => (
          <Card key={photo.id} padding={3}>
            <VStack gap={2}>
              {urls[photo.id] ? <img src={urls[photo.id]} alt={photo.note || 'Astronaut selfie'} style={{ width: '100%', borderRadius: '8px' }} /> : <Loading height={140} />}
              <Text type="supporting">{new Date(photo.ts).toLocaleString()}</Text>
              <Text type="supporting">{photo.mood_label ? `Mood: ${photo.mood_label}` : 'No mood label'}</Text>
              <Button label="View analysis" size="sm" onClick={() => setOpen(photo)} />
            </VStack>
          </Card>
        ))}
      </Grid>
      {open && (
        <Dialog isOpen onOpenChange={next => { if (!next) setOpen(null); }} purpose="info" width={520}>
          <VStack gap={3} padding={4}>
            <Heading level={3}>Selfie analysis</Heading>
            <Text type="supporting">{open.analysis?.model ?? open.analysis_model ?? 'No model recorded'}</Text>
            {open.analysis?.status === 'ok' ? (
              <VStack gap={2}>
                <Text type="label">{open.analysis.mood} · {open.analysis.confidence != null ? `${Math.round(open.analysis.confidence * 100)}% confidence` : 'confidence not reported'}</Text>
                <Text>{open.analysis.explanation}</Text>
              </VStack>
            ) : (
              <Text>{open.analysis?.reason ?? 'This selfie has no assessment. The vision model was not available, and no mood was invented.'}</Text>
            )}
            <HStack hAlign="end"><Button label="Close" onClick={() => setOpen(null)} /></HStack>
          </VStack>
        </Dialog>
      )}
    </VStack>
  );
}
