import { levelFromThresholds, type MetricDef } from "./health";

const PREFIX = "00000000-0000-4000-8000-";
const SLOT = 15 * 60_000;
const DAY = 86_400_000;
const HOUR = 3600_000;
const METRICS = ["heart_rate", "systolic_bp", "diastolic_bp", "spo2", "sleep_hours", "mood", "daily_radiation_msv"];
type Astronaut = { user_id: string; mission_start: string | null; latest: string | null };

function sample(astronaut: Astronaut, date: number) {
  const shift = [...astronaut.user_id].reduce((sum, c, i) => (sum + c.charCodeAt(0) * (i + 1)) % 101, 0);
  const day = Math.floor(date / DAY);
  const hour = (date % DAY) / HOUR;
  const rhythm = Math.sin((hour - 8) * Math.PI / 12 + shift / 170);
  const wiggle = 0.4 * Math.sin(date / HOUR * 0.7 + shift);
  const dehydrated = (day + shift) % 3 === 0 && hour >= 12 && hour < 16;
  const badNight = (day + shift) % 3 === 1;
  const radiation = (day + shift) % 5 === 2 && hour >= 9 && hour < 15;
  const start = Math.min(date, Math.max(date - 1000 * DAY, Date.parse(astronaut.mission_start ?? "") || Date.UTC(2026, 0, 1)));
  const pulseUnits = (t: number) => {
    const d = Math.floor(t / DAY);
    const fraction = Math.max(0, Math.min(1, ((t % DAY) / HOUR - 9) / 6));
    return Math.floor((d + shift + 2) / 5) + ((d + shift) % 5 === 2 ? fraction : 0);
  };
  const dailyDose = radiation ? 2.4 + 0.3 * Math.sin((hour - 9) * Math.PI / 6) : 0.37 + shift / 1200 + 0.05 * rhythm;
  const cumulative = 0.42 * (date - start) / DAY + shift / 30 + 1.6 * (pulseUnits(date) - pulseUnits(start));
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    hour, day, dailyDose: round(dailyDose), cumulative: round(cumulative), radiation, dehydrated,
    readings: {
      heart_rate: Math.round(63 + shift % 15 + 7 * rhythm + wiggle + (dehydrated ? 35 : 0)),
      systolic_bp: Math.round(108 + shift % 14 + 7 * rhythm - (dehydrated ? 24 : 0)),
      diastolic_bp: Math.round(69 + shift % 8 + 4 * rhythm - (dehydrated ? 9 : 0)),
      spo2: round(97.2 + 0.6 * rhythm + 0.12 * wiggle),
      sleep_hours: round(badNight ? 4.4 + 0.25 * Math.sin(shift) : 7.4 + 0.65 * Math.sin(day * 0.4 + shift)),
      mood: badNight ? 2 : dehydrated ? 3 : 4 + ((day + shift) % 4 === 0 ? 1 : 0),
      daily_radiation_msv: round(dailyDose),
    },
  };
}

type Sample = ReturnType<typeof sample>;
export type SimulationPrediction = (userId: string, ts: string, sample: Sample) => Promise<void>;

