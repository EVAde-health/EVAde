<div align="center">

# 🛰️ EVAde

### Space health data for long-duration missions

**NASA Space Apps Challenge 2026 · NYU Tandon · Team EVAde**

*EVA (spacewalk) + evade: dodge the hazards of deep space.*

</div>

> **The challenge:** Long missions expose astronauts to radiation, isolation, altered gravity and a hostile closed environment, which can bring immune changes, bone loss, cardiovascular events and behavioral-health problems. Astronauts carry much of the responsibility for spotting these changes in themselves. Build health-monitoring software that gathers health indicators and helps astronauts evaluate and act on their health.

This repo is our **data collection**: every dataset, published value and live feed we gathered to build EVAde, with sources and an evidence label on each number.

For production releases, follow [DEPLOY.md](DEPLOY.md) from `main`.

---

## Contents
1. [At a glance](#-at-a-glance)
2. [Radiation](#%EF%B8%8F-radiation)
3. [Solar storms & space weather](#%EF%B8%8F-solar-storms--space-weather)
4. [Body: bone, muscle, heart, sleep, brain, immune](#-body)
5. [Datasets for training](#-datasets-for-training)
6. [NASA data sources](#-nasa-data-sources)
7. [Live feeds](#-live-feeds)
8. [Data files in this repo](#-data-files-in-this-repo)
9. [How we planned it](#-how-we-planned-it)
10. [Caveats](#%EF%B8%8F-caveats)
11. [Sources](#-sources)

---

## ✨ At a glance

| | Number | Source |
|---|---|---|
| ☢️ Radiation on the ISS | **0.43 mSv/day** | NASA Twins Study |
| ☢️ Radiation on the way to Mars | **1.84 mSv/day** (~4× the ISS) | Curiosity rover |
| 🚫 NASA career radiation limit | **600 mSv** | NASA |
| 🦴 Hip bone loss | **−0.5%/month** with exercise, **−1.56%** without | NASA Bone Evidence Report |
| 😴 Sleep on the ISS | **6.1 h** vs 8.5 h scheduled | Barger 2014 |
| 🧍 Can't stand 10 min on landing day | **60–80%** of crew | Lee 2020 |
| 🦠 Crew shedding latent viruses | **61%** | Rooney 2019 |
| 📡 Signal delay to Mars | **3–22 min** one way | NASA |

**Evidence labels used throughout:** **backed** = value or direction from a study · **derived** = our arithmetic on a study's value · **modelled** = simulation from a study · **illustrative** = chosen for a demo (never presented as a result).

---

## ☢️ Radiation

![Radiation dose by destination](docs/images/radiation_by_destination.png)

| Where | Dose per day | Detail | Evidence |
|---|---|---|---|
| Earth surface | ~0.008 mSv | ~3 mSv a year from all sources | measured |
| Space station (ISS) | **0.43 mSv** (0.2–0.65) | Twins Study: 146 mSv in 340 days. Columbus module absorbed dose 195–360 µGy/day; peak 647 µSv/day (May 2016). About 44% cosmic rays, 56% South Atlantic Anomaly | measured / derived |
| Mars surface | **0.64 mSv** | Curiosity at Gale Crater, first 300 sols (0.21 mGy/day absorbed) | measured |
| Moon trip (Artemis I Orion) | **0.96–1.24 mSv** | 26.7–35.4 mSv over the 25.5-day mission; 1.8–3.9 mSv from the Van Allen belts | measured |
| Mars transit | **1.84 mSv** | Inside the spacecraft; round-trip transit ≈ 0.66 Sv | measured |
| Mars reference mission | **≈ 1.01 Sv total** | 180 days out + 500 on the surface + 180 back, about 1.7× NASA's limit | derived (RAD team) |

![Cumulative radiation over six months](docs/images/cumulative_radiation.png)

**Limits:** NASA career **600 mSv** · NASA per solar event **250 mSv** · ESA career **1 Sv**.

---

## ☀️ Solar storms & space weather

![Solar storm comparisons](docs/images/solar_storms.png)

- **Sept 10, 2017 storm:** 67.8 µGy inside the ISS vs **418 µGy on Mars' surface**, about 6× more, because Earth's magnetic field shields the ISS.
- **Aug 1972 storm** (between Apollo 16 and 17): an unshielded moonwalker could have received **~400 rem (4 Sv)**, versus **under 35 rem** inside the Apollo capsule.
- **Shielding vest** (AstroRad, modelled on Artemis I data): Aug 1972 storm dose 233.6 → **89.4 mSv** (−62%); Oct 1989 storm 249.9 → **149.4 mSv** (−40%).
- **Storm shelter:** in Orion, the Oct 1989 reference storm peaks at 414 µGy/min in the cabin vs **95 µGy/min** in the shelter.

![NOAA solar radiation storm scale](docs/images/noaa_s_scale.png)

| Level | ≥10 MeV proton flux | How often (per 11-year cycle) | What to do |
|---|---|---|---|
| S1 Minor | ≥ 10 pfu | ~50 | Keep dosimeter on, review shelter plan |
| S2 Moderate | ≥ 100 pfu | ~25 | Postpone non-essential spacewalks |
| S3 Strong | ≥ 1,000 pfu | ~10 | Cancel spacewalks, go to shelter |
| S4 Severe | ≥ 10,000 pfu | ~3 | Shelter, log dose hourly |
| S5 Extreme | ≥ 100,000 pfu | < 1 | Shelter until the all-clear |

A storm starts when ≥10 MeV flux reaches 10 pfu. **Idea from our board:** use this feed to predict the next safe window for a spacewalk.

---

## 🫀 Body

### Bone & muscle

![Bone loss with and without exercise](docs/images/bone_loss.png)

| Indicator | Change in long-duration flight | Evidence |
|---|---|---|
| Hip bone density | **−0.5%/month** with ARED (range −1.34 to −0.07); **−1.56%/month** without | backed |
| Spine bone density | **−0.32%/month** with ARED; **−1.06%/month** without | backed |
| Bone recovery | Takes **6+ months** after landing; some deficits 2–4 years later | backed |
| Calf muscle volume | **−10 to −18%** over ~6 months | backed |
| Leg strength | **−6 to −17%** | backed |
| Aerobic fitness (VO2peak) | **−17%** by flight day 14; −15% on landing day | backed |

### Sleep

![Sleep on the ISS](docs/images/sleep.png)

| Indicator | Value | Evidence |
|---|---|---|
| Sleep on the ISS | **6.09 h/night** (n=21) vs 8.5 h scheduled | backed |
| Used sleep medication | **75%** of crew | backed |
| Sleep periods out of sync with the body clock | **19%**, costing about 1 h of sleep each | backed |
| Mars-500 (520-day analog) | 7.12 → 7.71 h per 24 h across mission quarters | backed (analog) |

### Heart & circulation

| Indicator | Change | Evidence |
|---|---|---|
| Resting heart rate | **Unchanged** in flight | backed |
| 24-h blood pressure | **−8 / −9 mmHg** | backed |
| Cardiac output | **+41%** | backed |
| HRV (RMSSD) | Dips by ~day 22, recovered by ~day 159. **Not** a steady decline | backed (preprint) |
| Landing day | **60–80%** fail a 10-min tilt test; standing HR +10–15 bpm | backed |
| Atrial arrhythmia in astronaut corps | 17 of 317 (~5%); no proof spaceflight raises it | review |

### Brain, cognition, mood & immune

| Indicator | Finding | Evidence |
|---|---|---|
| Resting EEG alpha power | **Drops** in flight (days 9 and 55), still low 20 days after landing | backed (direction only) |
| EEG in bed rest | One-time drop in all bands, no further drift over 60 days | backed |
| Cognition (n=25) | **No overall decline**; slower processing speed early in flight | backed |
| "Third-quarter" mood slump | **Not supported** (meta-analysis of 21 Antarctic studies) | backed |
| Latent virus shedding | **61%** of ISS crew (EBV 96%), mostly no symptoms; up to ~30 days after landing | backed |
| Body mass (Twins Study, 340 days) | −7% (one person) | backed |

### Communication
| | Value |
|---|---|
| Mars one-way signal delay | **3–22 minutes** |
| Solar conjunction blackout | **~12 days** (9–16) |

---

## 🧠 Datasets for training

| Dataset | What's in it | Labels | Access | Link |
|---|---|---|---|---|
| **SAM40** | EEG from 40 people (18–25), 32 channels, 128 Hz. Stroop, arithmetic, mirror-image and relax tasks; 25 s trials × 3 | Self-rated stress 1–10 | ✅ Free, instant | [Figshare](https://doi.org/10.6084/m9.figshare.14562090.v1) |
| **WESAD** | 15 people. Chest sensor (ECG, skin conductance, EMG, breathing, temperature) at 700 Hz, plus wrist sensor | Baseline · stress · amusement · meditation | ✅ Free | [UCI](https://doi.org/10.24432/C57K5T) |
| **DEAP** | 32 people × 40 music videos. 32-ch EEG (512 Hz) + body signals | Valence, arousal, dominance, liking 1–9 | ⚠️ Signed licence | [QMUL](https://www.eecs.qmul.ac.uk/mmv/datasets/deap) |

> **No freely downloadable raw astronaut EEG or ECG exists.** Public lab datasets are the realistic starting point. Check each dataset's licence before redistributing.

---

## 🚀 NASA data sources

| Source | What's in it | Access | Link |
|---|---|---|---|
| **NASA Human Research Program evidence reports** | The published values above (bone, muscle, sleep, cardiovascular…) | Free PDFs | see [Sources](#-sources) |
| **NASA OSDR: Inspiration4** | Omics from blood, plasma, serum, swabs, skin, stool, urine, T-cells; pre-, in- and post-flight (also OSD-570 to 575, 630, 656, 687) | Processed data public; raw needs application | [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) |
| **NASA Life Sciences Data Archive** | De-identified astronaut + analog data since 1961; open bed-rest datasets (UTMB Campaigns 1, 3, 11) | By request | [NASA portal](https://www.nasa.gov/?p=900029) |

---

## 📡 Live feeds

| Feed | What it gives | Key? | URL |
|---|---|---|---|
| **NOAA GOES proton flux** | ≥1, ≥10, ≥100 MeV protons every 5 min, last 24 h | No | [JSON](https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json) |
| **NOAA space weather scales** | Current + forecast R/S/G storm levels | No | [JSON](https://services.swpc.noaa.gov/products/noaa-scales.json) |
| **NASA DONKI SEP** | Catalogue of past solar particle events | `DEMO_KEY` (free key at api.nasa.gov) | [API](https://api.nasa.gov/DONKI/SEP?startDate=2024-01-01&endDate=2024-12-31&api_key=DEMO_KEY) |

Each NOAA record looks like `{"time_tag": "…Z", "satellite": 18, "flux": 0.3, "energy": ">=10 MeV"}`. Negative flux means missing data.

---

## 📁 Data files in this repo

| File | Contents |
|---|---|
| [`data/mission_trends.json`](data/mission_trends.json) | 34 published health values + 14 mission-timeline events, each with a source URL and evidence label |
| [`data/radiation_data.json`](data/radiation_data.json) | Dose rates by destination, limits, solar-storm events, NOAA S-scale, live feed URLs |
| [`data/research_trends.md`](data/research_trends.md) | Full research brief: findings, a suggested 6-month mission storyline, caveats |
| [`docs/images/`](docs/images/) | The charts in this README, drawn directly from the JSON files |

---

## 🧭 How we planned it

<table>
<tr>
<td width="50%"><img src="docs/whiteboard/architecture-board.jpg" alt="Architecture whiteboard"/></td>
<td width="50%"><img src="docs/whiteboard/task-board.jpg" alt="Task whiteboard"/></td>
</tr>
<tr>
<td><b>Architecture board:</b> risks and indicators feed a frontend with AI, a database for tracking over time, Cloudflare, and Twilio voice AI.</td>
<td><b>Task board:</b> who does what, tools and sponsors, environments, and questions for event leaders.</td>
</tr>
</table>

**What we set out to collect (from the board):**
- **Space-health risks:** radiation · immune changes · bone density loss · cardiovascular events · inadequate nutrition · behavioral health
- **Indicators:** blood pressure · blood sugar · heart rate · body temperature · sleep hours · mood · EEG · ECG
- **Data:** space radiation & weather · body data · NASA Human Research Program resources
- **Environments:** space station · spacecraft · base on another planet · space rover

**Questions we answered with the data:**

| Question | Answer |
|---|---|
| Wi-Fi in space? | ISS has a ground link; Mars has a 3–22 min delay and ~2-week blackouts, so store locally and sync when possible |
| Which measurements can be performed in space? | ECG, blood pressure, temperature, body mass, sleep tracking, cognition tests, saliva/blood samples, personal dosimeters; EEG in research |
| How do spaceflight hazards affect these indicators? | See [Body](#-body) and [Radiation](#%EF%B8%8F-radiation) |
| What changes across environments? | Radiation rises from 0.43 (ISS) to 1.84 mSv/day (Mars transit); the comms delay grows to 22 min; only the ISS is shielded by Earth's magnetic field |

---

## ⚠️ Caveats
- Spaceflight studies are small (n = 1–25) and individuals vary a lot, so compare each astronaut with their **own** baseline.
- The HRV trend comes from a non-peer-reviewed preprint.
- EEG papers give the **direction** of change, not its size.
- Radiation varies with the solar cycle, shielding and orbit altitude; 1.84 mSv/day was measured near solar maximum.
- Some numbers come from NASA reports or press releases summarising the original papers (noted in `data/mission_trends.json`).

---

## 📚 Sources

**Radiation & space weather**
- [NASA Twins Study (Science, 2019)](https://lsom.uthscsa.edu/nephrology/wp-content/uploads/sites/38/2019/04/NASA-twin-study_Science.pdf)
- [DOSIS 3D, ISS Columbus (Space Weather & Space Climate, 2016)](https://www.swsc-journal.org/articles/swsc/pdf/2016/01/swsc160033.pdf)
- [DOSIS 3D peak dose (2017)](https://www.swsc-journal.org/articles/swsc/abs/2017/01/swsc160046/swsc160046.html)
- [Artemis I radiation (Nature, 2024)](https://doi.org/10.1038/s41586-024-07927-7)
- [Curiosity: Mars transit](https://phys.org/news/2013-12-scientists-publish-surface-mars.amp)
- [Curiosity: Mars surface](https://www.sciencedaily.com/releases/2013/12/131209181133.htm)
- [Mars reference mission](https://www.space.com/23875-mars-radiation-life-manned-mission.html)
- [DLR: Sept 2017 storm](https://elib.dlr.de/120788/1/ME-SBA-2018-Berger-Matthi%C3%A4_et%20al-DOSIS-3D_Space%20Weather.pdf)
- [August 1972 storm](https://www.space.com/749-bad-week-moon.html)
- [AstroRad vest (IAC 2024)](https://iafastro.directory/iac/paper/id/90503/abstract-pdf/IAC-24,A1,5,7,x90503.brief.pdf)
- [NASA radiation limits (OCHMO)](https://www.nasa.gov/sites/default/files/atoms/files/radiation_protection_technical_brief_ochmo.pdf)
- [NOAA S-scale](https://spaceweather.live/en/help/what-is-a-solar-radiation-storm)

**Body**
- [NASA Bone Evidence Report](https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf)
- [NASA Muscle & Aerobic Evidence Report](https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf)
- [NASA Sleep Evidence Report](https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf)
- [Barger 2014 (sleep)](https://www.eurekalert.org/news-releases/595450)
- [Norsk 2015 (heart & BP)](https://synapsesocial.com/papers/W1944333689)
- [Otsuka (HRV, preprint)](https://www.researchsquare.com/article/rs-2106983/v1)
- [Lee 2020 (landing)](https://www.frontiersin.org/article/10.3389/fphys.2020.00784)
- [Pusil 2023 (EEG)](https://www.nature.com/articles/s41598-023-34744-1.pdf)
- [Dev 2024 (cognition)](https://frontiersin.org/journals/physiology/articles/10.3389/fphys.2024.1451269/full)
- [Rooney 2019 (viruses)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6374706)
- [Hawkes & Norris 2017 (mood)](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/S003224741700050X)
- [Basner 2013 (Mars-500)](https://www.med.upenn.edu/uep/assets/user-content/documents/PNAS2013Basner1212646110withSupportingAppendix.pdf)
- [NASA: Mars comms delay](https://science.nasa.gov/missions/mars-2020-perseverance/speaking-percys-language-how-to-talk-so-perseverance-will-listen/)
