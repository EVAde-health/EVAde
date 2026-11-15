"""Synthetic physiology and space-weather generators (numpy only).

Every generator takes a numpy Generator and a state dict so streams are continuous and repeatable with a fixed seed.
Signals are plausible enough to exercise the API and the models end to end; they are NOT medical-grade simulations.
"""
from __future__ import annotations

import math

import numpy as np

ECG_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
# relative QRS/T amplitude of each lead versus lead II (rough limb/precordial pattern); sign flips aVR
_LEAD_GAIN = {"I": 0.6, "II": 1.0, "III": 0.45, "aVR": -0.8, "aVL": 0.25, "aVF": 0.7,
              "V1": -0.5, "V2": 0.3, "V3": 0.8, "V4": 1.2, "V5": 1.1, "V6": 0.9}
BIPOLAR_18 = ["FP1-F7", "F7-T7", "T7-P7", "P7-O1", "FP1-F3", "F3-C3", "C3-P3", "P3-O1", "FP2-F4", "F4-C4",
              "C4-P4", "P4-O2", "FP2-F8", "F8-T8", "T8-P8", "P8-O2", "FZ-CZ", "CZ-PZ"]
EEG_HEADBAND_4 = ["TP9", "AF7", "AF8", "TP10"]
SLEEP_CHANNELS = ["Fpz-Cz", "Pz-Oz"]
SLEEP_STAGES = ["W", "N1", "N2", "N3", "REM"]


def _pink(rng: np.random.Generator, n: int, channels: int = 1) -> np.ndarray:
    """1/f noise, unit variance per channel."""
    f = np.fft.rfftfreq(n)
    f[0] = f[1] if n > 1 else 1.0
    spec = (rng.standard_normal((channels, f.size)) + 1j * rng.standard_normal((channels, f.size))) / np.sqrt(f)
    x = np.fft.irfft(spec, n=n, axis=1)
    return x / (x.std(axis=1, keepdims=True) + 1e-12)


# ------------------------------------------------------------------ ECG / PPG
def beat_times(rng: np.random.Generator, state: dict, seconds: float, hr: float, hrv_ms: float = 40.0,
               irregular: float = 0.0) -> list[float]:
    """Beat onset times (s) inside [t, t+seconds), continuing from state['next_beat']; RSA plus noise HRV.
    irregular > 0 adds atrial-fibrillation-like RR scatter (fraction of the mean RR)."""
    t0 = state.get("t", 0.0)
    nb = state.get("next_beat", t0 + rng.uniform(0, 60.0 / hr))
    out = []
    while nb < t0 + seconds:
        out.append(nb)
        rr = 60.0 / hr
        rr += (hrv_ms / 1000.0) * math.sin(2 * math.pi * 0.25 * nb) + rng.normal(0, hrv_ms / 3000.0)
        if irregular > 0:
            rr *= 1.0 + rng.uniform(-irregular, irregular)
        nb += max(0.25, rr)
    state["next_beat"] = nb
    return out


def _pqrst(t: np.ndarray, st_shift: float = 0.0) -> np.ndarray:
    """One beat template (mV, lead-II-like) at times t relative to the R peak."""
    g = lambda mu, sd, a: a * np.exp(-((t - mu) ** 2) / (2 * sd ** 2))  # noqa: E731
    beat = g(-0.20, 0.025, 0.12) + g(-0.03, 0.010, -0.15) + g(0.0, 0.012, 1.1) + g(0.03, 0.010, -0.25) \
        + g(0.25, 0.045, 0.30)
    if st_shift:
        beat = beat + st_shift * ((t > 0.04) & (t < 0.20))
    return beat


