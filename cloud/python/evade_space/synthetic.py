"""Synthetic astronaut mission data for the demo (every record is labelled source='synthetic').

Trends are shaped after published spaceflight findings (approximate):
  - bone mineral density about -1% per month in weightlessness
  - in-flight sleep around 6 h per night
  - core body temperature drifting up by up to ~1 °C over months (Stahn et al. 2017)
  - small early-mission heart-rate rise from fluid shift, then adaptation
  - body mass slowly falling when intake lags
Real crew data are not public at this resolution, so these series are illustrative only.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

from . import radiation

PROFILES = {
    "nominal": {},
    "sleep_debt": {"sleep_shift": -1.4, "mood_shift": -1.0, "stress_shift": 1.2, "hr_shift": 6, "hrv_shift": -12},
    "solar_storm": {"spe_day": True},
    "fever": {"temp_shift": 1.3, "hr_shift": 18, "spo2_shift": -2},
}


def _clip(v, lo, hi):
    return max(lo, min(hi, v))


def generate_mission(days: int = 30, environment: str = "station", *, seed: int = 7,
                     event: str | None = None, event_day: int | None = None,
                     end: datetime | None = None) -> dict:
    """Return {'observations': [...], 'radiation': [...], 'self_reports': [...]} ending at `end` (default now).

    event: one of PROFILES ('sleep_debt', 'solar_storm', 'fever') applied for 3 days from event_day
    (default: the last 3 days, so the dashboard shows it).
    """
    rng = random.Random(seed)
    end = end or datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days)
    event_day = days - 3 if event_day is None else event_day
    obs, rad, self_reports = [], [], []
    cumulative = 0.0

    for d in range(days):
        day0 = start + timedelta(days=d)
        ev = PROFILES.get(event, {}) if event and event_day <= d < event_day + 3 else {}
        g = lambda key: ev.get(key, 0.0)  # noqa: E731
        months = d / 30.0
        adapt = math.exp(-d / 10)  # early-mission fluid-shift effect fading

        def add(metric, value, hour, unit=None, quality=None):
            o = {"metric": metric, "value": round(value, 2), "ts": (day0 + timedelta(hours=hour)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "source": "synthetic", "client_id": f"syn-{seed}-{metric}-{d}"}
            if quality is not None:
                o["quality"] = quality
            obs.append(o)

        add("sleep_hours", _clip(rng.gauss(6.3, 0.6) + g("sleep_shift"), 3, 10), 7)
        add("heart_rate", _clip(rng.gauss(62, 3) + 6 * adapt + g("hr_shift"), 40, 150), 7.5)
        add("hrv_rmssd", _clip(rng.gauss(48, 6) + g("hrv_shift"), 10, 150), 7.6)
        add("systolic_bp", _clip(rng.gauss(116, 5) - 4 * adapt, 85, 170), 8)
        add("diastolic_bp", _clip(rng.gauss(74, 4), 50, 110), 8)
        add("spo2", _clip(rng.gauss(97.5, 0.6) + g("spo2_shift"), 85, 100), 8.2, quality=0.95)
        add("body_temp", _clip(rng.gauss(36.8, 0.15) + min(0.6, 0.3 * months) + g("temp_shift"), 35, 41), 8.3)
        add("respiration_rate", _clip(rng.gauss(15, 1.2), 8, 30), 8.4)
        add("blood_glucose", _clip(rng.gauss(90, 6), 55, 200), 8.5)
        if d % 7 == 0:
            add("body_mass_change_pct", -0.4 * months + rng.gauss(0, 0.2), 9)
        if d % 14 == 0:
            add("bone_density_change_pct", -1.0 * months + rng.gauss(0, 0.2), 10)

        mood = int(_clip(round(rng.gauss(4, 0.6) + g("mood_shift")), 1, 5))
        stress = int(_clip(round(rng.gauss(2.2, 0.6) + g("stress_shift")), 1, 5))
        self_reports.append({"ts": (day0 + timedelta(hours=7.2)).strftime("%Y-%m-%dT%H:%M:%SZ"), "mood": mood,
                             "stress": stress, "fatigue": int(_clip(round(rng.gauss(2.5, 0.7)), 1, 5)),
                             "client_id": f"syn-{seed}-sr-{d}", "source": "synthetic"})

        pfu = 300.0 if ev.get("spe_day") else None
        daily = radiation.daily_dose(environment, proton_pfu=pfu) * rng.uniform(0.9, 1.1)
        cumulative += daily
        rad.append({"ts": (day0 + timedelta(hours=23)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "daily_dose_msv": round(daily, 3), "cumulative_msv": round(cumulative, 2),
                    "dose_rate_usv_h": radiation.dose_rate_usv_h(daily), "spe_flag": bool(pfu),
                    "location": environment, "source": "synthetic", "client_id": f"syn-{seed}-rad-{d}"})

    return {"observations": obs, "radiation": rad, "self_reports": self_reports}
