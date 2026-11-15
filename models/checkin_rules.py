"""Daily check-in rules used by the voice agent.

STAND-IN: these are simple, explainable rules built on *standard clinical
reference ranges* (not spaceflight-specific ones). When the team's real
`models/checkin_rules.py` lands, keep the `assess()` signature and return shape
(or adapt `api/voice_tools.py`) and delete this file.

Design principle: we do not assume astronauts know how to assess their health,
so every finding carries a plain-language *reason* and concrete *actions*.

Reference ranges used (adult, resting):
- Blood pressure: AHA categories. Normal < 120/80, stage 1 130-139/80-89,
  stage 2 >= 140/90, crisis >= 180/120. Low (hypotension) < 90/60.
- Temperature: normal ~36.1-37.2 C, fever >= 38.0 C, high fever >= 39.4 C,
  hypothermia < 35.0 C.
- Blood sugar (mg/dL): normal fasting 70-99, hypoglycaemia < 70,
  serious hypoglycaemia < 54, very high >= 250.
- Sleep: adults need 7+ h; < 6 h is short, < 4 h is severely short.
- Mood: self-rated 1 (very low) to 5 (very good).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

GREEN, YELLOW, RED = "green", "yellow", "red"
_RANK = {GREEN: 0, YELLOW: 1, RED: 2}

# Symptoms that should always escalate to red.
RED_FLAG_SYMPTOMS = (
    "chest pain", "chest pressure", "shortness of breath", "can't breathe",
    "cannot breathe", "difficulty breathing", "trouble breathing", "fainted",
    "fainting", "passed out", "confusion", "confused", "slurred speech",
    "seizure", "vision loss", "loss of vision", "worst headache",
    "severe headache", "numbness on one side", "weakness on one side",
    "coughing blood", "vomiting blood", "severe bleeding",
)


@dataclass
class Finding:
    level: str
    metric: str
    reason: str
    actions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"level": self.level, "metric": self.metric,
                "reason": self.reason, "actions": self.actions}


def _fahrenheit_to_celsius(value: float) -> float:
    return (value - 32.0) * 5.0 / 9.0


def normalise_temperature_c(value: Optional[float]) -> Optional[float]:
    """Accept C or F; anything above 45 is treated as Fahrenheit."""
    if value is None:
        return None
    value = float(value)
    return round(_fahrenheit_to_celsius(value), 1) if value > 45 else round(value, 1)


def _sleep(hours: Optional[float], baseline: Optional[float]) -> list[Finding]:
    if hours is None:
        return []
    out = []
    if hours < 4:
        out.append(Finding(RED, "sleep", f"You slept about {hours:g} hours. Under 4 hours "
                           "seriously affects reaction time and judgement.",
                           ["Avoid EVA, robotics or other safety-critical tasks today if you can.",
                            "Plan a nap or an earlier sleep period tonight.",
                            "Tell the flight surgeon so the schedule can be adjusted."]))
    elif hours < 6:
        out.append(Finding(YELLOW, "sleep", f"You slept about {hours:g} hours. Adults need "
                           "about 7 or more, so you may be slower and more error-prone today.",
                           ["Double-check critical procedures today.",
                            "Dim lights and screens an hour before your next sleep period."]))
    if baseline is not None and hours <= baseline - 1.5 and not any(f.level == RED for f in out):
        out.append(Finding(YELLOW, "sleep", f"That's {baseline - hours:.1f} hours less than "
                           f"your own recent average of {baseline:.1f} hours.",
                           ["Watch for a pattern: if it happens again tomorrow, report it."]))
    return out


def _mood(mood: Optional[int], baseline: Optional[float]) -> list[Finding]:
    if mood is None:
        return []
    out = []
    if mood <= 1:
        out.append(Finding(RED, "mood", "You rated your mood 1 out of 5, the lowest score.",
                           ["Talk to a crewmate you trust today.",
                            "Request a private conference with the flight surgeon or psychologist."]))
    elif mood == 2:
        out.append(Finding(YELLOW, "mood", "You rated your mood 2 out of 5, which is low.",
                           ["Take a short break, exercise or contact family if the schedule allows.",
                            "If it stays low for a few days, tell the flight surgeon."]))
    if baseline is not None and mood <= baseline - 1.5 and mood > 1:
        out.append(Finding(YELLOW, "mood", f"That's well below your usual mood of about {baseline:.1f}.",
                           ["Notice what changed; a quick note in your journal helps the flight surgeon."]))
    return out


def _bp(sys_: Optional[int], dia: Optional[int]) -> list[Finding]:
    if sys_ is None or dia is None:
        return []
    reading = f"{sys_} over {dia}"
    if sys_ >= 180 or dia >= 120:
        return [Finding(RED, "blood_pressure", f"Blood pressure {reading} is in the "
                        "hypertensive crisis range (180 over 120 or higher).",
                        ["Sit quietly for 5 minutes and measure again.",
                         "If it is still this high, or you have chest pain, headache or vision changes, "
                         "contact the flight surgeon now."])]
    if sys_ < 90 or dia < 60:
        return [Finding(YELLOW, "blood_pressure", f"Blood pressure {reading} is low (under 90 over 60). "
                        "After weeks in microgravity this can cause light-headedness.",
                        ["Drink fluids and stand up slowly.", "Re-measure in an hour."])]
    if sys_ >= 140 or dia >= 90:
        return [Finding(YELLOW, "blood_pressure", f"Blood pressure {reading} is high (stage 2, "
                        "140 over 90 or higher).",
                        ["Rest 5 minutes and re-measure.", "Mention it in today's report to the flight surgeon."])]
    if sys_ >= 130 or dia >= 80:
        return [Finding(YELLOW, "blood_pressure", f"Blood pressure {reading} is mildly high "
                        "(stage 1, 130 over 80 or higher).",
                        ["Re-measure tomorrow at the same time of day."])]
    return []


def _temperature(temp_c: Optional[float]) -> list[Finding]:
    if temp_c is None:
        return []
    if temp_c >= 39.4:
        return [Finding(RED, "temperature", f"Temperature {temp_c:.1f} °C is a high fever.",
                        ["Rest and drink fluids.", "Contact the flight surgeon now.",
                         "Limit close contact with crewmates."])]
    if temp_c < 35.0:
        return [Finding(RED, "temperature", f"Temperature {temp_c:.1f} °C is below 35 °C (hypothermia range).",
                        ["Re-measure to rule out a bad reading.", "Warm up and contact the flight surgeon."])]
    if temp_c >= 38.0:
        return [Finding(YELLOW, "temperature", f"Temperature {temp_c:.1f} °C is a fever (38 °C or higher).",
                        ["Rest, drink fluids and re-measure in 4 hours.",
                         "Note any other symptoms; latent viruses can reactivate in spaceflight."])]
    if temp_c >= 37.3:
        return [Finding(YELLOW, "temperature", f"Temperature {temp_c:.1f} °C is slightly raised.",
                        ["Re-measure later today."])]
    return []


def _glucose(mg_dl: Optional[float]) -> list[Finding]:
    if mg_dl is None:
        return []
    if mg_dl < 54:
        return [Finding(RED, "blood_sugar", f"Blood sugar {mg_dl:g} mg/dL is seriously low (under 54).",
                        ["Take 15 g of fast sugar now (juice or glucose tablets) and re-check in 15 minutes.",
                         "Tell a crewmate and the flight surgeon."])]
    if mg_dl >= 250:
        return [Finding(RED, "blood_sugar", f"Blood sugar {mg_dl:g} mg/dL is very high (250 or more).",
                        ["Drink water and re-check.", "Contact the flight surgeon."])]
    if mg_dl < 70:
        return [Finding(YELLOW, "blood_sugar", f"Blood sugar {mg_dl:g} mg/dL is low (under 70).",
                        ["Eat a snack with sugar and re-check in 15 minutes."])]
    if mg_dl >= 126:
        return [Finding(YELLOW, "blood_sugar", f"Blood sugar {mg_dl:g} mg/dL is high (126 or more if fasting).",
                        ["Re-check fasting tomorrow morning."])]
    return []


def _symptoms(symptoms: Iterable[str]) -> list[Finding]:
    out = []
    for s in symptoms:
        text = (s or "").strip()
        if not text:
            continue
        low = text.lower()
        if low in ("none", "no", "nothing", "no symptoms"):
            continue
        if any(flag in low for flag in RED_FLAG_SYMPTOMS):
            out.append(Finding(RED, "symptom", f"'{text}' can be a sign of a serious problem.",
                               ["Stop what you are doing and tell a crewmate.",
                                "Contact the flight surgeon now."]))
        else:
            out.append(Finding(YELLOW, "symptom", f"You reported '{text}'.",
                               ["Keep an eye on it and mention it if it gets worse or lasts more than a day."]))
    return out


def assess(*, sleep_hours: Optional[float] = None, mood: Optional[int] = None,
           symptoms: Iterable[str] = (), systolic: Optional[int] = None,
           diastolic: Optional[int] = None, temperature_c: Optional[float] = None,
           blood_sugar_mg_dl: Optional[float] = None,
           baseline_sleep: Optional[float] = None,
           baseline_mood: Optional[float] = None) -> dict:
    """Return {"level", "findings", "reasons", "actions"} for one check-in."""
    findings: list[Finding] = []
    findings += _sleep(sleep_hours, baseline_sleep)
    findings += _mood(mood, baseline_mood)
    findings += _bp(systolic, diastolic)
    findings += _temperature(temperature_c)
    findings += _glucose(blood_sugar_mg_dl)
    findings += _symptoms(symptoms)

    level = GREEN
    for f in findings:
        if _RANK[f.level] > _RANK[level]:
            level = f.level

    actions: list[str] = []
    for f in sorted(findings, key=lambda f: -_RANK[f.level]):
        for a in f.actions:
            if a not in actions:
                actions.append(a)
    if level == RED:
        actions.insert(0, "Send this check-in to the flight surgeon.")
    if not findings:
        reasons = ["Everything you reported is within normal reference ranges."]
        actions = ["Keep your usual routine and check in again tomorrow."]
    else:
        reasons = [f.reason for f in findings]

    return {"level": level, "findings": [f.as_dict() for f in findings],
            "reasons": reasons, "actions": actions}
