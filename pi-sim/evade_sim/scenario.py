"""Scenario timelines: which events happen when. JSON so the Pi needs no extra packages.

{
  "name": "demo",
  "duration_s": 1800,
  "time_scale": 1.0,                    # >1 runs the scenario faster than real time
  "seed": 7,
  "baseline": {"fast": true},           # synthesize the baseline instantly with past timestamps
  "events": [
    {"type": "tachycardia", "start_s": 300, "end_s": 420, "hr": 150},
    {"type": "seizure", "start_s": 600, "end_s": 660}
  ]
}
Event types: tachycardia (hr), arrhythmia (irregular), hrv_drop, hypoxia, seizure, mi_pattern (st_mv), poor_sleep,
stress, spe (peak_pfu; solar particle event with a preceding flare). Times are scenario seconds.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

EVENT_TYPES = {"tachycardia", "arrhythmia", "hrv_drop", "hypoxia", "seizure", "mi_pattern", "poor_sleep", "stress", "spe"}


@dataclass
class Scenario:
    name: str = "demo"
    duration_s: float = 1800.0
    time_scale: float = 1.0
    seed: int = 7
    baseline_fast: bool = True
    events: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path) -> "Scenario":
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        ev = d.get("events", [])
        for e in ev:
            if e.get("type") not in EVENT_TYPES:
                raise ValueError(f"unknown event type {e.get('type')!r}; allowed: {sorted(EVENT_TYPES)}")
            if not 0 <= float(e["start_s"]) < float(e.get("end_s", e["start_s"] + 1)):
                raise ValueError(f"bad times in event {e}")
        return cls(name=d.get("name", Path(path).stem), duration_s=float(d.get("duration_s", 1800)),
                   time_scale=float(d.get("time_scale", 1.0)), seed=int(d.get("seed", 7)),
                   baseline_fast=bool(d.get("baseline", {}).get("fast", True)), events=ev)

    def active(self, t: float) -> dict[str, dict]:
        """Events active at scenario time t, by type."""
        return {e["type"]: e for e in self.events if float(e["start_s"]) <= t < float(e.get("end_s", e["start_s"] + 1))}

    def state_at(self, t: float) -> dict:
        """Physiological knobs at scenario time t."""
        a = self.active(t)
        spe = next((e for e in self.events if e["type"] == "spe"), None)
        return {
            "hr": float(a["tachycardia"].get("hr", 150)) if "tachycardia" in a else 68.0,
            "irregular": 0.25 if "arrhythmia" in a else 0.0,
            "hrv_ms": 8.0 if "hrv_drop" in a else 45.0,
            "hypoxia": "hypoxia" in a,
            "seizure": 1.0 if "seizure" in a else 0.0,
            "st_mv": float(a["mi_pattern"].get("st_mv", 0.25)) if "mi_pattern" in a else 0.0,
            "poor_sleep": "poor_sleep" in a,
            "stressed": "stress" in a,
            "spe_start_s": float(spe["start_s"]) if spe else None,
            "spe_peak_pfu": float(spe.get("peak_pfu", 500)) if spe else 500.0,
            "events": sorted(a),
        }
