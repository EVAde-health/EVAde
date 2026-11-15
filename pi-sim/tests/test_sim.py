"""Offline checks: shapes, bounds, payload sizes, BLE packing, scenario parsing, and a stream run against a fake API."""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evade_sim import ble_protocol as B  # noqa: E402
from evade_sim import payloads as P  # noqa: E402
from evade_sim import signals as S  # noqa: E402
from evade_sim.scenario import Scenario  # noqa: E402
from evade_sim.stream import Sim, dry_run  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
UUID = "123e4567-e89b-42d3-a456-426614174000"


def test_ecg_shapes_and_rate():
    rng = np.random.default_rng(0)
    st = {"t": 0.0}
    x = S.ecg(rng, st, 10.0, 250.0, hr=60)
    assert x.shape == (1, 2500) and np.isfinite(x).all()
    x12 = S.ecg(rng, {"t": 0.0}, 10.0, 500.0, leads=S.ECG_LEADS, st_elevation_mv=0.3)
    assert x12.shape == (12, 5000)
    peaks = (x[0][1:-1] > 0.7) & (x[0][1:-1] > x[0][:-2]) & (x[0][1:-1] >= x[0][2:])
    assert 7 <= peaks.sum() <= 13                       # about 10 beats at 60 bpm


def test_eeg_seizure_is_larger_and_sleep_shapes():
    rng = np.random.default_rng(1)
    calm = S.eeg_bipolar(rng, {"t": 0.0}, 10.0, 256.0)
    sz = S.eeg_bipolar(rng, {"t": 0.0}, 10.0, 256.0, seizure=1.0)
    assert calm.shape == (18, 2560) and sz.std() > 2 * calm.std()
    x = S.sleep_epochs(rng, ["W", "N2", "N3"])
    assert x.shape == (2, 9000)
    n3 = x[:, 6000:]
    w = x[:, :3000]
    assert n3.std() > w.std()


def test_payloads_match_api_limits():
    for path, body in _bodies().items():
        n = len(json.dumps(body, separators=(",", ":")))
        assert n < 1_000_000, (path, n)
    b = _bodies()
    assert len(b["ecg-deep"]["leads"]) == 12 and len(b["ecg-deep"]["samples"][0]) == 5000
    assert b["sleep-deep"]["fs_hz"] == 100.0 and len(b["sleep-deep"]["samples"][0]) % 3000 == 0
    assert len(b["seizure-deep"]["channels"]) == 18
    for w in (b["ecg"]["window"], b["eeg"]["window"]):
        assert 2 <= len(w["samples"][0]) / w["fs_hz"] <= 60 and w["source"] == "simulated"
        assert all(re.fullmatch(r"[A-Za-z0-9._+ -]{1,16}", c) for c in w["channels"])


def _bodies():
    rng = np.random.default_rng(2)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    e = S.eeg_bipolar(rng, {"t": 0.0}, 10.0, 256.0)
    return {"ecg": P.ecg_request(UUID, now, S.ecg(rng, {"t": 0.0}, 10.0, 250.0), 250.0),
            "eeg": P.eeg_request(UUID, now, e, 256.0),
            "seizure-deep": P.seizure_deep_request(UUID, e, 256.0),
            "ecg-deep": P.ecg_deep_request(UUID, S.ecg(rng, {"t": 0.0}, 10.0, 500.0, leads=S.ECG_LEADS), 500.0),
            "sleep-deep": P.sleep_deep_request(UUID, S.sleep_epochs(rng, S.hypnogram(rng, 10))),
            "space-weather": P.space_weather_request(UUID, now, 7200.0, 3600.0, 500.0)}


def test_space_weather_spe_rises():
    base = S.proton_flux(0.0, 1.0)[0]
    peak = S.proton_flux(4.0, 1.0)[0]
    assert peak > 100 * base and S.proton_flux(0.5, None)[0] == base


def test_ble_round_trip():
    x = [[0.1, -0.2, 1.05], [5.0, 6.0, -7.0]]
    pkt = B.pack_wave(41, 1_700_000_000_000, B.event_mask(["seizure"]), x, 1000.0)
    c, t, m, back = B.unpack_wave(pkt, 2, 1000.0)
    assert c == 41 and B.mask_events(m) == ["seizure"] and np.allclose(back, x, atol=1e-3)
    assert len(B.pack_wave(0, 0, 0, np.zeros((4, 16)), 10.0)) <= 180
    hr, rr = B.unpack_hr(B.pack_hr(72.4, [0.83, 0.81]))
    assert hr == 72 and np.allclose(rr, [0.83, 0.81], atol=1e-3)


def test_scenarios_load_and_knobs():
    s = Scenario.load(ROOT / "scenarios" / "demo.json")
    assert s.state_at(350)["hr"] == 150 and s.state_at(630)["seizure"] == 1.0 and s.state_at(10)["events"] == []
    Scenario.load(ROOT / "scenarios" / "quick.json")
    bad = ROOT / "tests" / "_bad.json"
    bad.write_text(json.dumps({"events": [{"type": "nope", "start_s": 1}]}))
    try:
        with pytest.raises(ValueError):
            Scenario.load(bad)
    finally:
        bad.unlink()


def test_dry_run_prints_every_endpoint(capsys):
    dry_run(Scenario.load(ROOT / "scenarios" / "quick.json"))
    out = capsys.readouterr().out
    for ep in ("ecg-deep", "sleep-deep", "seizure-deep", "space-weather", "self-report"):
        assert ep in out
    assert "TOO BIG" not in out


class FakeApi:
    def __init__(self):
        self.calls = []

    def call(self, method, path, body=None, **kw):
        self.calls.append((method, path))
        return {"data": {}}

    def create_user(self, user_id=None):
        return user_id or UUID

    def delete_user(self, user_id):
        self.calls.append(("DELETE", "user"))


def test_stream_hits_every_endpoint_fast(monkeypatch):
    s = Scenario.load(ROOT / "scenarios" / "quick.json")
    s.time_scale = 1e9                                  # no real-time pacing in the test
    api = FakeApi()
    sim = Sim(s, api)
    sim.setup()
    sim.run(duration=901)
    paths = {p for _, p in api.calls}
    for ep in ("/v1/devices/bind", "/v1/baseline/ecg", "/v1/baseline/eeg", "/v1/baseline/vitals", "/v1/ingest/batch",
               "/v1/predict/ecg", "/v1/predict/eeg", "/v1/predict/seizure-deep", "/v1/predict/ecg-deep",
               "/v1/predict/sleep-deep", "/v1/predict/space-weather", "/v1/predict/radiation-risk",
               "/v1/predict/risk", "/v1/input/self-report"):
        assert ep in paths, ep
