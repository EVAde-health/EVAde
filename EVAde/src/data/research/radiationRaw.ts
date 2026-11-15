// Published NASA and peer-reviewed reference values (not user readings). Each one cites its source.
export const RADIATION_RAW = {
  "_meta": {
    "title": "Space radiation reference data for EVAde",
    "collected": "2026-11-14",
    "units_note": "Gy (gray) = absorbed energy; Sv (sievert) = dose equivalent / biological effect. 1 mSv = 1000 µSv. Values are as published; 'derived' marks our arithmetic.",
    "evidence_labels": "measured = instrument data; modelled = transport-code or simulation estimate; derived = our arithmetic on a published value; illustrative = chosen for the demo"
  },
  "environments": {
    "earth_surface": {
      "dose_equivalent_msv_per_year": 3,
      "note": "Average American, all sources (natural + medical), for comparison",
      "evidence": "measured",
      "source": "https://www.csmonitor.com/Science/2013/1209/Curiosity-measures-radiation-at-Martian-surface"
    },
    "iss_leo": {
      "dose_equivalent_msv_per_day": 0.43,
      "dose_equivalent_range_msv_per_day": [
        0.2,
        0.65
      ],
      "absorbed_dose_ugy_per_day_range": [
        195,
        360
      ],
      "peak_dose_equivalent_usv_per_day": 647,
      "composition": "about 44% galactic cosmic rays, 56% South Atlantic Anomaly (trapped protons)",
      "drivers": "solar cycle (more GCR at solar minimum) and ISS altitude (higher orbit = more trapped protons)",
      "evidence": "measured",
      "source": "https://www.swsc-journal.org/articles/swsc/pdf/2016/01/swsc160033.pdf",
      "source_peak": "https://www.swsc-journal.org/articles/swsc/abs/2017/01/swsc160046/swsc160046.html",
      "source_composition": "https://elib.dlr.de/120788/1/ME-SBA-2018-Berger-Matthi%C3%A4_et%20al-DOSIS-3D_Space%20Weather.pdf",
      "source_0_43": "https://lsom.uthscsa.edu/nephrology/wp-content/uploads/sites/38/2019/04/NASA-twin-study_Science.pdf",
      "note": "0.43 mSv/day is derived from the NASA Twins Study (146 mSv over 340 days). Columbus-module DOSIS 3D absorbed dose: 195-270 µGy/day in 2010 (minimum) up to 260-360 µGy/day in 2012 (maximum), depending on detector location"
    },
    "cislunar_orion_artemis1": {
      "gcr_dose_equivalent_msv_per_day": [
        0.96,
        1.24
      ],
      "mission_total_msv": [
        26.7,
        35.4
      ],
      "van_allen_belt_contribution_msv": [
        1.8,
        3.94
      ],
      "mission_days": 25.5,
      "belt_peak_ugy_per_min": {
        "most_shielded_M42": 69,
        "storm_shelter_HERA_HSU1": 134,
        "EAD": 240,
        "crew_cabin_HERA_HSU2": 287
      },
      "evidence": "measured",
      "source": "https://doi.org/10.1038/s41586-024-07927-7",
      "note": "George et al. 2024, Nature. Uncrewed Orion, Nov-Dec 2022. Total depends on location inside the capsule. Rotating Orion during one manoeuvre cut belt dose rates by about 50%"
    },
    "mars_transit": {
      "dose_equivalent_msv_per_day": 1.84,
      "round_trip_transit_total_sv": 0.66,
      "evidence": "measured",
      "source": "https://phys.org/news/2013-12-scientists-publish-surface-mars.amp",
      "source_also": "https://www.nbcnews.com/sciencemain/radiation-mars-manageable-manned-mission-curiosity-finds-2D11716674",
      "note": "Curiosity RAD inside the MSL spacecraft, Nov 2011-Jul 2012, near solar maximum. GCR only; a large solar storm would add to this"
    },
    "mars_surface": {
      "dose_equivalent_msv_per_day": 0.64,
      "dose_equivalent_alt_msv_per_day": 0.67,
      "absorbed_mgy_per_day": 0.21,
      "absorbed_mgy_per_day_sd": 0.04,
      "evidence": "measured",
      "source": "https://www.sciencedaily.com/releases/2013/12/131209181133.htm",
      "source_paper": "https://doi.org/10.1126/science.1244797",
      "note": "Hassler et al. 2014, Science. Gale Crater, first 300 sols (Aug 2012-Jun 2013). The thin atmosphere and the planet itself block about half the sky, so the rate is roughly a third of transit"
    },
    "mars_reference_mission": {
      "profile": "180 d out + 500 d surface + 180 d back",
      "total_sv": 1.01,
      "evidence": "derived (by the RAD team)",
      "source": "https://www.space.com/23875-mars-radiation-life-manned-mission.html",
      "note": "About 1.7x NASA's 600 mSv career limit"
    }
  },
  "limits": {
    "nasa_career_effective_dose_msv": 600,
    "nasa_spe_event_limit_msv": 250,
    "esa_career_sv": 1.0,
    "source": "https://www.nasa.gov/sites/default/files/atoms/files/radiation_protection_technical_brief_ochmo.pdf",
    "source_esa": "https://www.nbcnews.com/sciencemain/radiation-mars-manageable-manned-mission-curiosity-finds-2D11716674"
  },
  "solar_particle_events": {
    "noaa_s_scale": {
      "measure": "5-minute average flux of >= 10 MeV protons at GOES (geosynchronous orbit), in pfu (particles / cm2 / s / sr)",
      "storm_start": "flux >= 10 pfu",
      "levels": [
        {
          "level": "S1",
          "name": "Minor",
          "pfu": 10,
          "per_11yr_cycle": "about 50"
        },
        {
          "level": "S2",
          "name": "Moderate",
          "pfu": 100,
          "per_11yr_cycle": "about 25"
        },
        {
          "level": "S3",
          "name": "Strong",
          "pfu": 1000,
          "per_11yr_cycle": "about 10"
        },
        {
          "level": "S4",
          "name": "Severe",
          "pfu": 10000,
          "per_11yr_cycle": "about 3"
        },
        {
          "level": "S5",
          "name": "Extreme",
          "pfu": 100000,
          "per_11yr_cycle": "fewer than 1"
        }
      ],
      "source": "https://spaceweather.live/en/help/what-is-a-solar-radiation-storm",
      "source_definition": "https://webarchive.library.unt.edu/web/20170121111415/http://www.swpc.noaa.gov/phenomena/solar-radiation-storm",
      "note": "Thresholds and frequencies as published by NOAA SWPC"
    },
    "events": [
      {
        "name": "10 September 2017 SPE",
        "iss_dose_ugy_si": 67.8,
        "mars_surface_dose_ugy_si": 418,
        "evidence": "measured",
        "source": "https://elib.dlr.de/120788/1/ME-SBA-2018-Berger-Matthi%C3%A4_et%20al-DOSIS-3D_Space%20Weather.pdf",
        "lesson": "The same solar storm gave about 6x more dose on Mars than inside the ISS, which sits inside Earth's magnetic field"
      },
      {
        "name": "August 1972 SPE (between Apollo 16 and 17)",
        "unshielded_moonwalker_rem": 400,
        "inside_apollo_cm_bfo_rem_max": 35,
        "evidence": "modelled",
        "source": "https://www.space.com/749-bad-week-moon.html",
        "lesson": "400 rem = 4 Sv (life-threatening without care); the command module's hull cut it to under 0.35 Sv at the blood-forming organs. Shielding and sheltering are the main countermeasure"
      },
      {
        "name": "Shielding vest during reference SPEs (Artemis I AstroRad model)",
        "aug1972_effective_dose_msv": {
          "no_vest": 233.6,
          "vest": 89.4
        },
        "oct1989_effective_dose_msv": {
          "no_vest": 249.9,
          "vest": 149.4
        },
        "evidence": "modelled (validated against Artemis I belt data)",
        "source": "https://iafastro.directory/iac/paper/id/90503/abstract-pdf/IAC-24,A1,5,7,x90503.brief.pdf"
      },
      {
        "name": "October 1989 SPE in Orion (reference)",
        "peak_ugy_per_min": {
          "crew_cabin": 414,
          "storm_shelter": 95
        },
        "evidence": "modelled from Artemis I shielding data",
        "source": "https://doi.org/10.1038/s41586-024-07927-7",
        "lesson": "The storm shelter cuts the peak dose rate about 4x"
      }
    ]
  },
  "live_feeds": {
    "noaa_goes_integral_protons_1day": {
      "url": "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json",
      "what": "GOES proton flux (>=1, >=10, >=100 MeV ...) at 5-minute cadence for the last 24 h. Free, no key",
      "used_by": "stream/space_weather.py"
    },
    "noaa_scales_now": {
      "url": "https://services.swpc.noaa.gov/products/noaa-scales.json",
      "what": "Current and forecast NOAA R/S/G storm levels. Free, no key"
    },
    "nasa_donki_sep": {
      "url": "https://api.nasa.gov/DONKI/SEP?startDate=2024-01-01&endDate=2024-12-31&api_key=DEMO_KEY",
      "what": "NASA catalogue of past solar energetic particle events (dates, instruments). Free; DEMO_KEY is rate-limited, get a free key at api.nasa.gov"
    }
  }
} as const;
