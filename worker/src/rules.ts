/**
 * Daily check-in rules used by the voice agent. Line-for-line port of
 * models/checkin_rules.py (same thresholds, wording, ordering and return shape).
 *
 * STAND-IN: simple, explainable rules built on standard clinical reference ranges
 * (not spaceflight-specific ones). Keep assess()'s signature and return shape if the
 * team's real rules replace it.
 *
 * Reference ranges used (adult, resting):
 * - Blood pressure: AHA categories. Normal < 120/80, stage 1 130-139/80-89,
 *   stage 2 >= 140/90, crisis >= 180/120. Low (hypotension) < 90/60.
 * - Temperature: normal ~36.1-37.2 C, fever >= 38.0 C, high fever >= 39.4 C,
 *   hypothermia < 35.0 C.
 * - Blood sugar (mg/dL): normal fasting 70-99, hypoglycaemia < 70,
 *   serious hypoglycaemia < 54, very high >= 250.
 * - Sleep: adults need 7+ h; < 6 h is short, < 4 h is severely short.
 * - Mood: self-rated 1 (very low) to 5 (very good).
 */
import { fmtFixed, fmtG, round1 } from "./pyfmt";

export type Level = "green" | "yellow" | "red";
export const GREEN: Level = "green";
export const YELLOW: Level = "yellow";
export const RED: Level = "red";
const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

/** Symptoms that should always escalate to red. */
export const RED_FLAG_SYMPTOMS = [
  "chest pain", "chest pressure", "shortness of breath", "can't breathe",
  "cannot breathe", "difficulty breathing", "trouble breathing", "fainted",
  "fainting", "passed out", "confusion", "confused", "slurred speech",
  "seizure", "vision loss", "loss of vision", "worst headache",
  "severe headache", "numbness on one side", "weakness on one side",
  "coughing blood", "vomiting blood", "severe bleeding",
] as const;

export interface Finding {
  level: Level;
  metric: string;
  reason: string;
  actions: string[];
}

const finding = (level: Level, metric: string, reason: string, actions: string[] = []): Finding =>
  ({ level, metric, reason, actions });

function fahrenheitToCelsius(value: number): number {
  return ((value - 32.0) * 5.0) / 9.0;
}

/** Accept C or F; anything above 45 is treated as Fahrenheit. */
export function normaliseTemperatureC(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value > 45 ? round1(fahrenheitToCelsius(value)) : round1(value);
}

function sleep(hours: number | null, baseline: number | null): Finding[] {
  if (hours === null) return [];
  const out: Finding[] = [];
  if (hours < 4) {
    out.push(finding(RED, "sleep", `You slept about ${fmtG(hours)} hours. Under 4 hours ` +
      "seriously affects reaction time and judgement.",
      ["Avoid EVA, robotics or other safety-critical tasks today if you can.",
       "Plan a nap or an earlier sleep period tonight.",
       "Tell the flight surgeon so the schedule can be adjusted."]));
  } else if (hours < 6) {
    out.push(finding(YELLOW, "sleep", `You slept about ${fmtG(hours)} hours. Adults need ` +
      "about 7 or more, so you may be slower and more error-prone today.",
      ["Double-check critical procedures today.",
       "Dim lights and screens an hour before your next sleep period."]));
  }
  if (baseline !== null && hours <= baseline - 1.5 && !out.some((f) => f.level === RED)) {
    out.push(finding(YELLOW, "sleep", `That's ${fmtFixed(baseline - hours)} hours less than ` +
      `your own recent average of ${fmtFixed(baseline)} hours.`,
      ["Watch for a pattern: if it happens again tomorrow, report it."]));
  }
  return out;
}

function mood(m: number | null, baseline: number | null): Finding[] {
  if (m === null) return [];
  const out: Finding[] = [];
  if (m <= 1) {
    out.push(finding(RED, "mood", "You rated your mood 1 out of 5, the lowest score.",
      ["Talk to a crewmate you trust today.",
       "Request a private conference with the flight surgeon or psychologist."]));
  } else if (m === 2) {
    out.push(finding(YELLOW, "mood", "You rated your mood 2 out of 5, which is low.",
      ["Take a short break, exercise or contact family if the schedule allows.",
       "If it stays low for a few days, tell the flight surgeon."]));
  }
  if (baseline !== null && m <= baseline - 1.5 && m > 1) {
    out.push(finding(YELLOW, "mood", `That's well below your usual mood of about ${fmtFixed(baseline)}.`,
      ["Notice what changed; a quick note in your journal helps the flight surgeon."]));
  }
  return out;
}

function bp(sys: number | null, dia: number | null): Finding[] {
  if (sys === null || dia === null) return [];
  const reading = `${sys} over ${dia}`;
  if (sys >= 180 || dia >= 120) {
    return [finding(RED, "blood_pressure", `Blood pressure ${reading} is in the ` +
      "hypertensive crisis range (180 over 120 or higher).",
      ["Sit quietly for 5 minutes and measure again.",
       "If it is still this high, or you have chest pain, headache or vision changes, " +
       "contact the flight surgeon now."])];
  }
  if (sys < 90 || dia < 60) {
    return [finding(YELLOW, "blood_pressure", `Blood pressure ${reading} is low (under 90 over 60). ` +
      "After weeks in microgravity this can cause light-headedness.",
      ["Drink fluids and stand up slowly.", "Re-measure in an hour."])];
  }
  if (sys >= 140 || dia >= 90) {
    return [finding(YELLOW, "blood_pressure", `Blood pressure ${reading} is high (stage 2, ` +
      "140 over 90 or higher).",
      ["Rest 5 minutes and re-measure.", "Mention it in today's report to the flight surgeon."])];
  }
  if (sys >= 130 || dia >= 80) {
    return [finding(YELLOW, "blood_pressure", `Blood pressure ${reading} is mildly high ` +
      "(stage 1, 130 over 80 or higher).",
      ["Re-measure tomorrow at the same time of day."])];
  }
  return [];
}

