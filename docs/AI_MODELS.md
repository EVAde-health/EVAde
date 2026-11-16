# AI and ML models in EVAde

This is the map of every model the app calls or registers. "Michael" means the registry in
[Mikeblackbelt/EVAde-backend-models](https://github.com/Mikeblackbelt/EVAde-backend-models) (`MODEL_REGISTRY.md`, EVA-1 through EVA-15).
Weight files are not in this git repository. Trained artifacts are joblib or ONNX folders in the private
`evade-models` R2 bucket. The `evade-gateway` Worker (Cloudflare Container) loads them, checks sha256, and serves
`/v1/predict/*`. This API Worker never invents a probability when that container is not connected.

Judges can confirm what ran on **Models** (`/models`): catalog SHA-256, gateway status, and a live "Run this model"
button that shows the raw input, raw output, and latency. Stored predictions from `/predict/:kind` keep a
`provenance` object (`model_id`, endpoint, source, `model_sha256` when the gateway returns one) inside `model_results.output`,
and the hash column `model_results.model_sha256` when one was returned.

## How a judge checks model usage

1. Sign in with **Try the demo**, open **Models**.
2. Compare **Catalog document SHA-256** with `sha256sum` of the JSON array in `cloud/worker/src/modelCatalog.ts` (the page states this is the catalog document, not the weight file).
3. Press **Run this model**. If `evade-gateway` is connected and the R2 artifact loaded, the raw JSON is the model service's response and includes `model_id`. If the gateway is not connected, the output is an error and **no number is filled in**.
4. The gateway's own `GET /v1/models` (shown as gateway status on the same page) reports `sha256_verified` per loaded folder. That check happens inside the container, against the manifest that shipped with the weights.
5. A real crew prediction, once the gateway has run, is the row in D1 `model_results` (`evade-db`) for that user: `endpoint`, `model_id`, `model_sha256`, `output.provenance`.

## Michael's registry (EVA-1 .. EVA-15)

All fifteen entries are listed in `cloud/worker/src/modelCatalog.ts` and on `/models`. Summary:

| ID | Kind | What it does | Served as | Weights | Runs in |
| --- | --- | --- | --- | --- | --- |
| EVA-1 | architecture | Seizure-window histogram gradient boosting spec | — | none | not a model |
| EVA-2 | model | Seizure-suspect flag, 4 s EEG window. Served seizure model. | `POST /v1/predict/eeg` | R2 `models/seizure/model.joblib` | evade-gateway only |
| EVA-3 | architecture | Sleep-stage HGB spec | — | none | not a model |
| EVA-4 | model | Sleep staging beta (HGB). Not the served deep model. | — | training joblib, not in this repo | not loaded here |
| EVA-5 | architecture | PTB-XL superclass HGB spec | — | none | not a model |
| EVA-6 | model | 12-lead ECG diagnostic superclasses (HGB) | `POST /v1/predict/ecg` | R2 `models/ecg/model.joblib` | evade-gateway only |
| EVA-7 | architecture | SPE onset logistic spec, 19 GOES features | — | none | not a model |
| EVA-8 | model | Earlier SPE logistic (GOES-8..15). Not served. | — | kept for the record, not the served file | not loaded here |
| EVA-9 | model | SPE logistic with background correction. Replaced by EVA-12. | — | not served | not loaded here |
| EVA-10 | architecture | SPE model plus CME features | — | none | not a model |
| EVA-11 | model | SPE + CME logistic. Registry: weights not retained. | — | not retained | cannot be run |
| EVA-12 | model | P(solar particle event onset within 24 h). The served space-weather model. | `POST /v1/predict/space-weather` | R2 `models/spaceweather/model.joblib` | evade-gateway only |
| EVA-13 | model | Deep 12-lead ECG ResNet, ONNX | `POST /v1/predict/ecg-deep` | R2 ONNX (~2 MB) | evade-gateway (onnxruntime) |
| EVA-14 | model | Deep 5-stage sleep staging, ONNX | `POST /v1/predict/sleep-deep` | R2 ONNX | evade-gateway (onnxruntime) |
| EVA-15 | model | Deep seizure ResNet. Registry: worse than EVA-2, **not served**. | — | trained, not served | cannot be run as a served model |

There are 15 registry rows, not a separate 16th trained model. Architectures and retrains share one counter. The next free id in Michael's registry is EVA-16.

### Where the app calls them

- `cloud/worker/src/models.ts` — `callModelApi`, kinds `ecg`, `ecg-deep`, `eeg`, `sleep-deep`, `seizure-deep`, `radiation-risk`, `space-weather`, `risk`. Mock `source: "mock"` results are not stored.
- `cloud/worker/src/index.ts` — `POST /predict/:kind` stores `model_results` and, for `risk`, `risk_scores`. `GET /eva/window` adds the NOAA Kp rule and, when the gateway is up, forwards to EVA-12.
- `cloud/worker/src/metricModels.ts` — `GET /users/:id/metric-models`. Heart rate, HRV, and ECG irregularity map to EVA-6/EVA-13. Sleep hours map to EVA-4/EVA-14. EEG drowsiness maps to EVA-2. Daily radiation maps to EVA-12. Blood pressure, temperature, SpO2, respiration, and glucose have **no** matching model, so the dialog shows no percent.
- `EVAde/src/components/MetricModelDialog.tsx` — astronaut vital tiles and the flight-surgeon chart button.
- `EVAde/src/components/SpaceWeatherPanel.tsx` — next EVA window. The window times are the NOAA Kp rule (`source: noaa-kp-rule` in `cloud/worker/src/evaWindow.ts`), the same rule as `cloud/python/evade_space/space_weather.py`. EVA-12's probability is shown only when the gateway returns `p_onset_24h`.
- `EVAde/src/pages/ModelsPage.tsx` — transparency page.
- `EVAde/src/pages/surgeon/DeepModelResults.tsx` and `EVAde/src/components/ModelResultsPanel.tsx` — last stored ECG/sleep flags.
- `pi-sim/` — builds the waveform requests the gateway expects. It does not contain weights.

Tables: `model_results` and `risk_scores` in D1 database **evade-db** (binding `DB` on Worker `evade-api`). The model service's own D1 database **evade-models** (not bound by `evade-api`) holds pseudonymous `inputs`, `flags`, `risk_results`, and `baselines` for the container. See `evade/storage/schema.sql` in Michael's repo.

### What cannot run inside the Worker

Joblib files unpickle Python code. ONNX needs onnxruntime. Neither belongs in a Cloudflare Worker isolate, and the coefficients are not published in git, so this repo does not reimplement EVA-12's logistic regression. Copying a percent from the NOAA rule and labeling it EVA-12 would be a fabricated prediction. The UI says when the gateway did not run.

`seizure-deep` (EVA-15) stays unused on purpose: Michael's registry says it lost to EVA-2.

## Workers AI — selfie assessment (not Michael)

- **Model:** `@cf/llava-hf/llava-1.5-7b-hf` (LLaVA 1.5 7B), binding `AI` on Worker **`evade-api`**.
- **Why this and not Grok:** Grok already does journal text, the companion, staff summaries, and voice. It does not see the photo unless the image is uploaded to xAI. LLaVA runs on Cloudflare next to the R2 object, so the selfie stays in the same account. The project is already deployed on Cloudflare Workers.
- **Code:** `cloud/worker/src/selfieAnalysis.ts`, called from `POST /media` when `kind=photo` in `cloud/worker/src/index.ts`.
- **Storage:** D1 `media.analysis` (JSON), `mood_label`, `analysis_confidence`, `analysis_model`, `analyzed_at` on **evade-db**. The file bytes are in R2 bucket `evade-media`.
- **Flight surgeon:** astronaut record → **Selfies** → **View analysis**. A missing binding or a non-JSON reply is stored as `unavailable` / `unparsed` with no invented mood. A `message` notification tells the astronaut the selfie was sent.
- **If `AI` is not bound:** the photo still saves; the modal explains that the vision model did not run.

## xAI Grok (not Michael)

Used for language and speech, with secret `XAI_API_KEY` on the Workers that call xAI.

| What | Model vars | Code | Stored in |
| --- | --- | --- | --- |
| Journal analysis, companion, staff summary, daily briefing | `XAI_TEXT_MODEL`, `XAI_FALLBACK_TEXT_MODEL` on `evade-api` | `cloud/worker/src/ai.ts`, `companion.ts`, `evaCompanion.ts` | `journal_entries` (`ai_summary`, `sentiment`, `mood_label`, `concern_level`, `analysis_model`), `journal_messages.model` |
| Voice transcription | `XAI_STT_MODEL` | `cloud/worker/src/ai.ts` | journal text; audio in R2 via `media` |
| Phone and browser voice | `XAI_MODEL` (`grok-voice-latest`) on Worker `evade` | `worker/src/` | voice Worker D1 `evade`: `checkins`, `sessions` |

If `XAI_API_KEY` is missing, those paths fall back to rules or return 503 for speech-to-text. They do not pretend to be Michael's models.

## Onboard risk math (not a trained model)

`cloud/worker/src/health.ts` and Michael's `evade/risk/engine.py` (noisy-OR risk score, design constants from the literature review, not a fitted clinical model) score domains from thresholds and baselines. Rows land in `risk_scores` with `source` `worker` or `fastapi`. The dashboard label is a risk band, not a percent from EVA-6 or EVA-12.

`GET /eva/window`'s clock times use the NOAA Kp rule in `cloud/worker/src/evaWindow.ts`. That rule is also in `cloud/python/evade_space/space_weather.py`. It is labeled `noaa-kp-rule` everywhere it is shown.

## USDA food search (not a model)

`GET /foods/search` in `cloud/worker/src/webapp.ts` merges the D1 `foods` pantry with USDA FoodData Central and Open Food Facts. The USDA key is the Worker secret **`USDA_API_KEY` on `evade-api`** (`cloud/worker`). It is not sent to the browser. With no key, USDA is skipped and the pantry plus Open Food Facts still return results.

## Databases touched by models

| Database | Binding | Used for models |
| --- | --- | --- |
| `evade-db` | `evade-api` `DB` | `model_results`, `risk_scores`, `media` (selfie analysis), `space_weather` (NOAA rows, not EVA-12 weights) |
| `evade-models` | not bound in this repo; Michael's API via `CF_D1_DATABASE_ID` | `inputs`, `flags`, `risk_results`, `baselines`, `user_state` |
| `evade` | Worker `evade` `DB` | voice check-ins only; no ML weights |
| `evade-reference` | no binding in this repo | not referenced |
