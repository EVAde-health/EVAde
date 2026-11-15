// Workers AI: journal analysis for the behavioral-health team, voice-to-text, and a plain-language daily briefing.
// All outputs are support for human review, never a diagnosis. Concerning journal language always reaches a human,
// even if the model is unavailable, through the keyword safety net below.

export const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const FALLBACK_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
export const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";

export interface AiEnv {
  AI?: Ai;
  AI_GATEWAY?: string; // optional AI Gateway id: logs, caching and rate limits for every model call
}

const runOpts = (env: AiEnv) => (env.AI_GATEWAY ? { gateway: { id: env.AI_GATEWAY } } : undefined);

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
  if (!env.AI) return base;
  const input = {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text.slice(0, 6000) }],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 400,
    temperature: 0.2,
  };
  for (const model of [TEXT_MODEL, FALLBACK_TEXT_MODEL]) {
    try {
      const out = parseModelJson(await env.AI.run(model as any, input as any, runOpts(env)));
      if (!out) continue;
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
    } catch (e) {
      console.log("journal analysis failed on", model, String(e));
    }
  }
  return base;
}

/** Speech to text with Whisper. Audio up to ~25 MB in one call. */
export async function transcribe(env: AiEnv, audio: ArrayBuffer): Promise<{ text: string; word_count?: number }> {
  if (!env.AI) throw new Error("Workers AI binding not configured");
  let bin = "";
  const bytes = new Uint8Array(audio);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res: any = await env.AI.run(STT_MODEL as any, { audio: btoa(bin), task: "transcribe", vad_filter: true } as any, runOpts(env));
  return { text: String(res?.text ?? "").trim(), word_count: res?.transcription_info?.duration ? undefined : res?.word_count };
}

/** Plain-language daily briefing so astronauts don't need medical training to read their dashboard. */
export async function dailyBriefing(env: AiEnv, facts: unknown): Promise<string | null> {
  if (!env.AI) return null;
  const input = {
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
  };
  for (const model of [TEXT_MODEL, FALLBACK_TEXT_MODEL]) {
    try {
      const r: any = await env.AI.run(model as any, input as any, runOpts(env));
      const text = typeof r?.response === "string" ? r.response.trim() : null;
      if (text) return text;
    } catch (e) {
      console.log("briefing failed on", model, String(e));
    }
  }
  return null;
}
