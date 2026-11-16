import { describe, expect, it } from "vitest";
import { fmtFixed, fmtG, round1 } from "../src/pyfmt";
import { assess, normaliseTemperatureC } from "../src/rules";

describe("checkin rules (models/checkin_rules.py)", () => {
  it("red from vitals", () => {
    expect(assess({ systolic: 185, diastolic: 100 }).level).toBe("red");
    expect(assess({ temperature_c: 39.6 }).level).toBe("red");
    expect(assess({ blood_sugar_mg_dl: 50 }).level).toBe("red");
    expect(assess({ sleep_hours: 3 }).level).toBe("red");
    expect(assess({ mood: 1 }).level).toBe("red");
  });

  it("green with the default reason and action when nothing is flagged", () => {
    const r = assess({ sleep_hours: 8, mood: 4, systolic: 118, diastolic: 76, temperature_c: 36.8, blood_sugar_mg_dl: 90 });
    expect(r).toEqual({
      level: "green", findings: [],
      reasons: ["Everything you reported is within normal reference ranges."],
      actions: ["Keep your usual routine and check in again tomorrow."],
    });
  });

  it("orders actions by severity, dedupes, and prepends the red action", () => {
    const r = assess({ sleep_hours: 5, symptoms: ["chest pain"] });
    expect(r.level).toBe("red");
    expect(r.actions[0]).toBe("Send this check-in to the flight surgeon.");
    expect(r.actions[1]).toBe("Stop what you are doing and tell a crewmate.");
    expect(r.reasons[0]).toBe("You slept about 5 hours. Adults need about 7 or more, so you may be slower and more error-prone today.");
    expect(r.reasons[1]).toBe("'chest pain' can be a sign of a serious problem.");
  });

  it("matches Python reason text for every metric band", () => {
    expect(assess({ sleep_hours: 3.5 }).reasons[0]).toBe("You slept about 3.5 hours. Under 4 hours seriously affects reaction time and judgement.");
    expect(assess({ sleep_hours: 6.5, baseline_sleep: 8.5 }).reasons[0]).toBe("That's 2.0 hours less than your own recent average of 8.5 hours.");
    expect(assess({ mood: 2 }).reasons[0]).toBe("You rated your mood 2 out of 5, which is low.");
    expect(assess({ mood: 2, baseline_mood: 4 }).reasons[1]).toBe("That's well below your usual mood of about 4.0.");
    expect(assess({ systolic: 85, diastolic: 70 }).reasons[0]).toContain("is low (under 90 over 60)");
    expect(assess({ systolic: 145, diastolic: 85 }).reasons[0]).toBe("Blood pressure 145 over 85 is high (stage 2, 140 over 90 or higher).");
    expect(assess({ systolic: 132, diastolic: 78 }).reasons[0]).toBe("Blood pressure 132 over 78 is mildly high (stage 1, 130 over 80 or higher).");
    expect(assess({ temperature_c: 34.2 }).reasons[0]).toBe("Temperature 34.2 °C is below 35 °C (hypothermia range).");
    expect(assess({ temperature_c: 38.4 }).reasons[0]).toBe("Temperature 38.4 °C is a fever (38 °C or higher).");
    expect(assess({ temperature_c: 37.5 }).reasons[0]).toBe("Temperature 37.5 °C is slightly raised.");
    expect(assess({ blood_sugar_mg_dl: 260 }).reasons[0]).toBe("Blood sugar 260 mg/dL is very high (250 or more).");
    expect(assess({ blood_sugar_mg_dl: 65.5 }).reasons[0]).toBe("Blood sugar 65.5 mg/dL is low (under 70).");
    expect(assess({ blood_sugar_mg_dl: 130 }).reasons[0]).toBe("Blood sugar 130 mg/dL is high (126 or more if fasting).");
    expect(assess({ symptoms: ["none", " ", "Mild headache"] }).reasons).toEqual(["You reported 'Mild headache'."]);
  });

  it("mood baseline does not double-flag a mood of 1; sleep baseline skipped when already red", () => {
    expect(assess({ mood: 1, baseline_mood: 4 }).findings).toHaveLength(1);
    expect(assess({ sleep_hours: 3, baseline_sleep: 8 }).findings).toHaveLength(1);
  });

  it("normalises Fahrenheit and rounds to one decimal", () => {
    expect(normaliseTemperatureC(101.2)).toBe(38.4);
    expect(normaliseTemperatureC(36.84)).toBe(36.8);
    expect(normaliseTemperatureC(null)).toBeNull();
  });

  it("Python number formatting helpers", () => {
    expect(fmtG(5)).toBe("5");
    expect(fmtG(5.5)).toBe("5.5");
    expect(fmtG(7.25)).toBe("7.25");
    expect(fmtG(1234567)).toBe("1.23457e+06");
    expect(fmtFixed(2)).toBe("2.0");
    expect(fmtFixed(0.25)).toBe("0.2"); // half-even like Python
    expect(round1(38.44)).toBe(38.4);
  });
});
