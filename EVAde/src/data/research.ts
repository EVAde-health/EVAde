import { RADIATION_RAW } from './research/radiationRaw';
import { MISSION_TRENDS_RAW } from './research/missionTrendsRaw';
import type { HealthStatus } from './status';

export type Evidence = 'measured' | 'modelled' | 'derived' | 'preprint';
export type DestinationId = 'earth' | 'iss' | 'marsSurface' | 'artemis' | 'marsTransit';
export type FactGroup = 'bone' | 'sleep' | 'heart' | 'immune' | 'distance';

export interface Destination {
  id: DestinationId;
  label: string;
  mSvPerDay: number;
  range?: readonly [number, number];
  evidence: Evidence;
  source: string;
}

export interface StormLevel {
  level: 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
  name: string;
  pfu: number;
  perCycle: string;
  status: HealthStatus;
}

export interface ResearchFact {
  id: string;
  group: FactGroup;
  value: string;
  label: string;
  detail: string;
  evidence: Evidence;
  source: string;
}

export interface MissionEvent {
  day: number;
  type: string;
  description: string;
  evidence: string;
  source: string;
}

export interface ResearchSource {
  title: string;
  url: string;
  topic: 'Radiation' | 'Space weather' | 'Body' | 'Mission';
}

const ENV = RADIATION_RAW.environments;
const METRICS = MISSION_TRENDS_RAW.metrics;
const LIMITS = RADIATION_RAW.limits;
const EVENTS = RADIATION_RAW.solar_particle_events.events;

// Midpoint of a published range, used when one number is needed.
function midpoint([low, high]: readonly [number, number]) {
  return Math.round(((low + high) / 2) * 100) / 100;
}

// Adds a quiet S0 level and a status to NOAA's S1–S5 scale.
function buildStormLevels(): StormLevel[] {
  const published = RADIATION_RAW.solar_particle_events.noaa_s_scale.levels.map(l => ({
    level: l.level,
    name: l.name,
    pfu: l.pfu,
    perCycle: l.per_11yr_cycle,
    status: (l.level === 'S1' || l.level === 'S2' ? 'caution' : 'critical') as HealthStatus,
  }));
  return [{ level: 'S0', name: 'Quiet', pfu: 0, perCycle: 'most days', status: 'nominal' }, ...published];
}

export const CAREER_LIMIT_MSV = LIMITS.nasa_career_effective_dose_msv;
export const SOLAR_EVENT_LIMIT_MSV = LIMITS.nasa_spe_event_limit_msv;
export const LIMITS_SOURCE = LIMITS.source;
export const MISSION_LENGTH_DAYS = MISSION_TRENDS_RAW.mission_days;

export const DESTINATIONS: readonly Destination[] = [
  { id: 'earth', label: 'Earth surface', mSvPerDay: Math.round((ENV.earth_surface.dose_equivalent_msv_per_year / 365) * 1000) / 1000, evidence: 'derived', source: ENV.earth_surface.source },
  { id: 'iss', label: 'Space station', mSvPerDay: ENV.iss_leo.dose_equivalent_msv_per_day, range: ENV.iss_leo.dose_equivalent_range_msv_per_day, evidence: 'measured', source: ENV.iss_leo.source_0_43 },
  { id: 'marsSurface', label: 'Mars surface', mSvPerDay: ENV.mars_surface.dose_equivalent_msv_per_day, evidence: 'measured', source: ENV.mars_surface.source_paper },
  { id: 'artemis', label: 'Artemis I (Moon)', mSvPerDay: midpoint(ENV.cislunar_orion_artemis1.gcr_dose_equivalent_msv_per_day), range: ENV.cislunar_orion_artemis1.gcr_dose_equivalent_msv_per_day, evidence: 'measured', source: ENV.cislunar_orion_artemis1.source },
  { id: 'marsTransit', label: 'Mars transit', mSvPerDay: ENV.mars_transit.dose_equivalent_msv_per_day, evidence: 'measured', source: ENV.mars_transit.source },
];

export const MARS_REFERENCE_MISSION = {
  profile: ENV.mars_reference_mission.profile,
  totalMsv: ENV.mars_reference_mission.total_sv * 1000,
  source: ENV.mars_reference_mission.source,
};

export const STORM_LEVELS: readonly StormLevel[] = buildStormLevels();
export const STORM_SCALE_SOURCE = RADIATION_RAW.solar_particle_events.noaa_s_scale.source;

