import { beforeEach, describe, expect, it } from "vitest";
import { HANDLERS, latestCheckin, listDownlink, queueFlightSurgeonMessage, runTool, saveCheckin, TOOLS } from "../src/tools";
import { resetDb, testEnv, toolCtx } from "./helpers";

const db = () => testEnv.DB;

describe("voice tools (api/voice_tools.py)", () => {
  beforeEach(resetDb);

  it("green check-in saved", async () => {
    const out = await saveCheckin(toolCtx(), "+1555", { sleep_hours: 7.5, mood: 4, symptoms: [], systolic: 118,
      diastolic: 76, temperature: 36.8, blood_sugar_mg_dl: 90 });
    expect(out.level).toBe("green");
    expect(out.checkin_id).toBe(1);
    expect(out.reminder).toContain("not a medical device");
    const row = await db().prepare("SELECT crew_id, source, level, sleep_hours, created_at FROM checkins").first<Record<string, unknown>>();
    expect(row).toMatchObject({ crew_id: "+1555", source: "voice", level: "green", sleep_hours: 7.5 });
    expect(String(row!.created_at)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00$/);
  });

  it("yellow check-in has reasons and actions", async () => {
    const out = await saveCheckin(toolCtx(), "+1555", { sleep_hours: 5, mood: 3, symptoms: ["mild headache"] });
    expect(out.level).toBe("yellow");
    expect((out.reasons as string[]).some((r) => r.includes("5 hours"))).toBe(true);
    expect((out.reasons as string[]).some((r) => r.includes("headache"))).toBe(true);
    expect((out.actions as string[]).length).toBeGreaterThan(0);
  });

  it("red check-in from red-flag symptom (comma string)", async () => {
    const out = await saveCheckin(toolCtx(), "+1555", { sleep_hours: 7, mood: 3, symptoms: "chest pain, nausea" });
    expect(out.level).toBe("red");
    expect((out.actions as string[])[0]).toBe("Send this check-in to the flight surgeon.");
  });

  it("Fahrenheit temperature is converted", async () => {
    const out = await saveCheckin(toolCtx(), "+1555", { sleep_hours: 8, mood: 4, temperature: 101.2 });
    expect(out.level).toBe("yellow");
    const row = await db().prepare("SELECT temperature_c FROM checkins").first<{ temperature_c: number }>();
    expect(row!.temperature_c).toBe(38.4);
  });

  it("mood is clamped and bad numbers ignored like _num()", async () => {
    await saveCheckin(toolCtx(), "c", { sleep_hours: "8", mood: 9, systolic: "abc", diastolic: "7.5" });
    const row = await db().prepare("SELECT sleep_hours, mood, systolic, diastolic FROM checkins").first();
    expect(row).toEqual({ sleep_hours: 8, mood: 5, systolic: null, diastolic: null });
  });

  it("personal baseline flags a drop, per crew member", async () => {
    for (let i = 0; i < 3; i++) await saveCheckin(toolCtx(), "crew-a", { sleep_hours: 8.5, mood: 4 });
    const out = await saveCheckin(toolCtx(), "crew-a", { sleep_hours: 6.5, mood: 4 });
    expect(out.level).toBe("yellow");
    expect((out.reasons as string[]).some((r) => r.includes("your own recent average"))).toBe(true);
    expect((await saveCheckin(toolCtx(), "crew-b", { sleep_hours: 6.5, mood: 4 })).level).toBe("green");
  });

  it("downlink queue insert modes", async () => {
    const online = await queueFlightSurgeonMessage(toolCtx(), "+1555", { message: "Red check-in", priority: "urgent", checkin_id: 3 });
    expect(online).toMatchObject({ status: "sent", comms_mode: "online", summary: "Sent to the flight surgeon now." });
    const mars = await queueFlightSurgeonMessage(toolCtx(), "+1555", { message: "m", priority: "routine", comms_mode: "mars" });
    expect(mars.status).toBe("in_transit");
    expect(mars.arrives_at).toBeTruthy();
    const black = await queueFlightSurgeonMessage(toolCtx({ EVADE_COMMS_MODE: "blackout" }), "+1555", { message: "b", priority: "routine" });
    expect(black.status).toBe("queued");
    expect(black.arrives_at).toBeNull();
    const { results } = await db().prepare("SELECT crew_id, priority, message, checkin_id, comms_mode, status FROM downlink_queue ORDER BY id").all();
    expect(results[0]).toEqual({ crew_id: "+1555", priority: "urgent", message: "Red check-in", checkin_id: 3, comms_mode: "online", status: "sent" });
    expect(results.map((r) => r.comms_mode)).toEqual(["online", "mars", "blackout"]);
  });

  it("downlink defaults: bad priority/mode fall back, empty message gets default text", async () => {
    const out = await queueFlightSurgeonMessage(toolCtx(), "x", { message: "  ", priority: "ASAP", comms_mode: "moon" });
    expect(out).toMatchObject({ comms_mode: "online", status: "sent" });
    const row = await db().prepare("SELECT priority, message FROM downlink_queue").first();
    expect(row).toEqual({ priority: "routine", message: "Crew member requested contact." });
  });

  it("run_tool handles JSON and errors", async () => {
    expect((await runTool(toolCtx(), "save_checkin", "x", JSON.stringify({ sleep_hours: 8, mood: 5 }))).level).toBe("green");
    expect(await runTool(toolCtx(), "nope", "x", "{}")).toHaveProperty("error");
    expect(await runTool(toolCtx(), "save_checkin", "x", "{not json")).toEqual({ error: "Arguments were not valid JSON." });
    expect(await runTool(toolCtx(), "save_checkin", "x", { sleep_hours: 8, mood: 4, symptoms: 5 })).toHaveProperty("error");
  });

  it("tool schemas shape", () => {
    expect(new Set(TOOLS.map((t) => t.name))).toEqual(new Set(Object.keys(HANDLERS)));
    for (const t of TOOLS) {
      expect(t.type).toBe("function");
      expect(t.parameters.type).toBe("object");
    }
  });

  it("read helpers: latest check-in and downlink list", async () => {
    expect(await latestCheckin(db())).toBeNull();
    await saveCheckin(toolCtx(), "a", { sleep_hours: 8, mood: 4 });
    await saveCheckin(toolCtx(), "b", { sleep_hours: 3, mood: 2 });
    const latest = await latestCheckin(db());
    expect(latest).toMatchObject({ crew_id: "b", level: "red" });
    expect(Array.isArray(latest!.reasons)).toBe(true);
    expect((await latestCheckin(db(), "a"))!.level).toBe("green");
    await queueFlightSurgeonMessage(toolCtx(), "a", { message: "m1", priority: "routine" });
    await queueFlightSurgeonMessage(toolCtx(), "a", { message: "m2", priority: "urgent" });
    expect((await listDownlink(db(), 10)).map((m) => m.message)).toEqual(["m2", "m1"]);
    expect(await listDownlink(db(), 500)).toHaveLength(2);
  });
});
