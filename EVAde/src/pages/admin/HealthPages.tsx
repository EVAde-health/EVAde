import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { List, ListItem } from '@astryxdesign/core/List';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Badge } from '@astryxdesign/core/Badge';
import ChartTooltip from '../../components/ChartTooltip';
import PageHeader from '../../components/PageHeader';
import { AXIS_TICK, BAR_CURSOR, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from '../../components/chartConfig';
import SectionTitle from '../../components/SectionTitle';
import StatusBadge from '../../components/StatusBadge';
import AstronautFrame from './AstronautFrame';
import { api } from '../../services/api';
import { bandStatus, type ClinicAlert, type SeriesMetric } from '../../services/clinic';
import { useResource } from '../../services/useResource';

interface Detail {
  risk: { band: string; r: number; mdtr: string | null } | null;
  open_alerts: number;
  escalated_alerts: number;
  open_emergencies: number;
  latest: { metric: string; label: string; value: number; unit: string; level: string | null; ts: string; domain: string }[];
}

function Chart({ points, unit }: { points: { day: string; value: number }[]; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
        <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={(day: string) => day.slice(5)} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip unit={unit} />} />
        <Line dataKey="value" name="Daily value" stroke={SERIES.primary} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AstronautOverviewPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useResource<Detail>(`/admin/astronauts/${id}`);
  return (
    <AstronautFrame>
      {loading && !data && <Text role="status">Loading the record…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && (
        <VStack gap={6}>
          <Grid columns={{ minWidth: 180, max: 4 }} gap={3}>
            <Card padding={4}><VStack gap={1}><Text type="label" color="secondary">Risk band</Text><Text type="large">{data.risk?.band ?? 'No score'}</Text></VStack></Card>
            <Card padding={4}><VStack gap={1}><Text type="label" color="secondary">Open alerts</Text><Text type="large" hasTabularNumbers>{data.open_alerts}</Text></VStack></Card>
            <Card padding={4}><VStack gap={1}><Text type="label" color="secondary">Escalations</Text><Text type="large" hasTabularNumbers>{data.escalated_alerts}</Text></VStack></Card>
            <Card padding={4}><VStack gap={1}><Text type="label" color="secondary">Emergencies</Text><Text type="large" hasTabularNumbers>{data.open_emergencies}</Text></VStack></Card>
          </Grid>
          <SectionTitle title="Latest signals" caption="One row per metric, from the observations table." />
          {data.latest.length ? (
            <Grid columns={{ minWidth: 200, max: 4 }} gap={3}>
              {data.latest.map(item => (
                <Card key={item.metric} padding={4}>
                  <VStack gap={2}>
                    <Text type="label">{item.label}</Text>
                    <Text type="large" hasTabularNumbers>{item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} {item.unit}</Text>
                    <StatusBadge status={bandStatus(item.level)} />
                    <Timestamp value={item.ts} />
                  </VStack>
                </Card>
              ))}
            </Grid>
          ) : <Text type="supporting">No observations recorded for this astronaut.</Text>}
        </VStack>
      )}
    </AstronautFrame>
  );
}

export function VitalsPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useResource<{ metrics: SeriesMetric[] }>(`/admin/astronauts/${id}/series?group=vitals&days=30`);
  const [metric, setMetric] = useState('');
  const selected = data?.metrics.find(item => item.metric === (metric || data.metrics[0]?.metric)) ?? data?.metrics[0];
  return (
    <AstronautFrame>
      {loading && !data && <Text role="status">Loading vitals…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && !data.metrics.length && <Text type="supporting">No vital metrics are in the catalog.</Text>}
      {selected && (
        <VStack gap={4}>
          <SegmentedControl label="Vital" value={selected.metric} onChange={setMetric} size="sm">
            {data!.metrics.map(item => <SegmentedControlItem key={item.metric} value={item.metric} label={item.label} />)}
          </SegmentedControl>
          <Card padding={5}>
            <VStack gap={4}>
              <HStack hAlign="between" vAlign="end">
                <VStack gap={1}>
                  <Text type="label">{selected.label}</Text>
                  <Text type="large" hasTabularNumbers>{selected.latest ? `${selected.latest.value} ${selected.unit}` : 'No reading'}</Text>
                </VStack>
                {selected.latest?.level && <StatusBadge status={bandStatus(selected.latest.level)} />}
              </HStack>
              {selected.points.length ? <Chart points={selected.points} unit={selected.unit} /> : <Text type="supporting">No readings in the last 30 days.</Text>}
            </VStack>
          </Card>
        </VStack>
      )}
    </AstronautFrame>
  );
}

export function NutritionAdminPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useResource<{
    days: { day: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; meals: number }[];
    meals: { id: string; ts: string; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number }[];
    goals: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; water_ml: number | null };
  }>(`/admin/astronauts/${id}/nutrition?days=14`);
  const latest = data?.days.at(-1);
  const rows = [
    ['Calories', latest?.kcal ?? 0, data?.goals.kcal, 'kcal'],
    ['Protein', latest?.protein_g ?? 0, data?.goals.protein, 'g'],
    ['Carbs', latest?.carbs_g ?? 0, data?.goals.carbs, 'g'],
    ['Fat', latest?.fat_g ?? 0, data?.goals.fat, 'g'],
    ['Water', latest?.water_ml ?? 0, data?.goals.water_ml, 'mL'],
  ] as const;
  return (
    <AstronautFrame>
      {loading && !data && <Text role="status">Loading nutrition…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && (
        <VStack gap={6}>
          <SectionTitle title={latest ? `Intake on ${latest.day}` : 'Intake'} caption="Totals come from meals and hydration logs." />
          <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
            {rows.map(([label, value, goal, unit]) => (
              <VStack key={label} gap={1}>
                <HStack hAlign="between"><Text type="label">{label}</Text><Text type="supporting" hasTabularNumbers>{Math.round(value)} / {goal ?? '—'} {unit}</Text></HStack>
                {goal ? <ProgressBar label={`${label} against goal`} isLabelHidden value={Math.min(value, goal)} max={goal} variant={value / goal >= 0.6 ? 'success' : 'warning'} /> : null}
              </VStack>
            ))}
          </Grid>
          <SectionTitle title="Logged meals" />
          {data.meals.length ? (
            <List hasDividers>
              {data.meals.map(meal => (
                <ListItem key={meal.id} label={meal.name} description={`${Math.round(meal.grams)} g · ${Math.round(meal.kcal)} kcal`} endContent={<Timestamp value={meal.ts} />} />
              ))}
            </List>
          ) : <Text type="supporting">No meals in this window.</Text>}
        </VStack>
      )}
    </AstronautFrame>
  );
}

