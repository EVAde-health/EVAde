import { useMemo, useState } from 'react';
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
import { useToast } from '@astryxdesign/core/Toast';
import ChartTooltip from '../../components/ChartTooltip';
import SectionTitle from '../../components/SectionTitle';
import StatusBadge from '../../components/StatusBadge';
import { AXIS_TICK, BAR_CURSOR, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from '../../components/chartConfig';
import { useResource } from '../../services/useResource';
import {
  correctObservation, formatValue, levelStatus, setGoals,
  type AstronautDetail, type Correction, type GoalHistoryRow, type GoalType, type GoalTypeInfo, type JournalData,
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
  const charted = series.data?.metrics.filter(metric => metric.points.length) ?? [];
  const reds = latest.filter(item => item.level === 'red');

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
            {charted.map((metric, index) => <MetricChart key={metric.metric} metric={metric} index={index} />)}
          </Grid>
        </>
      )}
      <Readings id={id} />
    </VStack>
  );
}

function MetricChart({ metric, index }: { metric: SeriesMetric; index: number }) {
  const latest = metric.latest;
  return (
    <div className="rise-in" style={{ ['--i' as string]: Math.min(index, 8) }}>
      <Card padding={4}>
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="start">
            <VStack gap={0.5}>
              <Text type="label">{metric.label}</Text>
              <Text type="large" hasTabularNumbers>{latest ? `${formatValue(latest.value, metric.decimals)} ${metric.unit}` : 'No reading'}</Text>
              {latest && <Timestamp value={latest.ts} format="relative" type="supporting" />}
            </VStack>
            {latest?.level && <StatusBadge status={levelStatus(latest.level)} />}
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
        </VStack>
      </Card>
    </div>
  );
}