def ecg(rng: np.random.Generator, state: dict, seconds: float, fs: float, *, hr: float = 70.0, leads=("II",),
        hrv_ms: float = 40.0, irregular: float = 0.0, st_elevation_mv: float = 0.0, noise_mv: float = 0.02) -> np.ndarray:
    """ECG (leads x samples, mV). st_elevation_mv shifts the ST segment in V1-V4 (an MI-like pattern)."""
    n = int(round(seconds * fs))
    t0 = state.get("t", 0.0)
    tt = t0 + np.arange(n) / fs
    beats = beat_times(rng, state, seconds, hr, hrv_ms, irregular)
    prev = state.get("prev_beats", [])
    out = np.zeros((len(leads), n))
    base = np.zeros(n)
    st_base = np.zeros(n)
    for b in prev[-2:] + beats:
        rel = tt - b
        m = (rel > -0.35) & (rel < 0.6)
        if m.any():
            base[m] += _pqrst(rel[m])
            st_base[m] += _pqrst(rel[m], 1.0) - _pqrst(rel[m])
    for i, lead in enumerate(leads):
        x = _LEAD_GAIN.get(lead, 1.0) * base
        if st_elevation_mv and lead in ("V1", "V2", "V3", "V4"):
            x = x + st_elevation_mv * st_base
        wander = 0.05 * np.sin(2 * math.pi * 0.25 * tt + i)
        out[i] = x + wander + noise_mv * rng.standard_normal(n)
    state["prev_beats"] = (prev + beats)[-4:]
    return out


def ppg(rng: np.random.Generator, state: dict, seconds: float, fs: float, *, hr: float = 70.0) -> np.ndarray:
    """Wrist PPG (1 x samples, arbitrary units around 1.0)."""
    n = int(round(seconds * fs))
    t0 = state.get("t", 0.0)
    tt = t0 + np.arange(n) / fs
    phase = 2 * math.pi * hr / 60.0 * tt
    x = 1.0 + 0.05 * (np.sin(phase) + 0.3 * np.sin(2 * phase + 0.8)) + 0.01 * np.sin(2 * math.pi * 0.2 * tt)
    return (x + 0.003 * rng.standard_normal(n))[None, :]


# ------------------------------------------------------------------ EEG
def eeg_bipolar(rng: np.random.Generator, state: dict, seconds: float, fs: float, *, seizure: float = 0.0,
                channels=BIPOLAR_18) -> np.ndarray:
    """18-channel bipolar EEG (µV). seizure in [0,1] mixes in an evolving rhythmic discharge (about 10 Hz slowing
    toward 6 Hz across each window, with harmonics), a shape the beta seizure model flags."""
    n = int(round(seconds * fs))
    t0 = state.get("t", 0.0)
    tt = t0 + np.arange(n) / fs
    c = len(channels)
    common = _pink(rng, n, 1)
    x = 12.0 * (0.6 * _pink(rng, n, c) + 0.4 * common)
    for i, name in enumerate(channels):
        posterior = name.endswith("O1") or name.endswith("O2") or "P" in name.split("-")[1]
        alpha = (14.0 if posterior else 4.0) * np.sin(2 * math.pi * 10.0 * tt + i * 0.7)
        x[i] += alpha * (1 - seizure)
    if seizure > 0:
        rel = np.arange(n) / fs
        freq = 10.0 - 4.0 * rel / max(rel[-1], 1e-9)            # evolving: about 10 Hz slowing to 6 Hz
        ph = 2 * math.pi * np.cumsum(freq) / fs
        sw = 150.0 * (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph))
        x *= 1 - 0.5 * seizure
        for i in range(c):
            x[i] += seizure * (0.7 + 0.6 * rng.random()) * sw * (1 if i % 2 == 0 else -1)
    return x


def eeg_headband(rng: np.random.Generator, state: dict, seconds: float, fs: float, *, seizure: float = 0.0) -> np.ndarray:
    """4-channel consumer headband EEG (µV), same generator with headband channel names."""
    return eeg_bipolar(rng, state, seconds, fs, seizure=seizure, channels=EEG_HEADBAND_4)


