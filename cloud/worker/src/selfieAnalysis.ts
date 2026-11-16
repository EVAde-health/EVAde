// Astronaut selfie assessment. The image stays on Cloudflare Workers AI (LLaVA 1.5), next to the R2 photo.
// Grok is already used for text and voice and does not see the image. A missing binding or a non-JSON reply
// is stored as unavailable. Nothing here fills in a mood.

export const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const MOODS = ["tired", "stressed", "happy", "sad", "calm", "unwell", "unclear"] as const;
export type SelfieMood = (typeof MOODS)[number];

export interface SelfieAssessment {
  status: "ok" | "unparsed" | "unavailable";
  model: string;
  mood: SelfieMood | null;
  explanation: string | null;
  confidence: number | null;
  raw: string | null;
  reason?: string;
}

const PROMPT = [
  "You are assessing an astronaut selfie for a flight surgeon.",
  "Look at the face and posture only. Do not diagnose and do not invent details you cannot see.",
  "Return JSON only, no markdown, with this shape:",
  '{"mood":"tired|stressed|happy|sad|calm|unwell|unclear","explanation":"one or two sentences","confidence":0.0}',
  "confidence is how sure you are, from 0 to 1. Use unclear when the face is not visible.",
].join(" ");

export function parseSelfieAssessment(text: string, model = VISION_MODEL): SelfieAssessment {
  const raw = text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { status: "unparsed", model, mood: null, explanation: null, confidence: null, raw: raw.slice(0, 2000), reason: "The vision model did not return JSON." };
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { status: "unparsed", model, mood: null, explanation: null, confidence: null, raw: raw.slice(0, 2000), reason: "The vision model returned invalid JSON." };
  }
  const mood = MOODS.includes(obj.mood as SelfieMood) ? obj.mood as SelfieMood : null;
  const explanation = typeof obj.explanation === "string" ? obj.explanation.trim().slice(0, 600) : "";
  const confidence = typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1 ? obj.confidence : null;
  if (!mood || !explanation || confidence === null) {
    return { status: "unparsed", model, mood: null, explanation: explanation || null, confidence, raw: raw.slice(0, 2000), reason: "The vision model JSON was missing mood, explanation, or confidence." };
  }
  return { status: "ok", model, mood, explanation, confidence, raw: raw.slice(0, 2000) };
}

function textOf(out: unknown): string {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (typeof out === "object") {
    const row = out as Record<string, unknown>;
    for (const key of ["description", "response", "result", "text"]) {
      if (typeof row[key] === "string") return row[key] as string;
    }
  }
  return JSON.stringify(out);
}

type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };

/** Runs the vision model. `bytes` is the uploaded image. A missing binding is an honest unavailable result. */
export async function analyzeSelfie(ai: AiBinding | undefined, bytes: ArrayBuffer, contentType: string): Promise<SelfieAssessment> {
  if (!ai) {
    return { status: "unavailable", model: VISION_MODEL, mood: null, explanation: null, confidence: null, raw: null, reason: "Workers AI is not bound on this Worker." };
  }
  if (!contentType.startsWith("image/")) {
    return { status: "unavailable", model: VISION_MODEL, mood: null, explanation: null, confidence: null, raw: null, reason: "Only image uploads are assessed." };
  }
  if (bytes.byteLength > 4_000_000) {
    return { status: "unavailable", model: VISION_MODEL, mood: null, explanation: null, confidence: null, raw: null, reason: "Image is over 4 MB, so it was not sent to the vision model." };
  }
  let out: unknown;
  try {
    out = await ai.run(VISION_MODEL, {
      image: [...new Uint8Array(bytes)],
      prompt: PROMPT,
      max_tokens: 300,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workers AI request failed";
    const reason = /remotely/i.test(message)
      ? "Workers AI did not run in this session. On the evade-api Worker the AI binding runs LLaVA. No mood was invented."
      : message.slice(0, 300);
    return { status: "unavailable", model: VISION_MODEL, mood: null, explanation: null, confidence: null, raw: null, reason };
  }
  return parseSelfieAssessment(textOf(out));
}