function SleepChart({ data, error }: { data?: SleepData; error: string | null }) {
  if (error) return <Text role="alert">{error}</Text>;
  if (!data) return <Loading height={300} />;
  if (!data.nights.length) return <EmptyState isCompact title="No sleep recorded" description="Sleep sessions appear after the astronaut logs them." />;
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Text type="label">Sleep stages (target {data.target} h)</Text>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.nights} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip unit="h" />} cursor={BAR_CURSOR} />
            <Legend />
            <ReferenceLine y={data.target} stroke={SERIES.baseline} strokeDasharray="4 4" />
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
  const [metric, setMetric] = useState('heart_rate');
  const readings = useResource<Observation[]>(`/admin/astronauts/${id}/observations?metric=${metric}&days=7`);
  const audit = useResource<Correction[]>(`/admin/astronauts/${id}/corrections`);
  const [editing, setEditing] = useState<Observation | null>(null);
  const reload = () => { readings.reload(); audit.reload(); };
  const label = readings.data?.[0]?.label;

  return (
    <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
      <Card padding={4}>
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
            <SectionTitle title="Recent readings" caption="Last 7 days. Correct a vital only when the recorded value is wrong." />
            <div style={{ minInlineSize: '12rem' }}>
              <Selector label="Vital" isLabelHidden size="sm" value={metric} onChange={value => value && setMetric(value)}
                options={CORRECTABLE.map(value => ({ value, label: value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) }))} />
            </div>
          </HStack>
          {readings.error && <Text role="alert">{readings.error}</Text>}
          {readings.loading && !readings.data && <Loading height={160} />}
          {readings.data && !readings.data.length && <Text type="supporting">No {label ?? 'readings'} in the last 7 days.</Text>}
          <div style={{ maxBlockSize: '24rem', overflowY: 'auto' }}>
            <List hasDividers density="compact">
              {readings.data?.slice(0, 60).map(row => (
                <ListItem
                  key={row.id}
                  label={
                    <HStack gap={2} vAlign="center">
                      <Text weight="semibold" hasTabularNumbers>{formatValue(row.value, row.decimals)} {row.unit}</Text>
                      {row.original_value != null && <Text type="supporting" className="audit-strike">{formatValue(row.original_value, row.decimals)}</Text>}
                      {row.corrections > 0 && <Badge variant="info" label="Corrected" />}
                    </HStack>
                  }
                  description={<Timestamp value={row.ts} format="auto" type="supporting" />}
                  startContent={<StatusBadge status={levelStatus(row.level)} label={row.level ?? 'n/a'} />}
                  endContent={<Button label="Correct" size="sm" variant="ghost" onClick={() => setEditing(row)} />}
                />
              ))}
            </List>
          </div>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3}>
          <SectionTitle title="Correction audit trail" caption="Original value, corrected value, who, when and why." />
          {audit.data && !audit.data.length && <Text type="supporting">No corrections yet.</Text>}
          <List hasDividers density="compact">
            {audit.data?.map(row => (
              <ListItem
                key={row.id}
                label={`${row.label}: ${formatValue(row.original_value)} → ${formatValue(row.corrected_value)} ${row.unit}`}
                description={
                  <VStack gap={0.5}>
                    <Text type="supporting">“{row.reason}”</Text>
                    <Text type="supporting">
                      {row.corrected_by_name ?? 'Unknown'} · <Timestamp value={row.created_at} format="auto" type="supporting" /> · reading from <Timestamp value={row.observed_at} format="date" type="supporting" />
                    </Text>
                  </VStack>
                }
              />
            ))}
          </List>
        </VStack>
      </Card>
      {editing && <CorrectionDialog row={editing} onClose={() => setEditing(null)} onSaved={reload} />}
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
export function JournalSection({ id }: { id: string }) {
  const { data, error, loading } = useResource<JournalData>(`/admin/astronauts/${id}/journal?days=35`);
  const trend = useMemo(() => [...(data?.checkins ?? [])].reverse().map(row => ({
    day: row.ts.slice(0, 10), mood: row.mood, stress: row.stress, sleep: row.sleep_hours,
  })), [data]);
  if (error) return <Text role="alert">{error}</Text>;
  if (loading && !data) return <Loading height={320} />;
  if (!data) return null;
  return (
    <VStack gap={4}>
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
            <SectionTitle title="Check-ins" caption={`${data.checkins.length} in the last 35 days (app and voice).`} />
            {!data.checkins.length && <Text type="supporting">No check-ins yet.</Text>}
            <div style={{ maxBlockSize: '32rem', overflowY: 'auto' }}>
              <List hasDividers density="compact">
                {data.checkins.map(row => (
                  <ListItem
                    key={row.id}
                    align="start"
                    startContent={<StatusBadge status={levelStatus(row.checkin_level)} label={row.source === 'app' ? 'App' : 'Voice'} />}
                    label={[row.mood != null && `Mood ${row.mood}/5`, row.stress != null && `stress ${row.stress}/5`, row.sleep_hours != null && `${row.sleep_hours} h sleep`].filter(Boolean).join(' · ')}
                    description={
                      <VStack gap={1}>
                        {row.note && <Text type="supporting">“{row.note}”</Text>}
                        {!!row.symptoms.length && <HStack gap={1} wrap="wrap">{row.symptoms.map(s => <Badge key={s} variant="warning" label={s} />)}</HStack>}
                        <Timestamp value={row.ts} format="auto" type="supporting" />
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
            <SectionTitle title="Journal" caption="Full entries with the assistant’s summary." />
            {!data.journal.length && <Text type="supporting">No journal entries yet.</Text>}
            <div style={{ maxBlockSize: '32rem', overflowY: 'auto' }}>
              <VStack gap={3}>
                {data.journal.map(entry => (
                  <VStack key={entry.id} gap={1}>
                    <HStack gap={2} wrap="wrap" vAlign="center">
                      <Timestamp value={entry.ts} format="auto" type="label" />
                      {entry.mood_label && <Badge variant="purple" label={entry.mood_label} />}
                      {entry.concern_level && entry.concern_level !== 'none' && (
                        <Badge variant={entry.concern_level === 'high' ? 'error' : entry.concern_level === 'moderate' ? 'warning' : 'neutral'} label={`concern: ${entry.concern_level}`} />
                      )}
                      <Badge variant="neutral" label={entry.source} />
                    </HStack>
                    <Text>{entry.content}</Text>
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
  const done = data.today.filter(task => task.completed_at).length;
  return (
    <VStack gap={4}>
      <Grid columns={{ minWidth: 180, max: 4 }} gap={3}>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Total XP</Text><Text type="large" hasTabularNumbers>{data.points.toLocaleString()}</Text></VStack></Card>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Streak</Text><Text type="large" hasTabularNumbers>{data.streak_days} days</Text></VStack></Card>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Today</Text><Text type="large" hasTabularNumbers>{done} / {data.today.length} tasks</Text></VStack></Card>
        <Card padding={4}><VStack gap={1}><Text type="supporting">Tutorials</Text><Text type="large" hasTabularNumbers>{data.tutorials.length} watched</Text></VStack></Card>
      </Grid>
      <Grid columns={{ minWidth: 340, max: 2 }} gap={4}>
        <Card padding={4}>
          <VStack gap={3}>
            <SectionTitle title={`Today’s task board (${data.day})`} caption="What the astronaut sees on their Missions page." />
            <ProgressBar label="Completed today" value={done} max={data.today.length || 1} hasValueLabel variant="success" />
            <List hasDividers density="compact">
              {data.today.map(task => (
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
                <BarChart data={data.history} margin={CHART_MARGIN}>
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
              {!data.tutorials.length && <Text type="supporting">None yet.</Text>}
              <List density="compact">
                {data.tutorials.map(t => (
                  <ListItem key={t.tutorial_id} label={t.title} description={<Timestamp value={t.completed_at} format="date" type="supporting" />}
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
  const goals = useResource<{ goals: ResolvedGoal[]; history: GoalHistoryRow[]; types: Record<GoalType, GoalTypeInfo> }>(`/admin/astronauts/${id}/goals`);
  const nutrition = useResource<NutritionData>(`/admin/astronauts/${id}/nutrition?days=14`);
  const [draft, setDraft] = useState<Partial<Record<GoalType, number | null>>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  const current = goals.data?.goals ?? [];
  const changes = current
    .filter(goal => draft[goal.goal_type] != null && draft[goal.goal_type] !== goal.target)
    .map(goal => ({ goal_type: goal.goal_type, target: draft[goal.goal_type] as number }));

  async function save() {
    if (!changes.length) return;
    setSaving(true);
    try {
      const result = await setGoals(id, changes, note);
      showToast({ body: result.changed.length ? `${name} will see a note about the new goal${result.changed.length > 1 ? 's' : ''}.` : 'Nothing changed.' });
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
  const types = goals.data.types;

  return (
    <VStack gap={4}>
      <Card padding={4}>
        <VStack gap={4}>
          <SectionTitle title="Daily goals" caption="Each change is saved as a new row (latest wins) and the astronaut gets a note in their app." />
          <Grid columns={{ minWidth: 220, max: 4 }} gap={3}>
            {current.map(goal => {
              const info = types[goal.goal_type];
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
                    {goal.source === 'surgeon' ? `Set by ${goal.set_by_name ?? 'a flight surgeon'}` : goal.source === 'self' ? 'Set by the astronaut'
                      : goal.source === 'settings' ? 'From their settings' : 'Default'}
                    {goal.set_at ? ` · ${new Date(goal.set_at).toLocaleDateString()}` : ''}
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
                <BarChart data={nutrition.data.days} margin={CHART_MARGIN}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={shortDay} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="kcal" tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="ml" orientation="right" tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={BAR_CURSOR} />
                  <Legend />
                  {nutrition.data.goals.kcal && <ReferenceLine yAxisId="kcal" y={nutrition.data.goals.kcal} stroke={SERIES.primary} strokeDasharray="4 4" />}
                  {nutrition.data.goals.water_ml && <ReferenceLine yAxisId="ml" y={nutrition.data.goals.water_ml} stroke={SERIES.tertiary} strokeDasharray="4 4" />}
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
            {!goals.data.history.length && <Text type="supporting">No changes yet; defaults or the astronaut’s settings apply.</Text>}
            <div style={{ maxBlockSize: '20rem', overflowY: 'auto' }}>
              <List hasDividers density="compact">
                {goals.data.history.map(row => (
                  <ListItem
                    key={row.id}
                    label={`${types[row.goal_type]?.label ?? row.goal_type}: ${formatValue(row.target)} ${row.unit}`}
                    description={
                      <VStack gap={0.5}>
                        {row.note && <Text type="supporting">“{row.note}”</Text>}
                        <Text type="supporting">{row.set_by === id ? 'Astronaut' : row.set_by_name ?? 'Unknown'} · {new Date(row.created_at).toLocaleString()}</Text>
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