export function SleepAdminPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useResource<{ target: number; nights: { day: string; hours: number | null }[] }>(`/admin/astronauts/${id}/sleep?days=14`);
  return (
    <AstronautFrame>
      {loading && !data && <Text role="status">Loading sleep…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && (
        <Card padding={5}>
          <VStack gap={4}>
            <Text type="supporting">Target {data.target} h · nights from sleep observations</Text>
            {data.nights.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.nights} margin={CHART_MARGIN}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={(day: string) => day.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} width={Y_AXIS_WIDTH} axisLine={false} tickLine={false} />
                  <Tooltip cursor={BAR_CURSOR} content={<ChartTooltip unit="h" />} />
                  <ReferenceLine y={data.target} stroke={SERIES.secondary} strokeDasharray="4 4" />
                  <Bar dataKey="hours" name="Sleep" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Text type="supporting">No sleep observations in this window.</Text>}
          </VStack>
        </Card>
      )}
    </AstronautFrame>
  );
}

export function MoodAdminPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useResource<{
    reports: { id: number; ts: string; mood: number | null; stress: number | null; fatigue: number | null; note: string | null }[];
    journal: { id: number; ts: string; mood_label: string | null; concern_level: string | null; sentiment: number | null; ai_summary: string | null; excerpt: string }[];
  }>(`/admin/astronauts/${id}/mood?days=35`);
  return (
    <AstronautFrame>
      {loading && !data && <Text role="status">Loading mood and journal signals…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && (
        <VStack gap={6}>
          <SectionTitle title="Check-ins" caption="Mood, stress, and fatigue from self reports. 1 is low, 5 is high." />
          {data.reports.length ? (
            <List hasDividers>
              {data.reports.map(report => (
                <ListItem
                  key={report.id}
                  label={`Mood ${report.mood ?? '—'} · Stress ${report.stress ?? '—'} · Fatigue ${report.fatigue ?? '—'}`}
                  description={report.note || 'No note'}
                  endContent={<Timestamp value={report.ts} />}
                />
              ))}
            </List>
          ) : <Text type="supporting">No check-ins in this window.</Text>}
          <SectionTitle title="Journal signals" caption="Summaries and concern level. The excerpt is the start of the entry." />
          {data.journal.length ? (
            <List hasDividers>
              {data.journal.map(entry => (
                <ListItem
                  key={entry.id}
                  label={entry.ai_summary || entry.excerpt}
                  description={entry.excerpt}
                  endContent={
                    <HStack gap={2} vAlign="center">
                      {entry.concern_level && entry.concern_level !== 'none' && <Badge variant={entry.concern_level === 'high' ? 'error' : 'warning'} label={entry.concern_level} />}
                      <Timestamp value={entry.ts} />
                    </HStack>
                  }
                />
              ))}
            </List>
          ) : <Text type="supporting">No journal entries.</Text>}
        </VStack>
      )}
    </AstronautFrame>
  );
}

export function AstronautAlertsPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useResource<ClinicAlert[]>(`/admin/astronauts/${id}/alerts`);
  return (
    <AstronautFrame>
      <AlertList alerts={data} error={error} loading={loading} onChange={reload} />
    </AstronautFrame>
  );
}

export function AlertHistoryPage() {
  const { data, error, loading, reload } = useResource<ClinicAlert[]>('/admin/alerts?limit=80');
  return (
    <VStack gap={6} padding={6}>
      <PageHeader eyebrow="Flight surgeon console" title="Alert history" description="Yellow and red signals across the crew, newest first." />
      <AlertList alerts={data} error={error} loading={loading} onChange={reload} showName />
    </VStack>
  );
}

function AlertList({ alerts, error, loading, onChange, showName = false }: {
  alerts?: ClinicAlert[]; error: string | null; loading: boolean; onChange: () => void; showName?: boolean;
}) {
  async function acknowledge(id: number) {
    await api(`/alerts/${id}/ack`, { method: 'POST', body: {} });
    onChange();
  }
  return (
    <VStack gap={3}>
      {loading && !alerts && <Text role="status">Loading alerts…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {alerts && !alerts.length && <Text type="supporting">No alerts in this view.</Text>}
      {alerts && !!alerts.length && (
        <List hasDividers>
          {alerts.map(alert => (
            <ListItem
              key={alert.id}
              label={showName ? `${alert.display_name}: ${alert.message}` : alert.message}
              description={alert.action || alert.metric || 'Alert'}
              endContent={
                <HStack gap={2} vAlign="center">
                  <StatusBadge status={bandStatus(alert.level)} />
                  {alert.acknowledged ? <Text type="supporting">Acknowledged</Text> : <Button label="Acknowledge" size="sm" variant="secondary" onClick={() => acknowledge(alert.id)} />}
                  <Timestamp value={alert.ts} />
                </HStack>
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}