function temperature(t: number | null): Finding[] {
  if (t === null) return [];
  const v = fmtFixed(t);
  if (t >= 39.4) {
    return [finding(RED, "temperature", `Temperature ${v} °C is a high fever.`,
      ["Rest and drink fluids.", "Contact the flight surgeon now.",
       "Limit close contact with crewmates."])];
  }
  if (t < 35.0) {
    return [finding(RED, "temperature", `Temperature ${v} °C is below 35 °C (hypothermia range).`,
      ["Re-measure to rule out a bad reading.", "Warm up and contact the flight surgeon."])];
  }
  if (t >= 38.0) {
    return [finding(YELLOW, "temperature", `Temperature ${v} °C is a fever (38 °C or higher).`,
      ["Rest, drink fluids and re-measure in 4 hours.",
       "Note any other symptoms; latent viruses can reactivate in spaceflight."])];
  }
  if (t >= 37.3) {
    return [finding(YELLOW, "temperature", `Temperature ${v} °C is slightly raised.`,
      ["Re-measure later today."])];
  }
  return [];
}

function glucose(mg: number | null): Finding[] {
  if (mg === null) return [];
  const v = fmtG(mg);
  if (mg < 54) {
    return [finding(RED, "blood_sugar", `Blood sugar ${v} mg/dL is seriously low (under 54).`,
      ["Take 15 g of fast sugar now (juice or glucose tablets) and re-check in 15 minutes.",
       "Tell a crewmate and the flight surgeon."])];
  }
  if (mg >= 250) {
    return [finding(RED, "blood_sugar", `Blood sugar ${v} mg/dL is very high (250 or more).`,
      ["Drink water and re-check.", "Contact the flight surgeon."])];
  }
  if (mg < 70) {
    return [finding(YELLOW, "blood_sugar", `Blood sugar ${v} mg/dL is low (under 70).`,
      ["Eat a snack with sugar and re-check in 15 minutes."])];
  }
  if (mg >= 126) {
    return [finding(YELLOW, "blood_sugar", `Blood sugar ${v} mg/dL is high (126 or more if fasting).`,
      ["Re-check fasting tomorrow morning."])];
  }
  return [];
}

function symptomFindings(symptoms: Iterable<string | null | undefined>): Finding[] {
  const out: Finding[] = [];
  for (const s of symptoms) {
    const text = String(s ?? "").trim();
    if (!text) continue;
    const low = text.toLowerCase();
    if (["none", "no", "nothing", "no symptoms"].includes(low)) continue;
    if (RED_FLAG_SYMPTOMS.some((flag) => low.includes(flag))) {
      out.push(finding(RED, "symptom", `'${text}' can be a sign of a serious problem.`,
        ["Stop what you are doing and tell a crewmate.",
         "Contact the flight surgeon now."]));
    } else {
      out.push(finding(YELLOW, "symptom", `You reported '${text}'.`,
        ["Keep an eye on it and mention it if it gets worse or lasts more than a day."]));
    }
  }
  return out;
}

export interface AssessInput {
  sleep_hours?: number | null;
  mood?: number | null;
  symptoms?: Iterable<string>;
  systolic?: number | null;
  diastolic?: number | null;
  temperature_c?: number | null;
  blood_sugar_mg_dl?: number | null;
  baseline_sleep?: number | null;
  baseline_mood?: number | null;
}

export interface Assessment {
  level: Level;
  findings: Finding[];
  reasons: string[];
  actions: string[];
}

/** Return {level, findings, reasons, actions} for one check-in. */
export function assess(input: AssessInput = {}): Assessment {
  const n = (v: number | null | undefined) => (v === undefined ? null : v);
  const findings: Finding[] = [
    ...sleep(n(input.sleep_hours), n(input.baseline_sleep)),
    ...mood(n(input.mood), n(input.baseline_mood)),
    ...bp(n(input.systolic), n(input.diastolic)),
    ...temperature(n(input.temperature_c)),
    ...glucose(n(input.blood_sugar_mg_dl)),
    ...symptomFindings(input.symptoms ?? []),
  ];

  let level: Level = GREEN;
  for (const f of findings) if (RANK[f.level] > RANK[level]) level = f.level;

  let actions: string[] = [];
  // Stable sort by descending severity (Python's sorted() is stable too).
  for (const f of [...findings].sort((a, b) => RANK[b.level] - RANK[a.level])) {
    for (const a of f.actions) if (!actions.includes(a)) actions.push(a);
  }
  if (level === RED) actions.unshift("Send this check-in to the flight surgeon.");
  let reasons: string[];
  if (findings.length === 0) {
    reasons = ["Everything you reported is within normal reference ranges."];
    actions = ["Keep your usual routine and check in again tomorrow."];
  } else {
    reasons = findings.map((f) => f.reason);
  }
  return { level, findings: findings.map((f) => ({ ...f })), reasons, actions };
}
