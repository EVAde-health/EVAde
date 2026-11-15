"""BLE gateway: connect to the simulated Pi wearables, buffer into 10 s windows, upload to the model API, and log
API latency plus BLE loss/delay. Runs on a laptop or a second Pi.

  pip install bleak httpx numpy
  EVADE_API_KEY=... python -m evade_sim.ble_gateway --api https://<staging api> --name EVAde-Sim

Per 10 s: POST /v1/ingest/batch (HR readings + ECG and PPG windows), /v1/predict/ecg (1-lead), /v1/predict/eeg
(4-channel headband). BLE delay = gateway receive time - Pi generation time (sync both clocks with chrony/NTP).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import ble_protocol as B
from . import payloads as P
from .api import Api
from .stream import flag_ecg, flag_eeg

WIN_S = 10.0


class Buffers:
    def __init__(self):
        self.wave = {k: [[] for _ in v[3]] for k, v in B.SERVICES.items()}
        self.last = {k: None for k in B.SERVICES}
        self.lost = {k: 0 for k in B.SERVICES}
        self.got = {k: 0 for k in B.SERVICES}
        self.delay_ms: list[float] = []
        self.hr: list[tuple[datetime, float]] = []
        self.events: set[str] = set()

    def on_wave(self, key: str, data: bytes) -> None:
        _, _, _, chans, _, _, scale = B.SERVICES[key]
        counter, t_ms, mask, x = B.unpack_wave(bytes(data), len(chans), scale)
        if self.last[key] is not None and counter != (self.last[key] + 1) & 0xFFFFFFFF:
            self.lost[key] += (counter - self.last[key] - 1) & 0xFFFFFFFF
        self.last[key] = counter
        self.got[key] += 1
        self.delay_ms.append(time.time() * 1000 - t_ms)
        self.events.update(B.mask_events(mask))
        for buf, ch in zip(self.wave[key], x):
            buf.extend(ch)

    def on_hr(self, data: bytes) -> None:
        hr, _ = B.unpack_hr(bytes(data))
        self.hr.append((datetime.now(timezone.utc), hr))

    def take(self, key: str, n: int):
        if len(self.wave[key][0]) < n:
            return None
        out = [b[:n] for b in self.wave[key]]
        self.wave[key] = [b[n:] for b in self.wave[key]]
        return out


async def run(api: Api, name: str, duration: float, ble_log: str) -> None:
    from bleak import BleakClient, BleakScanner

    dev = await BleakScanner.find_device_by_name(name, timeout=20.0)
    if dev is None:
        raise SystemExit(f"no BLE device named {name!r} found (is ble_peripheral running on the Pi?)")
    user = api.create_user()
    device_id = f"pi-ble-{uuid.uuid4().hex[:8]}"
    api.call("POST", "/v1/devices/bind", {"user_id": user, "device_id": device_id, "kind": "simulated",
                                          "vendor": "evade-sim", "model": "raspberry-pi-ble"})
    buf = Buffers()
    seq = 0
    Path(ble_log).parent.mkdir(parents=True, exist_ok=True)
    blog = csv.writer(open(ble_log, "a", newline="", encoding="utf-8"))
    blog.writerow(["t_unix", "stream", "packets", "lost", "delay_ms_median"])
    try:
        async with BleakClient(dev) as client:
            await client.start_notify(B.HR_MEASUREMENT, lambda _, d: buf.on_hr(d))
            for key, (_, char, *_r) in B.SERVICES.items():
                await client.start_notify(char, lambda _, d, k=key: buf.on_wave(k, d))
            print(f"connected to {name}; streaming for {duration:.0f} s")
            t_end = time.time() + duration
            while time.time() < t_end and client.is_connected:
                await asyncio.sleep(WIN_S)
                now = datetime.now(timezone.utc)
                t0 = now - timedelta(seconds=WIN_S)
                ev = sorted(buf.events); buf.events.clear()
                wins, out = [], {}
                for key in ("ecg", "ppg", "eeg"):
                    _, _, fs, chans, _, unit, _ = B.SERVICES[key]
                    x = buf.take(key, int(fs * WIN_S))
                    if x is not None:
                        out[key] = (x, fs, chans, unit)
                for key in ("ecg", "ppg"):
                    if key in out:
                        x, fs, chans, unit = out[key]
                        wins.append(P.window(key, t0, fs, chans, x, unit, device_id=device_id))
                hrs, buf.hr = buf.hr, []
                rd = [r for t, hr in hrs for r in P.readings(t, {"hr_bpm": (hr, "bpm")})]
                await asyncio.to_thread(api.call, "POST", "/v1/ingest/batch",
                                        {"user_id": user, "device_id": device_id, "seq": seq, "readings": rd[:500],
                                         "windows": wins}, events=ev)
                seq += 1
                if "ecg" in out:
                    x, fs, chans, unit = out["ecg"]
                    await asyncio.to_thread(api.call, "POST", "/v1/predict/ecg",
                                            {"user_id": user, "window": P.window("ecg", t0, fs, chans, x, unit)},
                                            events=ev, flag_of=flag_ecg)
                if "eeg" in out:
                    x, fs, chans, unit = out["eeg"]
                    await asyncio.to_thread(api.call, "POST", "/v1/predict/eeg",
                                            {"user_id": user, "window": P.window("eeg", t0, fs, chans, x, unit, decimals=1)},
                                            events=ev, flag_of=flag_eeg)
                d = sorted(buf.delay_ms); buf.delay_ms = []
                med = d[len(d) // 2] if d else float("nan")
                for key in B.SERVICES:
                    blog.writerow([f"{time.time():.1f}", key, buf.got[key], buf.lost[key], f"{med:.1f}"])
                print(f"  window {seq}: packets {dict(buf.got)} lost {dict(buf.lost)} BLE delay ~{med:.0f} ms "
                      f"events {ev or '-'}")
    finally:
        api.delete_user(user)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True)
    ap.add_argument("--name", default="EVAde-Sim")
    ap.add_argument("--duration", type=float, default=600.0)
    ap.add_argument("--log", default="logs/ble_api.csv")
    ap.add_argument("--ble-log", default="logs/ble_link.csv")
    a = ap.parse_args()
    asyncio.run(run(Api(a.api, a.log), a.name, a.duration, a.ble_log))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
