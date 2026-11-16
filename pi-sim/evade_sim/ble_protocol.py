"""BLE layout shared by the Pi peripheral and the gateway.

Heart rate uses the standard Heart Rate Service (0x180D) / Heart Rate Measurement (0x2A37) with RR intervals.
Raw waveforms use custom 128-bit services, one characteristic each. Every waveform notification is:
  header  <I Q B>  counter (uint32), generation time in unix ms (uint64), scenario event bitmask (uint8)
  payload int16 little-endian samples, channel-interleaved, scaled to integer units (see SCALE)
Kept at <= 180 bytes so it fits a negotiated ATT MTU (BlueZ and most centrals negotiate 185-247).
"""
from __future__ import annotations

import struct

HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"
SERVICES = {   # name: (service uuid, characteristic uuid, fs_hz, channels, samples per packet per channel, unit, scale)
    "ecg": ("e7ade000-0001-4c3e-9e59-0a1b2c3d4e01", "e7ade000-0101-4c3e-9e59-0a1b2c3d4e01", 250.0, ["II"], 25, "mv", 1000.0),
    "ppg": ("e7ade000-0002-4c3e-9e59-0a1b2c3d4e01", "e7ade000-0102-4c3e-9e59-0a1b2c3d4e01", 64.0, ["PPG"], 16, "au", 10000.0),
    "eeg": ("e7ade000-0003-4c3e-9e59-0a1b2c3d4e01", "e7ade000-0103-4c3e-9e59-0a1b2c3d4e01", 256.0,
            ["TP9", "AF7", "AF8", "TP10"], 16, "uv", 10.0),
}
HEADER = struct.Struct("<IQB")
EVENT_BITS = ["tachycardia", "arrhythmia", "hrv_drop", "hypoxia", "seizure", "mi_pattern", "poor_sleep", "stress"]


def event_mask(events) -> int:
    return sum(1 << i for i, e in enumerate(EVENT_BITS) if e in events)


def mask_events(mask: int) -> list[str]:
    return [e for i, e in enumerate(EVENT_BITS) if mask >> i & 1]


def pack_wave(counter: int, t_ms: int, mask: int, samples, scale: float) -> bytes:
    """samples: channels x n (floats in the stream unit) -> one notification."""
    vals = []
    for j in range(len(samples[0])):
        for ch in samples:
            vals.append(max(-32768, min(32767, int(round(ch[j] * scale)))))
    return HEADER.pack(counter & 0xFFFFFFFF, t_ms, mask) + struct.pack(f"<{len(vals)}h", *vals)


def unpack_wave(data: bytes, n_ch: int, scale: float):
    counter, t_ms, mask = HEADER.unpack_from(data)
    n = (len(data) - HEADER.size) // 2
    vals = struct.unpack_from(f"<{n}h", data, HEADER.size)
    chans = [[vals[i] / scale for i in range(c, n, n_ch)] for c in range(n_ch)]
    return counter, t_ms, mask, chans


def pack_hr(hr_bpm: float, rr_s: list[float]) -> bytes:
    """Heart Rate Measurement: flags bit0=0 (uint8 HR), bit4=1 (RR present); RR in 1/1024 s."""
    flags = 0x10
    body = bytes([flags, max(0, min(255, int(round(hr_bpm))))])
    for rr in rr_s[:8]:
        body += struct.pack("<H", max(0, min(65535, int(round(rr * 1024)))))
    return body


def unpack_hr(data: bytes) -> tuple[float, list[float]]:
    flags = data[0]
    i = 1
    if flags & 0x01:
        hr = struct.unpack_from("<H", data, i)[0]; i += 2
    else:
        hr = data[i]; i += 1
    if flags & 0x08:
        i += 2                                        # energy expended
    rr = []
    if flags & 0x10:
        while i + 1 < len(data):
            rr.append(struct.unpack_from("<H", data, i)[0] / 1024.0); i += 2
    return float(hr), rr
