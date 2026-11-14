# EVAde Data Sources

Every NASA data source and reference cited in this project, with where it appears in the repo.

> Note: These are all cited in `README.md`. No committed code currently loads NASA data. The files the README refers to (`docs/mission_trends.json`, `docs/radiation_data.json`, `docs/research_trends.md`, `stream/space_weather.py`) aren't in the repo yet.

## NASA data archives

| Source | How it's used | Where in repo |
|---|---|---|
| [NASA OSDR: Inspiration4 (OSD-569; also OSD-570 to 575, 630, 656, 687)](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) | Future work. Processed omics data is public; raw data requires an application. | [README L211](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L211) |
| [NASA Life Sciences Data Archive (LSDA)](https://www.nasa.gov/hrp/nlsp/) | Future work. Astronaut and analog data available by request (UTMB bed-rest campaigns 1, 3, 11). | [README L212](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L212) |
| [NASA DONKI SEP API](https://api.nasa.gov) | Planned (storm replay idea). Queries are limited to 60 days per request. | [README L221](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L221) |

## NASA Human Research Program evidence reports

Listed together at [README L213](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L213). These are the published values behind the key numbers and the planned 180-day mission trends.

| Source | How it's used | Where in repo |
|---|---|---|
| [NASA Bone Evidence Report (NTRS)](https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf) | Hip bone loss: -0.5%/month with ARED exercise vs -1.56%/month without | [README L367](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L367) |
| [NASA Muscle & Aerobic Evidence Report (NTRS)](https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf) | Calf volume and VO2peak changes in long-duration flight | [README L368](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L368) |
| [NASA Sleep Evidence Report (NTRS)](https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf) | ISS sleep: about 6.1 h/night, sleep medication use, misaligned sleep | [README L369](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L369) |

## NASA radiation and mission references

| Source | How it's used | Where in repo |
|---|---|---|
| [NASA Twins Study (Science, 2019)](https://lsom.uthscsa.edu/nephrology/wp-content/uploads/sites/38/2019/04/NASA-twin-study_Science.pdf) | ISS daily radiation dose of about 0.43 mSv | [README L382](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L382) |
| [Artemis I / Orion radiation (George et al., Nature 2024)](https://doi.org/10.1038/s41586-024-07927-7) | Moon-trip dose rates of 0.96 to 1.24 mSv/day; 26.7 to 35.4 mSv over 25.5 days | [README L385](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L385) |
| Curiosity RAD: [Mars surface dose (ScienceDaily)](https://www.sciencedaily.com/releases/2013/12/131209181133.htm), [transit dose (Phys.org)](https://phys.org/news/2013-12-scientists-publish-surface-mars.amp) | Mars surface about 0.64 mSv/day; transit about 1.84 mSv/day | [README L386-L387](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L386-L387) |
| [NASA OCHMO Radiation Protection Technical Brief](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-020-radiation-protection.pdf) | NASA career limit of 600 mSv; 250 mSv per solar event | [README L391](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L391) |
| [NASA: Speaking Percy's Language (Perseverance)](https://science.nasa.gov/blog/speaking-percys-language-how-to-talk-so-perseverance-will-listen/) | 20-minute Mars communication delay in the check-in comms-mode demo | [README L379](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L379) |

## Non-NASA data sources

### Space weather (NOAA)

| Source | How it's used | Where in repo |
|---|---|---|
| [NOAA GOES ≥10 MeV proton flux](https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json) | Live feed for mission trends (planned in `stream/space_weather.py`) | [README L219](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L219) |
| [NOAA R/S/G space weather scales](https://services.swpc.noaa.gov/products/noaa-scales.json) | Not yet used | [README L220](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L220) |
| [What is a solar radiation storm? (SpaceWeatherLive)](https://www.spaceweatherlive.com/en/help/what-is-a-solar-radiation-storm.html) | S-scale explainer | [README L392](https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/README.md#L392) |

### EEG / ECG training datasets (planned)

There is no free raw astronaut EEG/ECG data, so public lab datasets are planned instead.

- [SAM40](https://doi.org/10.6084/m9.figshare.14562090.v1)
- [WESAD](https://doi.org/10.24432/C57K5T)
- DEAP (the original link, eecs.qmul.ac.uk/mmv/datasets/deap, is currently down; marked "skip this weekend")

---
*Line links point to the `feature/twilio-grok-voice-agent` branch. The repo is private, so they open only for collaborators.*
