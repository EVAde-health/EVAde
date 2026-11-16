"""Raspberry Pi as simulated BLE wearables: heart-rate strap (standard 0x180D), 1-lead ECG patch, PPG wrist sensor and a
4-channel EEG headband (custom services), all driven by the same scenario timeline.

  sudo apt install bluez   # Raspberry Pi OS ships it
  pip install bless numpy
  python -m evade_sim.ble_peripheral --scenario scenarios/demo.json

The gateway (evade_sim.ble_gateway) connects, subscribes and uploads to the API. The Pi itself needs no API key.
"""
from __future__ import annotations

import argparse
import asyncio
import time
from pathlib import Path

import numpy as np

from . import ble_protocol as B
from . import signals as S
from .scenario import Scenario

TICK_S = 0.1          # notification cadence for waveforms


async def run(scen: Scenario, name: str) -> None:
    from bless import BlessServer, GATTAttributePermissions, GATTCharacteristicProperties

    server = BlessServer(name=name)
    props = GATTCharacteristicProperties.read | GATTCharacteristicProperties.notify
    perms = GATTAttributePermissions.readable
    await server.add_new_service(B.HR_SERVICE)
    await server.add_new_characteristic(B.HR_SERVICE, B.HR_MEASUREMENT, props, None, perms)
    for svc, char, *_ in B.SERVICES.values():
        await server.add_new_service(svc)
        await server.add_new_characteristic(svc, char, props, None, perms)
    await server.start()
    print(f"advertising as {name!r}: HR 0x180D + custom ECG/PPG/EEG services")

    rng = np.random.default_rng(scen.seed)
    states = {k: {"t": 0.0} for k in ("ecg", "ppg", "eeg")}
    counters = {k: 0 for k in B.SERVICES}
    t0 = time.time()
    next_hr = 0.0
    scale = max(scen.time_scale, 1e-6)
    while True:
        t = (time.time() - t0) * scale
        if t >= scen.duration_s:
            break
        k = scen.state_at(t)
        mask = B.event_mask(k["events"])
        now_ms = int(time.time() * 1000)
        for key, (svc, char, fs, chans, per, unit, sc) in B.SERVICES.items():
            secs = per / fs
            st = states[key]
            while st["t"] < t + TICK_S:                    # keep each stream at real time
                if key == "ecg":
                    x = S.ecg(rng, st, secs, fs, hr=k["hr"], hrv_ms=k["hrv_ms"], irregular=k["irregular"])
                elif key == "ppg":
                    x = S.ppg(rng, st, secs, fs, hr=k["hr"])
                else:
                    x = S.eeg_headband(rng, st, secs, fs, seizure=k["seizure"])
                st["t"] += secs
                server.get_characteristic(char).value = bytearray(B.pack_wave(counters[key], now_ms, mask, x, sc))
                server.update_value(svc, char)
                counters[key] += 1
        if t >= next_hr:
            rr = [60.0 / k["hr"] * (1 + rng.uniform(-k["irregular"], k["irregular"]))]
            server.get_characteristic(B.HR_MEASUREMENT).value = bytearray(B.pack_hr(k["hr"] + rng.normal(0, 1), rr))
            server.update_value(B.HR_SERVICE, B.HR_MEASUREMENT)
            next_hr = t + 1.0
        await asyncio.sleep(TICK_S / scale)
    await server.stop()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", default=str(Path(__file__).resolve().parents[1] / "scenarios" / "demo.json"))
    ap.add_argument("--name", default="EVAde-Sim")
    a = ap.parse_args()
    asyncio.run(run(Scenario.load(a.scenario), a.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