export const STORM_CASES = [
  { id: 'sep2017', title: 'September 2017 storm', value: '6×', detail: '67.8 µGy inside the ISS vs 418 µGy on the Mars surface', evidence: 'measured' as Evidence, source: EVENTS[0].source },
  { id: 'aug1972', title: 'August 1972 storm', value: '400 → 35 rem', detail: 'Unshielded moonwalker vs inside the Apollo capsule', evidence: 'modelled' as Evidence, source: EVENTS[1].source },
  { id: 'vest', title: 'Radiation vest', value: '−62%', detail: 'Modelled 1972-storm dose cut from 233.6 to 89.4 mSv', evidence: 'modelled' as Evidence, source: EVENTS[2].source },
  { id: 'shelter', title: 'Storm shelter', value: '4×', detail: 'Orion’s shelter cuts the peak dose rate of a 1989-size storm', evidence: 'modelled' as Evidence, source: EVENTS[3].source },
];

export const RESEARCH_FACTS: readonly ResearchFact[] = [
  { id: 'hip-ared', group: 'bone', value: `${METRICS.bone_density_pct_change_per_month_hip_with_ared.value}%`, label: 'Hip bone per month, with exercise', detail: 'ISS crew using the ARED resistance machine', evidence: 'measured', source: METRICS.bone_density_pct_change_per_month_hip_with_ared.source },
  { id: 'hip-none', group: 'bone', value: `${METRICS.bone_density_pct_change_per_month_hip_no_ared.value}%`, label: 'Hip bone per month, without it', detail: 'Crews before ARED, about 3× faster loss', evidence: 'measured', source: METRICS.bone_density_pct_change_per_month_hip_no_ared.source },
  { id: 'calf', group: 'bone', value: `${METRICS.calf_muscle_volume_pct_change_mission.value}%`, label: 'Calf muscle over 6 months', detail: 'Measured a few days after landing', evidence: 'measured', source: METRICS.calf_muscle_volume_pct_change_mission.source },
  { id: 'vo2', group: 'bone', value: `${METRICS.vo2peak_pct_change.flight_day_14}%`, label: 'Aerobic fitness by day 14', detail: 'VO2peak; back to preflight about 30 days after landing', evidence: 'measured', source: METRICS.vo2peak_pct_change.source },
  { id: 'sleep', group: 'sleep', value: `${METRICS.sleep_hours.inflight_iss} h`, label: 'Sleep per night on the ISS', detail: `Against ${METRICS.sleep_hours.scheduled} h scheduled`, evidence: 'measured', source: METRICS.sleep_hours.source },
  { id: 'sleep-meds', group: 'sleep', value: `${METRICS.sleep_medication_use.pct_crew_ever_used_inflight}%`, label: 'Crew who used sleep medication', detail: 'At least once in flight', evidence: 'measured', source: METRICS.sleep_medication_use.source },
  { id: 'circadian', group: 'sleep', value: `${METRICS.circadian_misalignment.pct_sleep_episodes_misaligned}%`, label: 'Sleep periods out of sync', detail: 'Misaligned with the body clock, about 1 h less sleep', evidence: 'measured', source: METRICS.circadian_misalignment.source },
  { id: 'bp', group: 'heart', value: `${METRICS.blood_pressure_change_mmhg.systolic}/${METRICS.blood_pressure_change_mmhg.diastolic}`, label: 'mmHg blood pressure in flight', detail: '24-hour average vs preflight; heart rate unchanged', evidence: 'measured', source: METRICS.blood_pressure_change_mmhg.source },
  { id: 'hrv', group: 'heart', value: 'Day 22', label: 'Heart-rate variability dips', detail: 'Recovers by about day 159 in a group of 20 crew', evidence: 'preprint', source: METRICS.rmssd_ms_trend.source },
  { id: 'tilt', group: 'heart', value: `${METRICS.orthostatic_intolerance_landing_day_pct.range[0]}–${METRICS.orthostatic_intolerance_landing_day_pct.range[1]}%`, label: 'Can’t stand 10 min on landing day', detail: 'Fail a head-up tilt test', evidence: 'measured', source: METRICS.orthostatic_intolerance_landing_day_pct.source },
  { id: 'virus', group: 'immune', value: `${METRICS.herpesvirus_shedding_pct_iss.any_virus}%`, label: 'ISS crew shed latent viruses', detail: 'Mostly without symptoms; rises with mission length', evidence: 'measured', source: METRICS.herpesvirus_shedding_pct_iss.source },
  { id: 'delay', group: 'distance', value: `${METRICS.mars_one_way_delay_min[0]}–${METRICS.mars_one_way_delay_min[1]} min`, label: 'One-way signal delay to Mars', detail: 'No live call to a doctor on Earth', evidence: 'measured', source: METRICS.mars_one_way_delay_source },
  { id: 'blackout', group: 'distance', value: `~${Math.round(METRICS.mars_solar_conjunction_blackout_days.value)} days`, label: 'Blackout at solar conjunction', detail: 'The Sun sits between Earth and Mars', evidence: 'measured', source: METRICS.mars_solar_conjunction_blackout_days.source },
];