def sleep_epochs(rng: np.random.Generator, stages: list[str], fs: float = 100.0) -> np.ndarray:
    """Two-channel (Fpz-Cz, Pz-Oz) sleep EEG in µV, 30 s per stage label."""
    n = int(30 * fs)
    tt = np.arange(n) / fs
    out = []
    for st in stages:
        x = 8.0 * _pink(rng, n, 2)
        if st == "W":
            x[1] += 15 * np.sin(2 * math.pi * 10 * tt) + 5 * rng.standard_normal(n)
            x += 6 * np.sin(2 * math.pi * 20 * tt + rng.random())
        elif st == "N1":
            x += 12 * np.sin(2 * math.pi * 5.5 * tt + rng.random())
        elif st == "N2":
            x += 10 * np.sin(2 * math.pi * 5 * tt + rng.random())
            for c0 in rng.uniform(1, 28, size=3):                    # sleep spindles
                m = (tt > c0) & (tt < c0 + 1.0)
                x[:, m] += 20 * np.sin(2 * math.pi * 13 * tt[m]) * np.hanning(m.sum())
            k = rng.uniform(2, 27)                                   # K-complex
            x += -80 * np.exp(-((tt - k) ** 2) / 0.03) + 50 * np.exp(-((tt - k - 0.35) ** 2) / 0.05)
        elif st == "N3":
            x += 75 * np.sin(2 * math.pi * 1.0 * tt + rng.random()) + 30 * np.sin(2 * math.pi * 0.6 * tt)
        elif st == "REM":
            x += 14 * np.sin(2 * math.pi * 6 * tt + rng.random())
            x += 10 * np.sign(np.sin(2 * math.pi * 3 * tt))           # sawtooth-like
        out.append(x)
    return np.concatenate(out, axis=1) if out else np.zeros((2, 0))


def hypnogram(rng: np.random.Generator, n_epochs: int, *, poor_sleep: bool = False) -> list[str]:
    """A plausible stage sequence (cycles of N1 -> N2 -> N3 -> N2 -> REM); poor_sleep adds wake and N1."""
    cycle = ["W"] * 2 + ["N1"] * 3 + ["N2"] * 12 + ["N3"] * 10 + ["N2"] * 6 + ["REM"] * 8
    seq = (cycle * (n_epochs // len(cycle) + 1))[:n_epochs]
    if poor_sleep:
        seq = [s if rng.random() > 0.35 else rng.choice(["W", "N1"]) for s in seq]
    return seq


# ------------------------------------------------------------------ readings, self-report, space weather
def vitals(rng: np.random.Generator, *, hr: float = 70.0, spo2: float = 98.0, hypoxia: bool = False,
           stressed: bool = False) -> dict:
    """One set of vital-sign readings (metric -> (value, unit))."""
    if hypoxia:
        spo2 = 88.0
    return {
        "hr_bpm": (round(hr + rng.normal(0, 1.5), 1), "bpm"),
        "spo2_pct": (round(min(100.0, spo2 + rng.normal(0, 0.5)), 1), "%"),
        "resp_rate_bpm": (round((18 if stressed else 14) + rng.normal(0, 1), 1), "bpm"),
        "temp_c": (round(36.7 + rng.normal(0, 0.1), 2), "C"),
        "bp_systolic_mmhg": (round((132 if stressed else 118) + rng.normal(0, 3)), "mmHg"),
        "bp_diastolic_mmhg": (round((86 if stressed else 76) + rng.normal(0, 2)), "mmHg"),
    }


def self_report(rng: np.random.Generator, *, stressed: bool = False) -> dict:
    lo = (2, 4, 4, 2) if stressed else (4, 2, 2, 4)
    clip = lambda v: int(min(5, max(1, v)))  # noqa: E731
    return {"sleep_quality": clip(lo[0] + rng.integers(-1, 2)), "stress": clip(lo[1] + rng.integers(-1, 2)),
            "fatigue": clip(lo[2] + rng.integers(-1, 2)), "mood": clip(lo[3] + rng.integers(-1, 2))}


def proton_flux(t_rel_h: float, spe_start_h: float | None, peak_pfu: float = 500.0) -> tuple[float, float, float]:
    """≥10/50/100 MeV integral proton flux (pfu); a solar particle event rises over ~3 h then decays."""
    base = (0.25, 0.15, 0.12)
    if spe_start_h is None or t_rel_h < spe_start_h:
        return base
    dt = t_rel_h - spe_start_h
    shape = (1 - math.exp(-dt / 1.0)) * math.exp(-max(0.0, dt - 3.0) / 12.0)
    return tuple(b + peak_pfu * shape * s for b, s in zip(base, (1.0, 0.2, 0.05)))


def xray_flux(t_rel_h: float, flare_h: float | None) -> float:
    if flare_h is None or t_rel_h < flare_h:
        return 2e-7
    return 2e-7 + 1e-4 * math.exp(-(t_rel_h - flare_h) / 0.3)
