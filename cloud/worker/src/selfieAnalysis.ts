// Astronaut selfie assessment on Cloudflare Workers AI, next to the R2 photo (the image never goes to xAI).
// Primary: Llama 4 Scout (multimodal, descriptive JSON). Fallback: LLaVA 1.5 7B if Scout errors.
// A missing binding or a reply without the required fields is stored as unavailable / unparsed. Nothing here
// fills in a mood. The prompt forbids naming or identifying the person.

export const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const VISION_FALLBACK_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const MOODS = ["tired", "stressed", "happy", "sad", "calm", "unwell", "unclear"] as const;
export type SelfieMood = (typeof MOODS)[number];
const LEVELS = ["none", "mild", "moderate", "marked"] as const;
export type SignLevel = (typeof LEVELS)[number];

export interface SelfieObservations {
  eyes: string | null;
  expression: string | null;
  posture: string | null;
  skin: string | null;
}

export interface SelfieAssessment {
  status: "ok" | "unparsed" | "unavailable";
  model: string;
  mood: SelfieMood | null;
  explanation: string | null;
  confidence: number | null;
  fatigue: SignLevel | null;
  stress: SignLevel | null;
  observations: SelfieObservations | null;
  follow_up: string | null;
  raw: string | null;
  reason?: string;
}

const PROMPT = [
  "You are assessing an astronaut's selfie for their flight surgeon.",
  "Describe only what is visible: eyes, facial expression, head and posture, skin color and complexion.",
  "Do not name, identify or guess who the person is. Do not diagnose. Lighting and camera angle can mislead; say so when relevant.",
  "Return JSON only, no markdown, with exactly this shape:",
  '{"mood":"tired|stressed|happy|sad|calm|unwell|unclear","confidence":0.0,"fatigue":"none|mild|moderate|marked",',
  '"stress":"none|mild|moderate|marked","explanation":"two or three sentences on what you see and why it suggests that mood",',
  '"observations":{"eyes":"...","expression":"...","posture":"...","skin":"..."},"follow_up":"one short suggestion for the flight surgeon"}',
  "confidence is how sure you are, from 0 to 1. Use mood unclear when no face is visible.",
].join(" ");

const short = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const level = (v: unknown) => (LEVELS.includes(v as SignLevel) ? v as SignLevel : null);

const empty = (model: string, status: SelfieAssessment["status"], reason: string, raw: string | null = null): SelfieAssessment => ({
  status, model, mood: null, explanation: null, confidence: null, fatigue: null, stress: null, observations: null,
  follow_up: null, raw, reason,
});

export function parseSelfieAssessment(text: string, model = VISION_MODEL): SelfieAssessment {
  const raw = text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return empty(model, "unparsed", "The vision model did not return JSON.", raw.slice(0, 2000));
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return empty(model, "unparsed", "The vision model returned invalid JSON.", raw.slice(0, 2000));
  }
  const mood = MOODS.includes(obj.mood as SelfieMood) ? obj.mood as SelfieMood : null;
  const explanation = short(obj.explanation, 800);
  const confidence = typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1 ? obj.confidence : null;
  if (!mood || !explanation || confidence === null) {
    return { ...empty(model, "unparsed", "The vision model JSON was missing mood, explanation, or confidence.", raw.slice(0, 2000)), explanation };
  }
  const o = obj.observations && typeof obj.observations === "object" ? obj.observations as Record<string, unknown> : null;
  return {
    status: "ok", model, mood, explanation, confidence, fatigue: level(obj.fatigue), stress: level(obj.stress),
    observations: o ? { eyes: short(o.eyes, 200), expression: short(o.expression, 200), posture: short(o.posture, 200), skin: short(o.skin, 200) } : null,
    follow_up: short(obj.follow_up, 300), raw: raw.slice(0, 2000),
  };
}

// Pulls the reply text out of the shapes Workers AI returns (chat completions, { response }, LLaVA's { description }).
function textOf(out: unknown): string {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (typeof out !== "object") return String(out);
  const row = out as Record<string, any>;
  if (row.response && typeof row.response === "object") return JSON.stringify(row.response);
  for (const key of ["response", "description", "result", "text"]) {
    if (typeof row[key] === "string") return row[key];
  }
  const content = row.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return JSON.stringify(out);
}

type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };

// Base64 for a data URL, chunked so large photos do not overflow the argument list.
function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}

/** Runs the vision model on the uploaded image. A missing binding is an honest unavailable result. */
export async function analyzeSelfie(ai: AiBinding | undefined, bytes: ArrayBuffer, contentType: string): Promise<SelfieAssessment> {
  if (!ai) return empty(VISION_MODEL, "unavailable", "Workers AI is not bound on this Worker.");
  if (!contentType.startsWith("image/")) return empty(VISION_MODEL, "unavailable", "Only image uploads are assessed.");
  if (bytes.byteLength > 4_000_000) return empty(VISION_MODEL, "unavailable", "Image is over 4 MB, so it was not sent to the vision model.");
  const image = new Uint8Array(bytes);
  try {
    const out = await ai.run(VISION_MODEL, {
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${base64(image)}` } },
      ] }],
      max_tokens: 500,
      temperature: 0.2,
    });
    const parsed = parseSelfieAssessment(textOf(out), VISION_MODEL);
    if (parsed.status === "ok") return parsed;
  } catch {
    // fall through to LLaVA
  }
  try {
    const out = await ai.run(VISION_FALLBACK_MODEL, { image: [...image], prompt: PROMPT, max_tokens: 400 });
    return parseSelfieAssessment(textOf(out), VISION_FALLBACK_MODEL);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workers AI request failed";
    return empty(VISION_MODEL, "unavailable", /remotely/i.test(message)
      ? "Workers AI did not run in this session. No mood was invented." : message.slice(0, 300));
  }
}

/** Moods and sign levels that the flight surgeon should hear about, not just find later in the Selfies tab. */
export function needsSurgeonAttention(a: SelfieAssessment) {
  return a.status === "ok" && (["tired", "stressed", "sad", "unwell"].includes(a.mood ?? "")
    || a.fatigue === "moderate" || a.fatigue === "marked" || a.stress === "moderate" || a.stress === "marked");
}
