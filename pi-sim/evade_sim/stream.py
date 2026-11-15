"""Stream synthetic inputs for every EVAde model endpoint, in real time (or faster), over Wi-Fi/HTTP.

  EVADE_API_KEY=... python -m evade_sim.stream --api https://<staging api> --scenario scenarios/demo.json

What it sends (scenario seconds; scale with "time_scale" in the scenario):
  setup      POST /v1/users, /v1/devices/bind (kind "simulated"), baselines for ECG, EEG and vitals
  every 10 s /v1/ingest/batch (vitals + 1-lead ECG window), /v1/predict/ecg, /v1/predict/eeg, /v1/predict/seizure-deep
  every 30 s /v1/predict/ecg-deep (12-lead, 500 Hz, 10 s)
  every 60 s /v1/predict/space-weather (48 h of GOES-like data), /v1/predict/radiation-risk, /v1/predict/risk
  every 5 min /v1/predict/sleep-deep (10 x 30 s epochs, Fpz-Cz + Pz-Oz)
  every 15 min /v1/input/self-report
Every call is timed into a CSV log (endpoint, status, latency, flag, active events). No signal values, no keys.
--dry-run builds every payload once and prints its size, with no network calls.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import payloads as P
from . import signals as S
from .scenario import Scenario

ECG_FS, ECG12_FS, EEG_FS, WIN_S = 250.0, 500.0, 256.0, 10.0
PERIODS = {"fast": 10.0, "ecg_deep": 30.0, "env": 60.0, "sleep": 300.0, "self_report": 900.0}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def flag_ecg(d):
    return (d.get("rhythm") or {}).get("flag") or ""


def flag_eeg(d):
    return (d.get("seizure") or {}).get("flag") or ""


def flag_deep(d):
    if "flag" in d:
        return d.get("flag") or ""
    top = d.get("top_classes") or []
    if top:
        return "+".join(c["class"] for c in top)
    summ = d.get("summary") or {}
    return f"eff={summ.get('sleep_efficiency')}" if summ else ""


def flag_risk(d):
    r = d.get("risk") or {}
    return f"{r.get('band', '')}{'!' if r.get('flag') else ''}"


def flag_any(d):
    for k in ("level", "flag"):
        if isinstance(d.get(k), str):
            return d[k]
    o5 = d.get("o5") or {}
    if isinstance(o5, dict) and o5.get("candidate"):
        return "O5_candidate"
    now = d.get("nowcast") or {}
    if isinstance(now, dict):
        for k in ("s_scale", "s_level", "level", "s"):
            if now.get(k) not in (None, ""):
                return f"S{now[k]}" if isinstance(now[k], int) else str(now[k])
    return ""


class Sim:
    def __init__(self, scen: Scenario, api=None, only: set[str] | None = None):
        self.s, self.api, self.only = scen, api, only
        self.rng = np.random.default_rng(scen.seed)
        self.st = {k: {"t": 0.0} for k in ("ecg", "ecg12", "ppg", "eeg", "eeg2")}
        self.user = None
        self.device = f"pi-sim-{uuid.uuid4().hex[:8]}"
        self.seq = 0
        self.dose = 0.0

    def want(self, name: str) -> bool:
        return self.only is None or name in self.only

    # ------------------------------------------------------------ signal blocks (advance each stream's clock)
    def _block(self, key, fn, seconds, **kw):
        st = self.st[key]
        x = fn(self.rng, st, seconds, **kw)
        st["t"] += seconds
        return x

    def ecg1(self, k):
        return self._block("ecg", lambda r, s, sec: S.ecg(r, s, sec, ECG_FS, hr=k["hr"], hrv_ms=k["hrv_ms"],
                                                          irregular=k["irregular"]), WIN_S)

    def ecg12(self, k):
        return self._block("ecg12", lambda r, s, sec: S.ecg(r, s, sec, ECG12_FS, hr=k["hr"], leads=S.ECG_LEADS,
                                                            hrv_ms=k["hrv_ms"], irregular=k["irregular"],
                                                            st_elevation_mv=k["st_mv"]), WIN_S)

    def eeg18(self, k):
        return self._block("eeg", lambda r, s, sec: S.eeg_bipolar(r, s, sec, EEG_FS, seizure=k["seizure"]), WIN_S)

    # ------------------------------------------------------------ setup
    def setup(self, user_id: str | None = None) -> None:
        self.user = self.api.create_user(user_id)
        self.api.call("POST", "/v1/devices/bind", {"user_id": self.user, "device_id": self.device, "kind": "simulated",
                                                    "vendor": "evade-sim", "model": "raspberry-pi"})
        calm = self.s.state_at(-1.0)
        start = _now() - timedelta(seconds=40 * WIN_S)
        # ECG baseline: 30 x 10 s windows (demo mode locks at 30), past timestamps
        wins = [P.window("ecg", start + timedelta(seconds=i * WIN_S), ECG_FS, ["II"], self.ecg1(calm), "mv")
                for i in range(30)]
        if self.want("ecg"):
            self.api.call("POST", "/v1/baseline/ecg", {"user_id": self.user, "windows": wins, "mode": "demo"})
        # EEG baseline: 12 x 10 s 18-channel windows = 30 four-second sub-windows (the seizure model's minimum)
        if self.want("eeg"):
            for c in range(4):
                ws = [P.window("eeg", start + timedelta(seconds=(c * 3 + i) * WIN_S), EEG_FS, S.BIPOLAR_18,
                               self.eeg18(calm), "uv", decimals=1) for i in range(3)]
                self.api.call("POST", "/v1/baseline/eeg", {"user_id": self.user, "windows": ws, "mode": "demo"})
        rd = []
        for i in range(12):
            rd += P.readings(start + timedelta(seconds=i * 30), S.vitals(self.rng, hr=calm["hr"]))
        self.api.call("POST", "/v1/baseline/vitals", {"user_id": self.user, "readings": rd, "mode": "demo"})
        print(f"setup done: simulated user {self.user[:8]}..., device {self.device}, baselines sent")

    # ------------------------------------------------------------ periodic tasks
    def fast(self, t, k):
        now = _now()
        t0 = now - timedelta(seconds=WIN_S)
        ev = k["events"]
        x = self.ecg1(k)
        if self.want("ingest"):
            body = {"user_id": self.user, "device_id": self.device, "seq": self.seq, "battery_pct": 80.0,
                    "readings": P.readings(now, S.vitals(self.rng, hr=k["hr"], hypoxia=k["hypoxia"],
                                                         stressed=k["stressed"])),
                    "windows": [P.window("ecg", t0, ECG_FS, ["II"], x, "mv", device_id=self.device)]}
            self.seq += 1
            self.api.call("POST", "/v1/ingest/batch", body, scen_t=t, events=ev)
        if self.want("ecg"):
            self.api.call("POST", "/v1/predict/ecg", P.ecg_request(self.user, t0, x, ECG_FS), scen_t=t, events=ev,
                          flag_of=flag_ecg)
        e = self.eeg18(k)
        if self.want("eeg"):
            self.api.call("POST", "/v1/predict/eeg", P.eeg_request(self.user, t0, e, EEG_FS), scen_t=t, events=ev,
                          flag_of=flag_eeg)
        if self.want("seizure_deep"):
            self.api.call("POST", "/v1/predict/seizure-deep", P.seizure_deep_request(self.user, e, EEG_FS),
                          scen_t=t, events=ev, flag_of=flag_deep)

    def ecg_deep(self, t, k):
        if self.want("ecg_deep"):
            self.api.call("POST", "/v1/predict/ecg-deep", P.ecg_deep_request(self.user, self.ecg12(k), ECG12_FS),
                          scen_t=t, events=k["events"], flag_of=flag_deep)

    def env(self, t, k):
        spe_on = k["spe_start_s"] is not None and t >= k["spe_start_s"]
        rate = 1.8 + (40.0 if spe_on else 0.0)                         # mSv/day: deep-space GCR, plus an SPE
        self.dose += rate * PERIODS["env"] / 86400.0
        ev = k["events"]
        if self.want("space_weather"):
            self.api.call("POST", "/v1/predict/space-weather",
                          P.space_weather_request(self.user, _now(), t, k["spe_start_s"], k["spe_peak_pfu"]),
                          scen_t=t, events=ev, flag_of=flag_any)
        if self.want("radiation"):
            self.api.call("POST", "/v1/predict/radiation-risk",
                          P.radiation_request(self.user, _now(), 120.0 + self.dose, rate, spe_on),
                          scen_t=t, events=ev, flag_of=flag_any)
        if self.want("risk"):
            self.api.call("POST", "/v1/predict/risk", P.risk_request(self.user, 120.0 + self.dose, rate),
                          scen_t=t, events=ev, flag_of=flag_risk)

    def sleep(self, t, k):
        if self.want("sleep_deep"):
            stages = S.hypnogram(self.rng, 10, poor_sleep=k["poor_sleep"])
            x = S.sleep_epochs(self.rng, stages)
            self.api.call("POST", "/v1/predict/sleep-deep", P.sleep_deep_request(self.user, x),
                          scen_t=t, events=k["events"] + [f"truth:{''.join(s[0] for s in stages)}"], flag_of=flag_deep)

    def self_report(self, t, k):
        if self.want("self_report"):
            self.api.call("POST", "/v1/input/self-report",
                          P.self_report_request(self.user, _now(), S.self_report(self.rng, stressed=k["stressed"])),
                          scen_t=t, events=k["events"])

    # ------------------------------------------------------------ main loop
    def run(self, duration: float | None = None) -> None:
        dur = duration or self.s.duration_s
        scale = max(self.s.time_scale, 1e-6)
        tasks = [(PERIODS["fast"], self.fast), (PERIODS["ecg_deep"], self.ecg_deep), (PERIODS["env"], self.env),
                 (PERIODS["sleep"], self.sleep), (PERIODS["self_report"], self.self_report)]
        nxt = [0.0 for _ in tasks]
        wall0 = time.time()
        t = 0.0
        while t < dur:
            k = self.s.state_at(t)
            for i, (period, fn) in enumerate(tasks):
                if t >= nxt[i]:
                    fn(t, k)
                    nxt[i] = t + period
            t_next = min(nxt)
            sleep_s = wall0 + t_next / scale - time.time()
            if sleep_s > 0:
                time.sleep(sleep_s)
            t = t_next
            if int(t) % 60 == 0:
                print(f"  t={t:6.0f}s events={','.join(self.s.state_at(t)['events']) or '-'}")


def dry_run(scen: Scenario) -> None:
    """Build one payload per endpoint and print its size (no network)."""
    sim = Sim(scen)
    sim.user = str(uuid.uuid4())
    k = scen.state_at(0.0)
    t0 = _now() - timedelta(seconds=WIN_S)
    e = sim.eeg18(k)
    bodies = {
        "/v1/predict/ecg": P.ecg_request(sim.user, t0, sim.ecg1(k), ECG_FS),
        "/v1/predict/eeg": P.eeg_request(sim.user, t0, e, EEG_FS),
        "/v1/predict/seizure-deep": P.seizure_deep_request(sim.user, e, EEG_FS),
        "/v1/predict/ecg-deep": P.ecg_deep_request(sim.user, sim.ecg12(k), ECG12_FS),
        "/v1/predict/sleep-deep": P.sleep_deep_request(sim.user, S.sleep_epochs(sim.rng, S.hypnogram(sim.rng, 10))),
        "/v1/predict/space-weather": P.space_weather_request(sim.user, _now(), 0.0, 3600.0, 500.0),
        "/v1/predict/radiation-risk": P.radiation_request(sim.user, _now(), 120.0, 1.8, False),
        "/v1/predict/risk": P.risk_request(sim.user, 120.0, 1.8),
        "/v1/input/self-report": P.self_report_request(sim.user, _now(), S.self_report(sim.rng)),
    }
    for path, b in bodies.items():
        n = len(json.dumps(b, separators=(",", ":")))
        print(f"{path:30s} {n / 1e3:8.1f} kB {'OK' if n < 1_000_000 else 'TOO BIG'}")


def summarize(log_path: str | Path) -> None:
    rows = list(csv.DictReader(open(log_path, encoding="utf-8")))
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(r["endpoint"], []).append(r)
    print(f"\n{'endpoint':30s} {'n':>5s} {'p50 ms':>8s} {'p95 ms':>8s} {'errors':>7s}")
    for ep, rs in sorted(by.items()):
        lat = sorted(float(r["latency_ms"]) for r in rs if r["status"] == "200")
        err = sum(r["status"] != "200" for r in rs)
        p = lambda q: lat[min(len(lat) - 1, int(q * len(lat)))] if lat else float("nan")  # noqa: E731
        print(f"{ep:30s} {len(rs):5d} {p(0.5):8.0f} {p(0.95):8.0f} {err:7d}")
    relevant = {"tachycardia": ("/v1/predict/ecg",), "arrhythmia": ("/v1/predict/ecg",),
                "hrv_drop": ("/v1/predict/ecg",), "seizure": ("/v1/predict/eeg", "/v1/predict/seizure-deep"),
                "mi_pattern": ("/v1/predict/ecg-deep",), "spe": ("/v1/predict/space-weather", "/v1/predict/radiation-risk"),
                "poor_sleep": ("/v1/predict/sleep-deep",), "stress": ("/v1/predict/risk",), "hypoxia": ("/v1/predict/risk",)}
    quiet = {"", "none", "green", "ok", "0", "s0", "low", "low!"}
    seen: dict[str, object] = {}
    start: dict[str, float] = {}
    for r in rows:
        for e in filter(None, r["events"].split(";")):
            if e.startswith("truth:") or e not in relevant:
                continue
            start.setdefault(e, float(r["scenario_t_s"]))
            seen.setdefault(e, None)
            if seen[e] is None and r["endpoint"] in relevant[e] and r["flag"].lower() not in quiet:
                seen[e] = (r["endpoint"], r["flag"], round(float(r["scenario_t_s"]) - start[e], 1))
    if seen:
        print()
        print("event -> first flag from the endpoint that should catch it (endpoint, flag, seconds after onset):")
        for e, v in seen.items():
            print(f"  {e:12s} -> {v if v else 'no flag'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", help="base URL of a STAGING model API (or the team Worker route)")
    ap.add_argument("--scenario", default=str(Path(__file__).resolve().parents[1] / "scenarios" / "demo.json"))
    ap.add_argument("--log", default="logs/stream.csv")
    ap.add_argument("--duration", type=float, help="override scenario duration (scenario seconds)")
    ap.add_argument("--user-id", help="register the simulated user under this UUID")
    ap.add_argument("--only", help="comma list: ingest,ecg,eeg,seizure_deep,ecg_deep,sleep_deep,space_weather,"
                                   "radiation,risk,self_report")
    ap.add_argument("--keep-user", action="store_true", help="do not delete the simulated user at the end")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    scen = Scenario.load(a.scenario)
    if a.dry_run:
        dry_run(scen)
        return 0
    if not a.api:
        ap.error("--api is required unless --dry-run")
    from .api import Api
    api = Api(a.api, a.log)
    sim = Sim(scen, api, set(a.only.split(",")) if a.only else None)
    sim.setup(a.user_id)
    try:
        sim.run(a.duration)
    except KeyboardInterrupt:
        print("stopped")
    finally:
        if not a.keep_user and sim.user:
            api.delete_user(sim.user)
            print("simulated user deleted")
        summarize(a.log)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
