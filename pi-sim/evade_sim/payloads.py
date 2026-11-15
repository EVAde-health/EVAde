"""Build request bodies that match the EVAde model API schemas (backend repo, evade/api/schemas.py and deep_models.py).

Size limits kept here: request bodies stay under 1 MB; windows 2-60 s; ingest batches <= 20 windows / 500 readings.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from . import signals as S

SOURCE = "simulated"


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat()


def _rows(x: np.ndarray, decimals: int) -> list[list[float]]:
    return np.round(np.asarray(x, dtype=float), decimals).tolist()


def window(modality: str, t0: datetime, fs: float, channels: list[str], x: np.ndarray, unit: str,
           device_id: str | None = None, decimals: int = 3) -> dict:
    w = {"modality": modality, "t0_utc": iso(t0), "fs_hz": fs, "unit": unit, "channels": list(channels),
         "samples": _rows(x, decimals), "source": SOURCE}
    if device_id:
        w["device_id"] = device_id
    return w


def readings(t: datetime, values: dict, modality: str = "vitals") -> list[dict]:
    return [{"metric": m, "value": float(v), "unit": u, "t_utc": iso(t), "modality": modality, "quality": 1.0}
            for m, (v, u) in values.items()]


def ecg_request(user_id: str, t0: datetime, x: np.ndarray, fs: float, lead: str = "II") -> dict:
    return {"user_id": user_id, "window": window("ecg", t0, fs, [lead], x, "mv")}


def eeg_request(user_id: str, t0: datetime, x: np.ndarray, fs: float, channels=S.BIPOLAR_18) -> dict:
    return {"user_id": user_id, "window": window("eeg", t0, fs, list(channels), x, "uv", decimals=1)}


def ecg_deep_request(user_id: str, x12: np.ndarray, fs: float) -> dict:
    return {"user_id": user_id, "fs_hz": fs, "leads": list(S.ECG_LEADS), "samples": _rows(x12, 3)}


def sleep_deep_request(user_id: str, x2: np.ndarray) -> dict:
    return {"user_id": user_id, "fs_hz": 100.0, "channels": list(S.SLEEP_CHANNELS), "samples": _rows(x2, 1)}


def seizure_deep_request(user_id: str, x18: np.ndarray, fs: float) -> dict:
    return {"user_id": user_id, "fs_hz": fs, "channels": list(S.BIPOLAR_18), "samples": _rows(x18, 1)}


def space_weather_request(user_id: str, now: datetime, scen_t_s: float, spe_start_s: float | None,
                          peak_pfu: float, hours: int = 48) -> dict:
    """48 h of 5-minute GOES-like observations ending now (the provider contract in the backend's spaceweather README)."""
    obs = []
    for k in range(hours * 12, -1, -1):
        t = now - timedelta(minutes=5 * k)
        rel_h = (scen_t_s - 300 * k) / 3600.0
        spe_h = spe_start_s / 3600.0 if spe_start_s is not None else None
        p10, p50, p100 = S.proton_flux(rel_h, spe_h, peak_pfu)
        flare_h = spe_h - 0.5 if spe_h is not None else None
        obs.append({"t_utc": iso(t), "proton_10mev_pfu": round(p10, 4), "proton_50mev_pfu": round(p50, 4),
                    "proton_100mev_pfu": round(p100, 4), "xray_long_wm2": S.xray_flux(rel_h, flare_h),
                    "proton_satellite": 18})
    return {"user_id": user_id, "observations": obs, "location": "deep_space", "shielding": "spacecraft"}


def radiation_request(user_id: str, t: datetime, cumulative_msv: float, rate_msv_day: float, spe: bool) -> dict:
    return {"user_id": user_id, "t_utc": iso(t), "cumulative_dose_msv": round(cumulative_msv, 3),
            "dose_equivalent_rate_msv_per_day": round(rate_msv_day, 4), "spe_active": spe,
            "spe_dose_msv": 5.0 if spe else 0.0, "seu_count_last_hour": 3 if spe else 0}


def risk_request(user_id: str, cumulative_msv: float, rate_msv_day: float) -> dict:
    return {"user_id": user_id, "logistics_floor_days": 0.5, "cumulative_dose_msv": round(cumulative_msv, 3),
            "dose_rate_msv_day": round(rate_msv_day, 4)}


def self_report_request(user_id: str, t: datetime, vals: dict) -> dict:
    return {"user_id": user_id, "t_utc": iso(t), **vals}
