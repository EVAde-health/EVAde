// xAI Grok: journal analysis for the behavioral-health team, speech-to-text, and a plain-language daily briefing
// (the journal companion and the staff summary use the same helpers). All outputs are support for human review, never
// a diagnosis. Concerning journal language always reaches a human, even if the model is unavailable, through the
// keyword safety net below.
//
// xAI REST API (OpenAI-compatible): https://docs.x.ai/developers/models (model list),
// https://docs.x.ai/docs/guides/structured-outputs (response_format json_schema),
// https://docs.x.ai/developers/model-capabilities/audio/speech-to-text (POST /v1/stt).

export const XAI_API_BASE = "https://api.x.ai/v1";
/** Fast non-reasoning Grok for short chat and JSON extraction. Override with the XAI_TEXT_MODEL var. */
export const DEFAULT_TEXT_MODEL = "grok-4.20-0309-non-reasoning";
/** Tried when the first model errors or returns nothing. Override with XAI_FALLBACK_TEXT_MODEL ("" disables it). */
export const DEFAULT_FALLBACK_TEXT_MODEL = "grok-4.3";
/** xAI speech-to-text (REST). Override with XAI_STT_MODEL. */
export const DEFAULT_STT_MODEL = "grok-voice-transcribe-2.0";
const TIMEOUT_MS = 25_000;

export interface AiEnv {
  XAI_API_KEY?: string; // Worker secret; without it every AI feature falls back (entries are still saved)
  XAI_TEXT_MODEL?: string;
  XAI_FALLBACK_TEXT_MODEL?: string;
  XAI_STT_MODEL?: string;
}

export const aiConfigured = (env: AiEnv) => Boolean(env.XAI_API_KEY);

/** The Grok text models to try, in order (configured model first, then the fallback; no duplicates). */
export function textModels(env: AiEnv): string[] {
  const primary = env.XAI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  const fallback = env.XAI_FALLBACK_TEXT_MODEL === undefined ? DEFAULT_FALLBACK_TEXT_MODEL : env.XAI_FALLBACK_TEXT_MODEL.trim();
  return [...new Set([primary, fallback].filter(Boolean))];
}

export interface ChatInput {
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature: number;
  /** JSON Schema for structured output (response_format json_schema, strict). */
  schema?: { name: string; schema: object };
}

