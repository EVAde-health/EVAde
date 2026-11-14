"""NOAA Space Weather Prediction Center feeds -> current conditions + EVA (spacewalk) window prediction.

Public JSON feeds, no key needed:
  planetary Kp (observed)   https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
  Kp 3-day forecast         https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json
  GOES integral protons     https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json
  GOES X-rays               https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json

EVA rule (demo, conservative): NO-GO if >=10 MeV protons >= 10 pfu (NOAA S1 radiation storm);
CAUTION if protons >= 1 pfu or Kp >= 5 (G1 geomagnetic storm); otherwise GO.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

SWPC = "https://services.swpc.noaa.gov"
URLS = {
    "kp": f"{SWPC}/products/noaa-planetary-k-index.json",
    "kp_forecast": f"{SWPC}/products/noaa-planetary-k-index-forecast.json",
    "protons": f"{SWPC}/json/goes/primary/integral-protons-6-hour.json",
    "xrays": f"{SWPC}/json/goes/primary/xrays-6-hour.json",
}


def _get(url: str, timeout: float = 15):
    req = urllib.request.Request(url, headers={"User-Agent": "EVAde-hackathon/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _rows(data) -> list[dict]:
    """SWPC 'products' feeds are either a header row + lists, or a list of dicts. Normalise to dicts."""
    if not data:
        return []
    if isinstance(data[0], list):
        header = [str(h).lower() for h in data[0]]
        return [dict(zip(header, row)) for row in data[1:]]
    return [{str(k).lower(): v for k, v in row.items()} for row in data]


def _num(v):
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _ts(v) -> str:
    s = str(v).replace(" ", "T")
    if not s.endswith("Z") and "+" not in s:
        s = s.split(".")[0] + "Z"
    return s


def eva_status(proton_pfu: float | None, kp: float | None) -> str | None:
    if proton_pfu is None and kp is None:
        return None
    if proton_pfu is not None and proton_pfu >= 10:
        return "no_go"
    if (proton_pfu is not None and proton_pfu >= 1) or (kp is not None and kp >= 5):
        return "caution"
    return "go"


def storm_level(pfu: float | None) -> str:
    if pfu is None:
        return "unknown"
    for lvl, thr in (("S5", 1e5), ("S4", 1e4), ("S3", 1e3), ("S2", 100), ("S1", 10)):
        if pfu >= thr:
            return lvl
    return "S0"


def xray_class(flux: float | None) -> str | None:
    if not flux or flux <= 0:
        return None
    for c, base in (("X", 1e-4), ("M", 1e-5), ("C", 1e-6), ("B", 1e-7), ("A", 1e-8)):
        if flux >= base:
            return f"{c}{flux / base:.1f}"
    return "A0.0"


@dataclass
class Conditions:
    ts: str
    kp_index: float | None
    proton_flux_10mev: float | None
    xray_flux: float | None
    xray_class: str | None = field(init=False)
    storm_level: str = field(init=False)
    eva_status: str | None = field(init=False)
    source: str = "NOAA SWPC"

    def __post_init__(self):
        self.xray_class = xray_class(self.xray_flux)
        self.storm_level = storm_level(self.proton_flux_10mev)
        self.eva_status = eva_status(self.proton_flux_10mev, self.kp_index)

    def as_row(self) -> dict:
        return self.__dict__.copy()


def parse_current(kp_data, proton_data, xray_data, now: datetime | None = None) -> Conditions:
    kp_rows = _rows(kp_data)
    kp = None
    if kp_rows:
        last = kp_rows[-1]
        kp = _num(last.get("kp") or last.get("kp_index") or last.get("estimated_kp"))
    p = [r for r in (proton_data or []) if str(r.get("energy", "")).replace(" ", "") == ">=10MeV"]
    x = [r for r in (xray_data or []) if "0.1-0.8" in str(r.get("energy", ""))]
    now = now or datetime.now(timezone.utc)
    return Conditions(
        ts=now.strftime("%Y-%m-%dT%H:%M:00Z"),
        kp_index=kp,
        proton_flux_10mev=_num(p[-1]["flux"]) if p else None,
        xray_flux=_num(x[-1]["flux"]) if x else None,
    )


def fetch_current() -> Conditions:
    def safe(key):
        try:
            return _get(URLS[key])
        except Exception as e:  # network down in space -> degrade, never crash
            print(f"[space_weather] {key} unavailable: {e}")
            return []
    return parse_current(safe("kp"), safe("protons"), safe("xrays"))


@dataclass
class EvaWindow:
    start: str
    end: str
    max_kp: float
    status: str


def eva_windows(kp_forecast_data, *, current_proton_pfu: float | None = None, min_hours: int = 6,
                now: datetime | None = None) -> list[EvaWindow]:
    """Group the 3-hourly Kp forecast into contiguous GO windows of at least `min_hours`.

    While a radiation storm is in progress (protons >= 10 pfu) every window is NO-GO, because Kp
    forecasts say nothing about proton events, which arrive with little warning.
    """
    now = now or datetime.now(timezone.utc)
    rows = []
    for r in _rows(kp_forecast_data):
        t = r.get("time_tag")
        kp = _num(r.get("kp"))
        if t is None or kp is None:
            continue
        start = datetime.fromisoformat(_ts(t).replace("Z", "+00:00"))
        if start + timedelta(hours=3) <= now:
            continue
        rows.append((start, kp))
    if current_proton_pfu is not None and current_proton_pfu >= 10:
        return []
    windows: list[EvaWindow] = []
    cur: list[tuple[datetime, float]] = []
    for start, kp in rows + [(None, 99)]:
        if start is not None and kp < 5:
            cur.append((start, kp))
            continue
        if cur and len(cur) * 3 >= min_hours:
            maxkp = max(k for _, k in cur)
            windows.append(EvaWindow(
                start=cur[0][0].strftime("%Y-%m-%dT%H:%MZ"),
                end=(cur[-1][0] + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%MZ"),
                max_kp=maxkp,
                status="go" if maxkp < 4 else "caution",
            ))
        cur = []
    return windows


def best_eva_window(kp_forecast_data=None, current: Conditions | None = None, min_hours: int = 6) -> dict:
    """Next best time to spacewalk: earliest GO window, else earliest CAUTION window."""
    if kp_forecast_data is None:
        try:
            kp_forecast_data = _get(URLS["kp_forecast"])
        except Exception as e:
            return {"status": "unknown", "reason": f"forecast unavailable: {e}"}
    pfu = current.proton_flux_10mev if current else None
    wins = eva_windows(kp_forecast_data, current_proton_pfu=pfu, min_hours=min_hours)
    if not wins:
        reason = "radiation storm in progress" if pfu is not None and pfu >= 10 else "no quiet window in the 3-day forecast"
        return {"status": "no_go", "reason": reason, "windows": []}
    best = next((w for w in wins if w.status == "go"), wins[0])
    return {"status": best.status, "best": best.__dict__, "windows": [w.__dict__ for w in wins],
            "note": "Kp forecast only; solar particle events can start with little warning, recheck before egress."}
