"""CLI: python -m evade_space <command>

  seed         create demo crew and push synthetic mission data to the Worker (+ baselines, risk)
  weather      fetch NOAA space weather now; --push writes it to D1 through the Worker
  eva-window   next best time to spacewalk from the NOAA 3-day Kp forecast
  dose         estimate daily dose for an environment

Set EVADE_API_URL (default http://localhost:8787) and EVADE_API_KEY.
"""
from __future__ import annotations

import argparse
import json

from . import radiation, space_weather, synthetic
from .client import EVAdeClient

DEMO_CREW = [
    ("Cmdr. Vega", "station", "nominal"),
    ("Dr. Okafor", "spacecraft", "sleep_debt"),
    ("Eng. Lindqvist", "planetary_base", "solar_storm"),
    ("Spc. Tanaka", "rover", "fever"),
]
BASELINE_METRICS = ["heart_rate", "hrv_rmssd", "systolic_bp", "body_temp", "sleep_hours"]


def cmd_seed(a):
    c = EVAdeClient(a.url, a.key)
    print("API:", c.health())
    crew = DEMO_CREW[: a.crew]
    for i, (name, env, event) in enumerate(crew):
        u = c.create_user(name, env, a.mission)
        uid = u["user_id"]
        data = synthetic.generate_mission(a.days, env, seed=100 + i, event=None if event == "nominal" else event)
        # Baseline period first (all but last 3 days), then build baselines, then the recent days,
        # so recent readings get colored against the personal baseline.
        cut = a.days - 3
        early = [o for o in data["observations"] if int(o["client_id"].rsplit("-", 1)[1]) < cut]
        late = [o for o in data["observations"] if int(o["client_id"].rsplit("-", 1)[1]) >= cut]
        c.push_observations(uid, early)
        for m in BASELINE_METRICS:
            try:
                c.baseline(uid, m, days=a.days + 1)
            except RuntimeError as e:
                print("  baseline", m, e)
        c.push_observations(uid, late)
        c.push_radiation(uid, data["radiation"])
        c.push_self_reports(uid, data["self_reports"])
        r = c.risk(uid)
        print(f"  {name:16s} {env:15s} event={event:11s} R={r['r']} band={r['band']} MDTR={r['mdtr']} id={uid}")


def cmd_weather(a):
    cur = space_weather.fetch_current()
    print(json.dumps(cur.as_row(), indent=2))
    if a.push:
        print(EVAdeClient(a.url, a.key).push_space_weather([cur.as_row()]))


def cmd_eva(a):
    cur = space_weather.fetch_current()
    print(json.dumps(space_weather.best_eva_window(current=cur, min_hours=a.hours), indent=2))


def cmd_dose(a):
    d = radiation.daily_dose(a.environment, location=a.location, proton_pfu=a.pfu, body=a.body)
    print(json.dumps({"daily_msv": d, "dose_rate_usv_h": radiation.dose_rate_usv_h(d),
                      "days_to_career_limit": round(radiation.CAREER_LIMIT_MSV / d, 1)}, indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(prog="evade_space")
    p.add_argument("--url"), p.add_argument("--key")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed"); s.add_argument("--days", type=int, default=30); s.add_argument("--crew", type=int, default=4)
    s.add_argument("--mission", default="EVAde Demo Mission"); s.set_defaults(f=cmd_seed)
    w = sub.add_parser("weather"); w.add_argument("--push", action="store_true"); w.set_defaults(f=cmd_weather)
    e = sub.add_parser("eva-window"); e.add_argument("--hours", type=int, default=6); e.set_defaults(f=cmd_eva)
    d = sub.add_parser("dose"); d.add_argument("environment", choices=list(radiation.ENVIRONMENT_MODEL))
    d.add_argument("--location"); d.add_argument("--pfu", type=float); d.add_argument("--body", choices=["moon", "mars"])
    d.set_defaults(f=cmd_dose)
    a = p.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