function rowsFor(db: D1Database, astronaut: Astronaut, time: number, definitions: Map<string, MetricDef>, alert: boolean) {
  const user = astronaut.user_id;
  const live = sample(astronaut, time);
  const ts = new Date(time).toISOString();
  const id = "sim:" + user + ":" + ts;
  const rows: D1PreparedStatement[] = [];
  for (const [metric, value] of Object.entries(live.readings)) {
    const def = definitions.get(metric);
    if (!def) continue;
    // Daily sleep and mood are recorded once per day. Other signals have a full series.
    const daily = metric === "sleep_hours" || metric === "mood";
    const level = levelFromThresholds(value, def);
    const clientId = daily ? "sim:" + user + ":" + live.day + ":" + metric : id + ":" + metric;
    rows.push(db.prepare(
      "INSERT INTO observations (client_id,user_id,metric,value,unit,ts,source,level,simulation_source) VALUES (?,?,?,?,?,?,'synthetic',?,'simulated') ON CONFLICT(client_id) DO NOTHING"
    ).bind(clientId, user, metric, value, def.unit, ts, level));
    if (level !== "green" && alert) {
      const bucket = daily ? live.day * DAY : Math.floor(time / (3 * HOUR)) * 3 * HOUR;
      rows.push(db.prepare(
        "INSERT INTO alerts (user_id,ts,level,metric,message,action,escalate,simulation_source) VALUES (?,?,?,?,?,?,?,'simulated') " +
        "ON CONFLICT(user_id,ts,metric) WHERE simulation_source='simulated' DO UPDATE SET level=excluded.level, message=excluded.message, action=excluded.action, escalate=excluded.escalate " +
        "WHERE excluded.level='red' AND alerts.level='yellow'"
      ).bind(user, new Date(bucket).toISOString(), level, metric,
        "Simulated data: " + def.label + " is " + value + " " + def.unit + " (" + level + ").",
        def.what_to_do, level === "red" ? 1 : 0));
    }
  }
  rows.push(
    db.prepare(
      "INSERT INTO self_reports (client_id,user_id,ts,mood,stress,fatigue,sleep_quality,sleep_hours,simulation_source) VALUES (?,?,?,?,?,?,?,?,'simulated') ON CONFLICT(client_id) DO NOTHING"
    ).bind("sim:" + user + ":" + live.day + ":report", user, ts, live.readings.mood, live.dehydrated ? 4 : 2,
      live.readings.sleep_hours < 6 ? 4 : 2, live.readings.sleep_hours < 6 ? 2 : 4, live.readings.sleep_hours),
    db.prepare(
      "INSERT INTO radiation_doses (client_id,user_id,ts,dose_rate_usv_h,daily_dose_msv,cumulative_msv,spe_flag,location,source) VALUES (?,?,?,?,?,?,?,'inside','simulated') ON CONFLICT(client_id) DO NOTHING"
    ).bind(id + ":dose", user, ts, +(live.dailyDose * 1000 / 24).toFixed(2), live.dailyDose, live.cumulative, live.radiation ? 1 : 0),
  );
  for (const [hour, name, grams, kcal, protein, carbs, fat] of [
    [7, "Oats and dried fruit", 220, 510, 22, 76, 13],
    [12, "Rice and chicken", 360, 730, 45, 92, 22],
    [18, "Salmon, grains and vegetables", 390, 910, 52, 113, 28],
  ] as const) {
    if (live.hour < hour) continue;
    rows.push(db.prepare(
      "INSERT INTO meals (id,user_id,ts,name,grams,kcal,protein,carbs,fat,source) VALUES (?,?,?,?,?,?,?,?,?,'simulated') ON CONFLICT(id) DO NOTHING"
    ).bind("sim:" + user + ":" + live.day + ":meal:" + hour,
      user, new Date(live.day * DAY + hour * HOUR).toISOString(), name, grams, kcal, protein, carbs, fat));
  }
  for (let hour = 6; hour <= Math.min(22, live.hour); hour += 2) {
    rows.push(db.prepare(
      "INSERT INTO hydration (id,user_id,ts,amount_ml,source) VALUES (?,?,?,?,'simulated') ON CONFLICT(id) DO NOTHING"
    ).bind("sim:" + user + ":" + live.day + ":water:" + hour,
      user, new Date(live.day * DAY + hour * HOUR).toISOString(), live.dehydrated && hour >= 12 && hour < 16 ? 80 : 260));
  }
  return rows;
}

export async function refreshSimulation(db: D1Database, time: number, predict?: SimulationPrediction) {
  const timeSlot = Math.floor(time / SLOT) * SLOT;
  const { results: columns } = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const hasFlag = columns.some(col => col.name === "synthetic");
  const { results: users } = await db.prepare(
    "SELECT u.user_id, u.mission_start, (SELECT max(ts) FROM observations WHERE user_id=u.user_id AND simulation_source='simulated') AS latest " +
    "FROM users u WHERE u.role='astronaut' AND (substr(u.user_id,1,?)=?" + (hasFlag ? " OR u.synthetic=1" : "") + ")"
  ).bind(PREFIX.length, PREFIX).all<Astronaut>();
  const { results } = await db.prepare("SELECT * FROM metric_definitions").all<MetricDef>();
  const definitions = new Map(results.filter(d => METRICS.includes(d.metric)).map(d => [d.metric, d]));
  const since = new Date(timeSlot - 14 * DAY).toISOString();
  let modelFailures = 0;
  for (const user of users) {
    // A bounded initial chart history, then only one point per quarter hour.
    const offsets = user.latest ? [0] : [24, 21, 18, 15, 12, 9, 6, 3, 0];
    const points = offsets.flatMap(offset => rowsFor(db, user, timeSlot - offset * HOUR, definitions, true));
    for (let i = 0; i < points.length; i += 45) await db.batch(points.slice(i, i + 45));
    await db.batch([
      ...["observations", "self_reports", "alerts"].map(table =>
        db.prepare("DELETE FROM " + table + " WHERE user_id=? AND ts<? AND simulation_source='simulated'").bind(user.user_id, since)),
      ...["meals", "hydration", "radiation_doses", "model_results", "risk_scores"].map(table =>
        db.prepare("DELETE FROM " + table + " WHERE user_id=? AND ts<? AND source='simulated'").bind(user.user_id, since)),
    ]);
    if (predict) {
      try {
        await predict(user.user_id, new Date(timeSlot).toISOString(), sample(user, timeSlot));
      } catch {
        modelFailures++;
      }
    }
  }
  return { astronauts: users.length, simulated_at: new Date(timeSlot).toISOString(), model_failures: modelFailures };
}
