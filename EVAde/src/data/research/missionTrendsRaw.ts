// Published NASA and peer-reviewed reference values (not user readings). Each one cites its source.
export const MISSION_TRENDS_RAW = {
  "_meta": {
    "description": "Published spaceflight / analog health trends for driving the EVAde mission-trend simulator. Every value carries a source URL. 'derived' = arithmetic on a published value, not stated by the source. 'illustrative' = shape chosen for the demo, not a measured trend.",
    "compiled": "2026-11-14",
    "default_profile": "ISS ~6-month long-duration mission with ARED exercise countermeasure"
  },
  "mission_days": 180,
  "metrics": {
    "bone_density_pct_change_per_month_hip_with_ared": {
      "value": -0.5,
      "range": [
        -1.34,
        -0.07
      ],
      "sd": 0.4,
      "unit": "% aBMD per month (hip trochanter, DXA)",
      "trend": "linear decline through mission; recovery after landing slower than loss",
      "source": "https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf",
      "note": "NASA HRP Bone Fracture Evidence Report 2017, Table 4, n=11 ISS crew with ARED"
    },
    "bone_density_pct_change_per_month_spine_with_ared": {
      "value": -0.32,
      "range": [
        -1.35,
        -0.16
      ],
      "sd": 0.44,
      "unit": "% aBMD per month (lumbar spine)",
      "source": "https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf"
    },
    "bone_density_pct_change_per_month_hip_no_ared": {
      "value": -1.56,
      "range": [
        -3.0,
        -0.01
      ],
      "sd": 0.99,
      "unit": "% aBMD per month (hip trochanter), pre-ARED era (iRED only)",
      "source": "https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf",
      "also": "https://nasa.gov/wp-content/uploads/2013/10/issrdc_2013-07-16-0945_lang20132.pdf (Mir hip 1-1.5%/month, spine ~1%/month)"
    },
    "bone_density_pct_change_per_month_spine_no_ared": {
      "value": -1.06,
      "range": [
        -2.0,
        0.0
      ],
      "sd": 0.63,
      "unit": "% aBMD per month (lumbar spine), pre-ARED",
      "source": "https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf"
    },
    "bone_recovery": {
      "value": "restoration to preflight may take >= 6 months after return; trabecular deficits seen 2-4 years later in some crew",
      "source": "https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf"
    },
    "calf_muscle_volume_pct_change_mission": {
      "value": -13,
      "range": [
        -18,
        -10
      ],
      "unit": "% at ~R+4-5 after ~6 months",
      "source": "https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf",
      "also": "https://blogs.scientificamerican.com/news-blog/spaceflight-wreaks-havoc-on-astrona-2009-04-08/ (Trappe et al., J Appl Physiol, n=9, mean -13% calf volume over 6 months)"
    },
    "thigh_muscle_volume_pct_change_mission": {
      "value": null,
      "range": [
        -7,
        -4
      ],
      "unit": "% at ~R+4-5",
      "source": "https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf"
    },
    "isokinetic_strength_pct_change_mission": {
      "value": null,
      "range": [
        -17,
        -6
      ],
      "unit": "% pre to post long-duration ISS (pooled); calf strength about -24% ~1 wk post-landing",
      "source": "https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf",
      "note": "ARED (n=66) vs iRED (n=25) isokinetic strength changes did not differ"
    },
    "vo2peak_pct_change": {
      "flight_day_14": -17,
      "landing_R_plus_1": -15,
      "trend": "drops ~17% by FD14, partial recovery in flight but stays below preflight; back to preflight ~R+30",
      "source": "https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf",
      "note": "Moore et al., n=14, 91-192 d missions; ~30% of crew maintained fitness, 53% lost >10%"
    },
    "resting_hr_bpm": {
      "value_change_inflight": 0,
      "baseline_example_bpm": {
        "day_mean": 71.4,
        "night_mean": 56.5
      },
      "trend": "24-h mean HR essentially unchanged in flight; deeper nocturnal HR dip reported",
      "source": "https://synapsesocial.com/papers/W1944333689",
      "source_baseline_example": "https://www.nature.com/articles/s41598-023-36389-6.pdf",
      "source_night_dip": "https://www.researchsquare.com/article/rs-2106983/v1",
      "note": "Norsk et al. 2015 J Physiol, n=8, 85-192 d: HR unchanged. Example values are one astronaut (N-of-1), early flight."
    },
    "rmssd_ms_trend": {
      "baseline_example_ms": 43.45,
      "early_flight_example_ms": 42.45,
      "late_flight_example_ms": 27.16,
      "trend_group": "parasympathetic indices (RMSSD, pNN50, HF) significantly lower at ~day 22; suppression no longer seen at ~day 159 (n=20)",
      "trend_n_of_1": "one astronaut, mission 1: RMSSD MESOR 43.5 -> 42.5 -> 27.2 ms (pre, ~day 18, ~day 67); mission 2: 58.9 -> 34.7 -> 43.9 ms",
      "source": "https://www.researchsquare.com/article/rs-2106983/v1",
      "source_n_of_1": "https://www.nature.com/articles/s41598-023-36389-6.pdf",
      "evidence": "mixed: group data show early dip then recovery, not a monotonic decline; preprint not peer reviewed"
    },
    "sdnn_ms": {
      "preflight": 143.3,
      "early_flight_day_22": 153.4,
      "unit": "ms, 24-h Holter",
      "source": "https://www.researchsquare.com/article/rs-2106983/v1",
      "note": "difference not significant (P=0.068); preprint"
    },
    "blood_pressure_change_mmhg": {
      "systolic": -8,
      "diastolic": -9,
      "mean_arterial": -10,
      "sd_systolic": 2,
      "unit": "mmHg, 24-h ambulatory, in flight vs preflight",
      "source": "https://synapsesocial.com/papers/W1944333689",
      "also": "https://www.news-medical.net/news/20150114/Weightlessness-in-space-causes-blood-shift-in-astronauts.aspx"
    },
    "cardiac_output_pct_change": {
      "value": 41,
      "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4324697",
      "note": "commentary on Norsk et al. 2015"
    },
    "orthostatic_intolerance_landing_day_pct": {
      "value": 60,
      "range": [
        60,
        80
      ],
      "unit": "% of crew unable to complete 10-min 80 deg head-up tilt on landing day after ~6 months",
      "source": "https://www.frontiersin.org/article/10.3389/fphys.2020.00784"
    },
    "postflight_standing_hr_increase_bpm": {
      "value": 15,
      "range": [
        10,
        15
      ],
      "unit": "bpm above preflight (standing, within hours to R+1)",
      "source": "https://www.frontiersin.org/article/10.3389/fphys.2020.00784"
    },
    "atrial_arrhythmia_prevalence_astronaut_corps": {
      "value": 0.05,
      "detail": "17 atrial arrhythmia cases among 317 astronauts; AF most common; no pronounced arrhythmias reported on ISS; one Mir NSVT episode (215 bpm, 14 min)",
      "source": "https://www.frontiersin.org/articles/10.3389/fphys.2023.1162355/pdf",
      "evidence": "opinion/review; no proof spaceflight raises arrhythmia rate"
    },
    "sleep_hours": {
      "inflight_iss": 6.09,
      "preflight_training": 6.4,
      "scheduled": 8.5,
      "range_inflight": [
        6.0,
        6.4
      ],
      "unit": "h/night, actigraphy (n=21 ISS)",
      "source": "https://www.eurekalert.org/news-releases/595450",
      "source_phase": "https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf",
      "note": "Barger 2014: ~19 min less sleep in flight than on ground; sleep logs (Dinges 2013) 6.7 -> 6.4 h"
    },
    "sleep_medication_use": {
      "pct_crew_ever_used_inflight": 75,
      "shuttle_pct_nights": 52,
      "source": "https://www.eurekalert.org/news-releases/595450"
    },
    "circadian_misalignment": {
      "pct_sleep_episodes_misaligned": 19,
      "sleep_loss_when_misaligned_h": 1.0,
      "source": "https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf",
      "note": "Flynn-Evans 2016, n=21 ISS, 3,248 crew-days; misaligned nights also had more medication use"
    },
    "analog_sleep_by_quarter_mars500_h": {
      "values": [
        7.12,
        7.23,
        7.5,
        7.71
      ],
      "first_40_days_h_max": 6.78,
      "unit": "h/24h actigraphy, 520-day Mars-500 (uncorrected; ~26 min overestimate)",
      "source": "https://www.med.upenn.edu/uep/assets/user-content/documents/PNAS2013Basner1212646110withSupportingAppendix.pdf"
    },
    "analog_activity_change_mars500_pct": {
      "active_wake": -7.0,
      "waking_rest": 50.4,
      "light_exposure": -25.6,
      "source": "https://www.med.upenn.edu/uep/assets/user-content/documents/PNAS2013Basner1212646110withSupportingAppendix.pdf"
    },
    "cognition_iss": {
      "processing_speed_dsst_effect_dz": [
        0.72,
        0.78
      ],
      "working_memory_speed_f2b_effect_dz": [
        0.81,
        1.23
      ],
      "pvt_early_flight_effect_dz": 0.5,
      "pct_scores_below_minus_1p5_sd": 11.8,
      "overall": "no systematic decline; slower speed on DSST, F2B; PVT slower early flight only; risk-taking lower late flight",
      "source": "https://frontiersin.org/journals/physiology/articles/10.3389/fphys.2024.1451269/full",
      "note": "Dev et al. 2024, n=25, ~6-month ISS; early-flight test ~day 29"
    },
    "radiation_msv_per_day_iss": {
      "value": 0.43,
      "range": [
        0.2,
        0.5
      ],
      "six_month_total_msv": [
        40,
        90
      ],
      "source": "https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf",
      "source_value": "https://lsom.uthscsa.edu/nephrology/wp-content/uploads/sites/38/2019/04/NASA-twin-study_Science.pdf",
      "note": "0.43 is derived: Twins Study 146.34 mSv effective dose / 340 days"
    },
    "radiation_msv_per_day_mars_transit": {
      "value": 1.8,
      "range": [
        0.6,
        1.8
      ],
      "nasa_design_example": 1.5,
      "source": "https://www.swri.org/newsroom/press-releases/swri-led-team-calculates-the-radiation-exposure-associated-trip-mars",
      "source_range": "https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf",
      "source_design": "https://www.nasa.gov/sites/default/files/atoms/files/radiation_protection_technical_brief_ochmo.pdf",
      "note": "1.8 = Curiosity RAD cruise 2011-12; ~0.66 Sv for round-trip transit. 0.6-1.3 range is GCR free space solar max/min per NASA ASCEND paper (extracted units ambiguous, consistent with 'per day')"
    },
    "radiation_msv_per_day_mars_surface": {
      "range": [
        0.35,
        0.65
      ],
      "source": "https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf",
      "note": "OCHMO brief uses ~0.5 mSv/day for surface"
    },
    "radiation_career_limit_msv": {
      "value": 600,
      "spe_event_limit_msv": 250,
      "source": "https://www.nasa.gov/sites/default/files/atoms/files/radiation_protection_technical_brief_ochmo.pdf"
    },
    "herpesvirus_shedding_pct_iss": {
      "any_virus": 61,
      "ebv_saliva": 96,
      "vzv_saliva": 65,
      "cmv_urine": 61,
      "shuttle_any_virus": 53,
      "postflight_shedding_days_max": 30,
      "ebv_viral_load_fold_increase": 10,
      "trend": "frequency and amplitude increase with flight duration; mostly asymptomatic (6 known symptomatic astronauts)",
      "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6374706"
    },
    "eeg_alpha_power": {
      "direction_inflight": "decrease",
      "magnitude_pct": null,
      "timepoints_days": [
        9,
        55
      ],
      "persistence": "still reduced up to 20 days post-landing",
      "source": "https://www.nature.com/articles/s41598-023-34744-1.pdf",
      "note": "n=5 ISS; default-mode-network alpha power and connectivity lower; no % magnitude extracted -> simulator magnitude is illustrative"
    },
    "eeg_bed_rest_band_power": {
      "direction": "decrease in delta, theta, alpha, beta (posterior sites)",
      "time_course": "step change at first measurement (24 h to 7 d), no further drift over 60 days, returns to baseline after",
      "source": "https://www.frontiersin.org/articles/10.3389/fphys.2021.638669"
    },
    "mars_one_way_delay_min": [
      3,
      22
    ],
    "mars_one_way_delay_source": "https://science.nasa.gov/missions/mars-2020-perseverance/speaking-percys-language-how-to-talk-so-perseverance-will-listen/",
    "mars_solar_conjunction_blackout_days": {
      "value": 11.8,
      "range": [
        9,
        16
      ],
      "source": "https://ntrs.nasa.gov/api/citations/20220013418/downloads/ASCEND-Communication%20Delays%2C%20Disruptions%2C%20and%20Blackouts%20for%20Crewed%20Mars%20Missions.pdf"
    },
    "body_mass_pct_change_340d": {
      "value": -7,
      "source": "https://lsom.uthscsa.edu/nephrology/wp-content/uploads/sites/38/2019/04/NASA-twin-study_Science.pdf",
      "note": "single subject (Twins Study)"
    }
  },
  "events": [
    {
      "day": 0,
      "type": "launch",
      "description": "Launch; workload high, sleep shortest in first days/weeks",
      "evidence": "backed",
      "source": "https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf"
    },
    {
      "day": 1,
      "type": "cardiovascular_shift",
      "description": "Fluid shift: 24-h BP falls ~8-10 mmHg, cardiac output up; HR unchanged",
      "evidence": "backed",
      "source": "https://synapsesocial.com/papers/W1944333689"
    },
    {
      "day": 9,
      "type": "eeg_shift",
      "description": "Resting alpha power lower than preflight baseline (re-baseline EEG model)",
      "evidence": "backed (direction); magnitude illustrative",
      "source": "https://www.nature.com/articles/s41598-023-34744-1.pdf"
    },
    {
      "day": 14,
      "type": "fitness_drop",
      "description": "VO2peak ~17% below preflight",
      "evidence": "backed",
      "source": "https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf"
    },
    {
      "day": 22,
      "type": "hrv_dip",
      "description": "Parasympathetic HRV (RMSSD, pNN50, HF) significantly below preflight",
      "evidence": "backed (preprint)",
      "source": "https://www.researchsquare.com/article/rs-2106983/v1"
    },
    {
      "day": 29,
      "type": "cognition_check",
      "description": "Early-flight Cognition battery: slower processing speed (DSST) and working memory speed; PVT slower",
      "evidence": "backed",
      "source": "https://frontiersin.org/journals/physiology/articles/10.3389/fphys.2024.1451269/full"
    },
    {
      "day": 45,
      "type": "sleep_misalignment",
      "description": "Schedule shift / circadian misalignment night: ~1 h less sleep, hypnotic use more likely (19% of ISS sleep episodes are misaligned)",
      "evidence": "backed (rate); timing illustrative",
      "source": "https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf"
    },
    {
      "day": 75,
      "type": "viral_reactivation",
      "description": "Asymptomatic EBV/VZV shedding detected in saliva (61% of ISS crew shed at least one herpesvirus)",
      "evidence": "backed (prevalence); day illustrative",
      "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6374706"
    },
    {
      "day": 90,
      "type": "bone_checkpoint",
      "description": "Cumulative hip aBMD ~-1.5% with ARED (vs ~-4.7% without) - derived from monthly rates",
      "evidence": "backed (derived)",
      "source": "https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf"
    },
    {
      "day": 120,
      "type": "mood_dip",
      "description": "Mid/late-mission mood dip and more negative journal entries; third-quarter phenomenon is weakly supported (Antarctic meta-analysis does not support a 3rd-quarter peak)",
      "evidence": "illustrative",
      "source": "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/S003224741700050X"
    },
    {
      "day": 159,
      "type": "hrv_recovery",
      "description": "Group parasympathetic HRV suppression no longer seen ~18 days before return (individuals vary)",
      "evidence": "backed (preprint)",
      "source": "https://www.researchsquare.com/article/rs-2106983/v1"
    },
    {
      "day": 170,
      "type": "pre_return_anticipation",
      "description": "Pre-return anticipation: wake time and activity rise, sleep falls (Mars-500 final 20 days)",
      "evidence": "backed (analog)",
      "source": "https://www.med.upenn.edu/uep/assets/user-content/documents/PNAS2013Basner1212646110withSupportingAppendix.pdf"
    },
    {
      "day": 180,
      "type": "landing",
      "description": "Landing: 60-80% fail 10-min tilt test on landing day; standing HR ~10-15 bpm above preflight; VO2peak ~-15%",
      "evidence": "backed",
      "source": "https://www.frontiersin.org/article/10.3389/fphys.2020.00784"
    },
    {
      "day": 210,
      "type": "postflight_viral",
      "description": "VZV/CMV shedding can persist up to ~30 days post-landing",
      "evidence": "backed",
      "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6374706"
    }
  ]
} as const;