export class XaiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** One chat completion on one model. Returns the message text; throws XaiError on HTTP errors. */
export async function xaiChat(env: AiEnv, model: string, input: ChatInput): Promise<string> {
  if (!env.XAI_API_KEY) throw new XaiError(503, "XAI_API_KEY is not set");
  const body: Record<string, unknown> = {
    model, messages: input.messages, max_completion_tokens: input.max_tokens, temperature: input.temperature,
  };
  if (input.schema) body.response_format = { type: "json_schema", json_schema: { ...input.schema, strict: true } };
  const res = await fetch(`${XAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new XaiError(res.status, `xAI chat ${res.status}`); // the body is not logged (it can echo input)
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Runs the chat on each configured Grok model until one returns usable output. `accept` turns the text into the
 * result (return null to try the next model). Null when the key is missing or every model failed. Never throws.
 */
export async function grok<T>(env: AiEnv, input: ChatInput, accept: (text: string) => T | null, label: string): Promise<{ value: T; model: string } | null> {
  if (!aiConfigured(env)) return null;
  for (const model of textModels(env)) {
    try {
      const value = accept(await xaiChat(env, model, input));
      if (value !== null && value !== undefined) return { value, model };
    } catch (e) {
      console.log(`${label} failed on`, model, e instanceof XaiError ? e.message : String(e));
    }
  }
  return null;
}

// Safety net: phrases that must always go to a person, independent of the model.
const URGENT = /\b(suicid\w*|kill (myself|me)|end (my|it all)|end my life|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself|don'?t want to (live|be alive|wake up)|no reason to live|better off (dead|without me))\b/i;

export interface JournalAnalysis {
  summary: string | null;
  sentiment: number | null; // -1 (very negative) .. 1 (very positive)
  mood_label: string | null;
  concern_level: "none" | "low" | "moderate" | "high";
  needs_human_review: boolean;
  themes: string[];
  model: string | null;
  keyword_flag: boolean;
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sentiment: { type: "number" },
    mood_label: { type: "string" },
    concern_level: { type: "string", enum: ["none", "low", "moderate", "high"] },
    needs_human_review: { type: "boolean" },
    themes: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "sentiment", "mood_label", "concern_level", "needs_human_review", "themes"],
};

const SYSTEM = `You support the behavioral health team of a long-duration space mission.
Read one astronaut journal entry and return JSON only.
- summary: 1-2 neutral sentences in third person for the crew psychologist. No diagnosis, no advice, no quotes longer than 6 words.
- sentiment: number from -1 (very negative) to 1 (very positive).
- mood_label: one word (for example calm, content, tired, stressed, anxious, lonely, irritable, low, motivated).
- concern_level: none, low, moderate, or high. Use high for any mention of self-harm, wanting to die, or feeling unsafe.
- needs_human_review: true when concern_level is moderate or high, or the writer asks for help.
- themes: up to 4 short tags (for example sleep, workload, isolation, family, conflict, health, homesick).`;

function clamp(n: unknown, lo: number, hi: number) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null;
}

/** Parse model output that may be an object, a JSON string, or JSON wrapped in text. Exported for tests. */
export function parseModelJson(resp: any): any | null {
  const r = resp?.response ?? resp;
  if (r && typeof r === "object") return r;
  if (typeof r !== "string") return null;
  try { return JSON.parse(r); } catch {}
  const m = r.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export function keywordFlag(text: string) {
  return URGENT.test(text);
}

export async function analyzeJournal(env: AiEnv, text: string): Promise<JournalAnalysis> {
  const flagged = keywordFlag(text);
  const base: JournalAnalysis = {
    summary: null, sentiment: null, mood_label: null,
    concern_level: flagged ? "high" : "none", needs_human_review: flagged, themes: [], model: null, keyword_flag: flagged,
  };
  const r = await grok(env, {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text.slice(0, 6000) }],
    schema: { name: "journal_analysis", schema: SCHEMA },
    max_tokens: 400,
    temperature: 0.2,
  }, (t) => parseModelJson(t), "journal analysis");
  if (r) {
    const out = r.value, model = r.model;
    const level = ["none", "low", "moderate", "high"].includes(out.concern_level) ? out.concern_level : "low";
    const finalLevel = flagged ? "high" : level; // the model can raise concern, never lower the safety net
    return {
      summary: typeof out.summary === "string" ? out.summary.slice(0, 600) : null,
      sentiment: clamp(out.sentiment, -1, 1),
      mood_label: typeof out.mood_label === "string" ? out.mood_label.slice(0, 30).toLowerCase() : null,
      concern_level: finalLevel,
      needs_human_review: flagged || !!out.needs_human_review || finalLevel === "moderate" || finalLevel === "high",
      themes: Array.isArray(out.themes) ? out.themes.slice(0, 4).map((t: any) => String(t).slice(0, 30)) : [],
      model,
      keyword_flag: flagged,
    };
  }
  return base;
}

/**
 * Speech to text with xAI (POST /v1/stt, multipart). Container formats (webm, ogg, mp3, m4a, wav, ...) are
 * auto-detected by xAI. Throws when the key is missing or xAI errors; the caller reports it.
 */
export async function transcribe(env: AiEnv, audio: ArrayBuffer, contentType = "application/octet-stream"): Promise<{ text: string; duration?: number; model: string }> {
  if (!env.XAI_API_KEY) throw new XaiError(503, "XAI_API_KEY is not set");
  const model = env.XAI_STT_MODEL?.trim() || DEFAULT_STT_MODEL;
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([audio], { type: contentType }), "recording"); // the file must be the last field
  const res = await fetch(`${XAI_API_BASE}/stt`, {
    method: "POST", headers: { Authorization: `Bearer ${env.XAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new XaiError(res.status, `xAI speech-to-text ${res.status}`);
  const data: any = await res.json();
  return { text: String(data?.text ?? "").trim(), duration: typeof data?.duration === "number" ? data.duration : undefined, model };
}

/** Plain-language daily briefing so astronauts don't need medical training to read their dashboard. */
export async function dailyBriefing(env: AiEnv, facts: unknown): Promise<{ text: string; model: string } | null> {
  const r = await grok(env, {
    messages: [
      {
        role: "system",
        content: `You write a short daily health briefing for an astronaut on a space mission, from the JSON facts given.
4-6 short sentences, plain words, second person. Start with the overall status. Mention any yellow or red readings and the
recommended action given in the facts. Mention space weather or spacewalk status if present. If anything is red or escalated,
say the flight surgeon should be contacted. Do not invent numbers, do not diagnose, do not add advice that is not in the facts.`,
      },
      { role: "user", content: JSON.stringify(facts).slice(0, 8000) },
    ],
    max_tokens: 300,
    temperature: 0.3,
  }, (t) => t.trim() || null, "briefing");
  return r ? { text: r.value, model: r.model } : null;
}
