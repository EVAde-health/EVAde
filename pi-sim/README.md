# pi-sim: live synthetic input stream for every EVAde model

A Raspberry Pi pretends to be the crew's sensors and streams **synthetic** data into the EVAde model API, so you can test the API's responsiveness and see flags fire when known events are injected. It follows the plan in the backend repo (`lit review/planning/pi-bluetooth-stream-test.md`).

> All data is synthetic and labelled `source: "simulated"`; devices are bound as `kind: "simulated"`, so the API marks results provisional. Outputs are flags for human review, not diagnoses. Point it at a **staging** API, never at real users.

## Two paths

| Path | What streams | Run |
|---|---|---|
| **Wi-Fi / HTTP** (`evade_sim.stream`) | every model input (table below), at real time or faster | on the Pi (or any machine) |
| **Bluetooth** (`evade_sim.ble_peripheral` + `evade_sim.ble_gateway`) | what real wearables send over BLE: heart-rate strap (standard 0x180D with RR), 1-lead ECG patch, PPG, 4-channel EEG headband | peripheral on the Pi, gateway on a laptop or second Pi |

12-lead ECG and 18-channel clinical EEG are too much for BLE (about 96 and 74 kbps), so they only go over Wi-Fi, as in the plan.

## What each model gets (Wi-Fi path)

| Endpoint | Synthetic input | Every |
|---|---|---|
| `/v1/ingest/batch` | vitals (HR, SpO2, resp, temp, BP) + 1-lead ECG window from the bound device, with `seq` | 10 s |
| `/v1/predict/ecg` | 1-lead ECG, 250 Hz, 10 s | 10 s |
| `/v1/predict/eeg` (beta seizure flag) | 18-channel bipolar EEG, 256 Hz, 10 s | 10 s |
| `/v1/predict/seizure-deep` | same 18-channel window | 10 s |
| `/v1/predict/ecg-deep` | 12-lead ECG, 500 Hz, 10 s (ST elevation in V1-V4 during `mi_pattern`) | 30 s |
| `/v1/predict/sleep-deep` | 10 x 30 s epochs, Fpz-Cz + Pz-Oz at 100 Hz, stage-shaped (spindles, K-complexes, delta, REM sawtooth); the true stage sequence is logged | 5 min |
| `/v1/predict/space-weather` | 48 h of 5-min GOES-like proton and X-ray flux (a flare then an SPE during `spe`) | 60 s |
| `/v1/predict/radiation-risk` | cumulative dose and rate (higher during `spe`) | 60 s |
| `/v1/predict/risk` | dose inputs; the API combines everything it has seen | 60 s |
| `/v1/input/self-report` | 1-5 ratings (worse during `stress`) | 15 min |

Setup first creates the user, binds the device, and sends baselines (30 ECG windows, 12 EEG windows = the 30 four-second windows the seizure model needs, 12 sets of vitals) with past timestamps, so flags work from the first minute.

## Scenarios

`scenarios/demo.json` (30 min, real time) injects, in order: tachycardia, a seizure, an MI-like ST elevation, hypoxia, arrhythmia, an HRV drop, stress, poor sleep, and a solar particle event. `scenarios/quick.json` runs 10 min at 4x speed. Event types: `tachycardia`, `arrhythmia`, `hrv_drop`, `hypoxia`, `seizure`, `mi_pattern`, `poor_sleep`, `stress`, `spe`.

## Run

On the Pi (Raspberry Pi OS 64-bit, Python 3.11+):

```bash
cd pi-sim
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m evade_sim.stream --dry-run                     # builds one payload per endpoint, prints sizes, no network
read -rs EVADE_API_KEY && export EVADE_API_KEY           # paste the STAGING key (not echoed, not saved)
python -m evade_sim.stream --api https://<staging model api> --scenario scenarios/quick.json
```

Options:
- `--only ecg,eeg,risk` streams a subset.
- `--user-id <uuid>` registers the simulated user under an existing ID.
- `--keep-user` skips the deletion at the end.
- `--log logs/run.csv` sets the timing log path.

Bluetooth:

```bash
# on the Pi
pip install bless && python -m evade_sim.ble_peripheral --scenario scenarios/demo.json
# on the gateway
pip install bleak httpx numpy
read -rs EVADE_API_KEY && export EVADE_API_KEY
python -m evade_sim.ble_gateway --api https://<staging model api> --name EVAde-Sim --duration 600
```

Sync both clocks (`chrony`) if you want BLE one-way delay. Packet counters give BLE loss either way.

## Output

- `logs/stream.csv` (or `--log`): one row per API call, with send time, endpoint, status, latency, bytes, flag, `source` (`model` or `mock`), model IDs, scenario time and active events. No signal values, user IDs or keys.
- `logs/ble_link.csv` (gateway only): packets, lost packets and median BLE delay per stream.

At the end the stream prints p50/p95 latency and errors per endpoint, plus the first flag seen for each injected event (event-to-flag check). The simulated user is deleted unless `--keep-user` is set.

## Reading the event-to-flag summary

A local run of `scenarios/demo.json` against the API (2026-11-15) flagged tachycardia (`/v1/predict/ecg`), the seizure (beta EEG model, `review`), the irregular rhythm, the MI pattern, and the solar particle event (S1 in space weather). HRV drop raised no flag.

- **Flags can fire outside events.** The deep ECG model can flag synthetic 12-lead ECG even outside `mi_pattern`, so compare the flag rate inside and outside each event rather than trusting a single hit.
- **Deep models without weights** answer with `source: "mock"` placeholders. Their flags mean nothing until the model folders are installed.

## Notes

- **Key handling.** The key is read from `EVADE_API_KEY` only, and sent as `X-EVAde-Key`. In production the gateway would go through the team Worker instead of holding the model API key.
- **Payload sizes.** Payloads stay under the API's 1 MB cap. Run `--dry-run` to see the sizes.
- **Not real physiology.** The signals are good enough to exercise the API and trigger flags, and are no substitute for clinical data.
