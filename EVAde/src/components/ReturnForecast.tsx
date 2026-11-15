import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { ArrowPathIcon, ArrowTrendingDownIcon, ArrowTrendingUpIcon, MinusIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';
import { LEVEL_STATUS } from '../data/metrics';
import type { HealthStatus } from '../data/status';
import { userPath } from '../services/api';
import { fetchPrediction, type MetricTrend, type ReturnPrediction } from '../services/healthApi';
import { useResource } from '../services/useResource';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import StatusBadge from './StatusBadge';

const COLLAPSED_TRENDS = 6;
const DIRECTION_ICONS = { rising: ArrowTrendingUpIcon, falling: ArrowTrendingDownIcon, steady: MinusIcon };
const SOURCE_LABELS: Record<ReturnPrediction['source'], string> = {
  ai: 'Trend math in the EVAde Worker · explained by Grok (xAI)',
  'model-api': 'EVAde custom model',
  rules: 'Trend math in the EVAde Worker',
};

// Status of the return window: under two weeks is critical, under ~6 weeks caution.
function windowStatus(days: number | null): HealthStatus | undefined {
  if (days === null) return undefined;
  if (days <= 14) return 'critical';
  return days <= 45 ? 'caution' : 'nominal';
}

// Readable name for what drives the return window.
function driverText(forecast: ReturnPrediction['return']) {
  if (forecast.driver === 'risk') return 'overall risk score';
  if (forecast.driver === 'radiation_limit') return 'radiation career limit';
  return forecast.driver_label?.toLowerCase() ?? 'combined trends';
}

// Rate of change per week, trimmed to a readable precision.
function rateText(trend: MetricTrend) {
  if (trend.slope_per_week === null || trend.direction === null) return 'Not enough days for a trend';
  if (trend.direction === 'steady') return 'Holding steady';
  const rate = Math.abs(trend.slope_per_week);
  return `${trend.direction === 'rising' ? 'Rising' : 'Falling'} ${rate < 1 ? rate.toPrecision(2) : rate.toFixed(1)} ${trend.unit}/week`;
}

// When the metric is projected to cross into red, as a short label.
function limitText(trend: MetricTrend) {
  if (trend.days_to_limit === 0) return 'Past red limit';
  if (trend.days_to_limit === null) return trend.worsening ? 'No limit within a year' : 'Not heading to a limit';
  return `Red limit in ~${Math.round(trend.days_to_limit)} d`;
}

// Return-to-Earth forecast: days until return, most concerning metric and per-metric trends.
export default function ReturnForecast({ userId }: { userId: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState<ReturnPrediction>();
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: loaded, error, loading, reload } = useResource<ReturnPrediction>(userPath(userId, 'prediction'));

  // A newly logged reading changes the trends, so drop any re-run result and fetch again.
  useEffect(() => {
    const onLogged = () => { setFresh(undefined); reload(); };
    window.addEventListener('evade:reading-logged', onLogged);
    return () => window.removeEventListener('evade:reading-logged', onLogged);
  }, [reload]);
  const data = fresh ?? loaded;
  const forecast = data?.return;
  const status = windowStatus(forecast?.days ?? null);
  const trends = data?.trends ?? [];
  const shownTrends = isExpanded ? trends : trends.slice(0, COLLAPSED_TRENDS);
  const range = forecast?.interval_days;

  // Recomputes the forecast, skipping the server cache.
  async function refresh() {
    setRefreshing(true);
    try {
      setFresh(await fetchPrediction(userId, true));
    } catch {
      reload();
    } finally {
      setRefreshing(false);
    }
  }

  const actions = data ? (
    <Button label={refreshing ? 'Analyzing…' : 'Re-run analysis'} size="sm" variant="ghost" icon={<Icon icon={ArrowPathIcon} />} onClick={refresh} isDisabled={refreshing} />
  ) : undefined;

  return (
    <PanelCard title="Return forecast" subtitle={`Trend analysis of the last ${data?.window_days ?? 30} days · projection, not a diagnosis`} icon={RocketLaunchIcon} status={status} actions={actions}>
      {error && !data && (
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Text role="alert">The forecast could not be loaded.</Text>
          <Button label="Try again" size="sm" onClick={reload} />
        </HStack>
      )}
      {loading && !data && <Skeleton height={220} />}
      {data && forecast?.status !== 'ok' && (
        <NoReadings what="The return forecast" hint="The forecast appears once a few days of readings have synced." />
      )}
      {data && forecast?.status === 'ok' && (
        <VStack gap={5}>
          <Grid columns={{ minWidth: 220, max: 3 }} gap={5}>
            <VStack gap={1}>
              <Text type="label" color="secondary">Recommended return within</Text>
              <Text type="display-3" hasTabularNumbers>{forecast.display}</Text>
              <Text type="supporting">
                Driven by {driverText(forecast)}
                {range ? ` · likely ${Math.round(range.low)}–${range.high !== null ? Math.round(range.high) : '100+'} days` : ''}
              </Text>
              {forecast.provisional && <HStack><Badge variant="neutral" label="Provisional: limited data" /></HStack>}
            </VStack>
            {data.most_concerning && (
              <VStack gap={1}>
                <Text type="label" color="secondary">Most concerning metric</Text>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Heading level={3}>{data.most_concerning.label}</Heading>
                  <StatusBadge status={LEVEL_STATUS[data.most_concerning.level]} />
                </HStack>
                <Text type="supporting">{data.most_concerning.reason}</Text>
              </VStack>
            )}
            {forecast.scheduled_days_left !== null && (
              <VStack gap={1}>
                <Text type="label" color="secondary">Planned mission end</Text>
                <Text type="large" weight="semibold" hasTabularNumbers>{forecast.scheduled_days_left} days</Text>
                <Text type="supporting">
                  {forecast.days !== null && forecast.days < forecast.scheduled_days_left
                    ? 'The forecast is earlier than the planned end.'
                    : 'The forecast does not cut the mission short.'}
                </Text>
              </VStack>
            )}
          </Grid>

          <VStack gap={1}>
            <Text weight="semibold">{data.headline}</Text>
            <Text>{data.explanation}</Text>
          </VStack>

          <VStack gap={2}>
            <Text type="label" color="secondary">Trends, most concerning first</Text>
            <List hasDividers density="compact" edge="flush">
              {shownTrends.map(trend => (
                <ListItem
                  key={trend.metric}
                  startContent={<Icon icon={DIRECTION_ICONS[trend.direction ?? 'steady']} size="sm" color={trend.worsening ? 'primary' : 'secondary'} />}
                  label={trend.label}
                  description={`${rateText(trend)} · latest ${trend.latest} ${trend.unit}${trend.confidence ? ` · ${trend.confidence} confidence` : ''}`}
                  endContent={
                    <HStack gap={2} vAlign="center">
                      <Text type="supporting" hasTabularNumbers>{limitText(trend)}</Text>
                      <StatusBadge status={LEVEL_STATUS[trend.level]} />
                    </HStack>
                  }
                />
              ))}
            </List>
            {trends.length > COLLAPSED_TRENDS && (
              <HStack>
                <Button label={isExpanded ? 'Show fewer' : `Show all ${trends.length} metrics`} size="sm" variant="ghost" onClick={() => setIsExpanded(value => !value)} />
              </HStack>
            )}
          </VStack>

          <VStack gap={0.5}>
            <Text type="supporting">
              {SOURCE_LABELS[data.source]} · updated <Timestamp value={data.generated_at} />
            </Text>
            {data.provider_fallback && <Text type="supporting">{data.provider_fallback}</Text>}
            <Text type="supporting">{data.note}</Text>
          </VStack>
        </VStack>
      )}
    </PanelCard>
  );
}