export const FACT_GROUPS: readonly { id: FactGroup; label: string }[] = [
  { id: 'bone', label: 'Bone & muscle' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'heart', label: 'Heart' },
  { id: 'immune', label: 'Immune' },
  { id: 'distance', label: 'Distance' },
];

export const MISSION_EVENTS: readonly MissionEvent[] = MISSION_TRENDS_RAW.events;

export const NOAA_LIVE_FEED = RADIATION_RAW.live_feeds.noaa_goes_integral_protons_1day.url;

export const RESEARCH_SOURCES: readonly ResearchSource[] = [
  { topic: 'Radiation', title: 'NASA Twins Study (Science, 2019)', url: ENV.iss_leo.source_0_43 },
  { topic: 'Radiation', title: 'Artemis I radiation (Nature, 2024)', url: ENV.cislunar_orion_artemis1.source },
  { topic: 'Radiation', title: 'Curiosity RAD: Mars transit', url: ENV.mars_transit.source },
  { topic: 'Radiation', title: 'Curiosity RAD: Mars surface (Science, 2014)', url: ENV.mars_surface.source_paper },
  { topic: 'Radiation', title: 'NASA radiation limits (OCHMO)', url: LIMITS.source },
  { topic: 'Space weather', title: 'NOAA solar radiation storm scale', url: STORM_SCALE_SOURCE },
  { topic: 'Space weather', title: 'DLR DOSIS 3D: September 2017 storm', url: EVENTS[0].source },
  { topic: 'Space weather', title: 'AstroRad vest (IAC 2024)', url: EVENTS[2].source },
  { topic: 'Body', title: 'NASA Bone Evidence Report', url: METRICS.bone_density_pct_change_per_month_hip_with_ared.source },
  { topic: 'Body', title: 'NASA Muscle & Aerobic Evidence Report', url: METRICS.calf_muscle_volume_pct_change_mission.source },
  { topic: 'Body', title: 'NASA Sleep Evidence Report', url: METRICS.sleep_hours.source_phase },
  { topic: 'Body', title: 'Norsk 2015: heart and blood pressure', url: METRICS.blood_pressure_change_mmhg.source },
  { topic: 'Body', title: 'Rooney 2019: latent viruses', url: METRICS.herpesvirus_shedding_pct_iss.source },
  { topic: 'Mission', title: 'NASA: Mars communication delay', url: METRICS.mars_one_way_delay_source },
];

// Total dose after a number of days at one destination.
export function cumulativeDoseMsv(destination: DestinationId, days: number) {
  const rate = DESTINATIONS.find(d => d.id === destination)?.mSvPerDay ?? 0;
  return Math.round(rate * days * 10) / 10;
}

// Dose as a percent of NASA's 600 mSv career limit.
export function careerLimitShare(doseMsv: number) {
  return Math.round((doseMsv / CAREER_LIMIT_MSV) * 1000) / 10;
}

// Status for a career dose: under half the limit is nominal.
export function doseStatus(doseMsv: number): HealthStatus {
  const share = doseMsv / CAREER_LIMIT_MSV;
  if (share >= 1) return 'critical';
  return share >= 0.5 ? 'caution' : 'nominal';
}

// Cumulative dose per destination, sampled every `step` days for charts.
export function doseCurves(days: number, step = 10) {
  const points: Record<string, number>[] = [];
  for (let day = 0; day <= days; day += step) {
    const point: Record<string, number> = { day };
    for (const d of DESTINATIONS) point[d.id] = cumulativeDoseMsv(d.id, day);
    points.push(point);
  }
  return points;
}

// NOAA storm level reached by a ≥10 MeV proton flux in pfu.
export function stormLevelForFlux(pfu: number | null) {
  if (pfu === null) return STORM_LEVELS[0];
  const reached = STORM_LEVELS.filter(l => pfu >= l.pfu);
  return reached[reached.length - 1] ?? STORM_LEVELS[0];
}

// Storm level from a stored label like "S2", falling back to flux.
export function stormLevelFor(label: string | null | undefined, pfu: number | null) {
  return STORM_LEVELS.find(l => l.level === label) ?? stormLevelForFlux(pfu);
}

// Readable hostname for a source link.
export function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
