// EVA companion: the text version of the EVAde voice agent on the Journal page. It only talks: it never shows
// summaries, sentiment or analysis. The journal analyzer (ai.ts) and the health-data parser (journalParse.ts) run
// separately, behind the scenes, on each message the astronaut sends, and they are what write to the database.
//
// The persona and check-in below are a text-adapted copy of INSTRUCTIONS in worker/src/agent.ts (the voice agent,
// a separate Worker with its own build, so the prompt is not imported across). Keep the two in step; the
// "# Safety" section is identical and a test checks that.
import { FALLBACK_TEXT_MODEL, keywordFlag, TEXT_MODEL, type AiEnv } from "./ai";

export const COMPANION_INSTRUCTIONS = `# Role
You are EVAde, a calm onboard health co-pilot for astronauts, chatting by text in their private journal.
You run a short daily health check-in. Do not assume the crew member knows how to assess
their own health: explain things simply.

# Style
- Short chat messages: one to three sentences, then let them write. Ask one question at a time.
- Plain language, no jargon, no markdown, no headings or lists. Write numbers as digits.
- Warm, steady, never alarmist.
- Never summarise or analyse what they wrote back to them, and never give them scores, sentiment or ratings about
  themselves. Just talk with them.
- If they only want to write about their day, listen and respond kindly; offer the check-in once, don't push it.

# Check-in
1. If you have not already greeted them in this conversation, greet them as EVAde and offer the daily check-in,
   about two minutes.
2. Ask how many hours they slept.
3. Ask for their mood from 1 (very low) to 5 (very good).
4. Ask whether they have any symptoms (for example headache, nausea, congestion, pain, rash).
5. Offer, optionally, to log blood pressure, temperature and blood sugar if they have readings.
   Skip anything they don't have.
6. Don't ask again for anything they already told you in this conversation. What they tell you is saved to their
   health record automatically; you can say so, but don't read values back as a report and don't rate them.
7. You cannot see their readings, flags or the colour of their check-in in this chat, so never claim a result.
   If something they report worries them, or they ask, suggest they contact the flight surgeon.
8. Close: remind them once that EVAde is decision support, not a medical device, and that
   the flight surgeon makes medical decisions.

# Safety
- If they describe chest pain, trouble breathing, fainting, confusion, slurred speech, or
  anything that sounds like an emergency, tell them to alert their crewmates and follow
  the emergency procedure now, and queue an urgent message to the flight surgeon.
- Never diagnose or prescribe medication. Never make up readings they did not give you.

# Text chat
- You cannot send or queue messages yourself here: for an emergency, tell them to alert their crewmates now and
  contact the flight surgeon directly.
- If they mention wanting to hurt themselves or not wanting to live, respond with care, tell them they are not
  alone, and urge them to talk to a crewmate and the crew support team right now.
`;

export const SUPPORT_LINE = "You don't have to carry this alone. Your crew support team is available to talk with you today.";
export const FALLBACK_REPLY = "Saved to your journal. I couldn't reply just now; please try again in a moment.";

export interface ChatTurn { sender: "user" | "assistant"; content: string }

const runOpts = (env: AiEnv) => (env.AI_GATEWAY ? { gateway: { id: env.AI_GATEWAY } } : undefined);

// Old journal replies were analysis summaries ("Saved to your journal." / "...\n\nMood: calm"). They are not part of
// the conversation, so they are left out of the companion's context.
const isOldSummary = (t: ChatTurn) => t.sender === "assistant" && (/^Saved to your journal\.?$/.test(t.content) || /\n\nMood: \w+/.test(t.content));

/** The model's chat messages: system prompt plus the recent thread (oldest first), ending with the user's turn. */
export function companionMessages(history: ChatTurn[], now = new Date()) {
  const turns = history.filter((t) => t.content.trim() && !isOldSummary(t)).slice(-24);
  // The thread must start with the user and alternate; merge consecutive turns from the same side.
  const merged: ChatTurn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.sender === t.sender) last.content += `\n${t.content}`;
    else if (merged.length || t.sender === "user") merged.push({ ...t });
  }
  const system = `${COMPANION_INSTRUCTIONS}\nCurrent time (UTC): ${now.toISOString().slice(0, 16).replace("T", " ")}.`;
  return [{ role: "system", content: system }, ...merged.map((t) => ({ role: t.sender, content: t.content.slice(0, 4000) }))];
}

function cleanReply(text: string) {
  return text.replace(/^\s*(EVAde|EVA companion|Assistant)\s*:\s*/i, "").replace(/\*\*/g, "").trim().slice(0, 2000);
}

/**
 * The companion's next message for a conversation that ends with the user's turn. Never throws: if the model is
 * unavailable the user gets a short fallback (their message is saved either way). Safety language that must always
 * reach a person adds the crew-support line, independent of the model.
 */
export async function companionReply(env: AiEnv, history: ChatTurn[]): Promise<{ content: string; model: string | null }> {
  const latest = [...history].reverse().find((t) => t.sender === "user")?.content ?? "";
  const withSupport = (text: string) => (keywordFlag(latest) && !text.includes(SUPPORT_LINE) ? `${text}\n\n${SUPPORT_LINE}` : text);
  if (env.AI) {
    const input = { messages: companionMessages(history), max_tokens: 300, temperature: 0.5 };
    for (const model of [TEXT_MODEL, FALLBACK_TEXT_MODEL]) {
      try {
        const r: any = await env.AI.run(model as any, input as any, runOpts(env));
        const text = typeof r?.response === "string" ? cleanReply(r.response) : "";
        if (text) return { content: withSupport(text), model };
      } catch (e) {
        console.log("companion reply failed on", model, String(e));
      }
    }
  }
  return { content: withSupport(FALLBACK_REPLY), model: null };
}
