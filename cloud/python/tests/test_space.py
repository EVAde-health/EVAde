from datetime import datetime, timezone

from evade_space import radiation, space_weather, synthetic

NOW = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)


def test_eva_status_rules():
    assert space_weather.eva_status(None, None) is None
    assert space_weather.eva_status(0.3, 2) == "go"
    assert space_weather.eva_status(0.3, 5.3) == "caution"
    assert space_weather.eva_status(2, 1) == "caution"
    assert space_weather.eva_status(15, 1) == "no_go"
    assert space_weather.storm_level(150) == "S2"
    assert space_weather.xray_class(2.3e-6) == "C2.3"


def test_parse_current_list_and_dict_formats():
    kp_list = [["time_tag", "Kp", "a_running", "station_count"], ["2026-11-14 09:00:00.000", "3.33", "18", "8"]]
    kp_dict = [{"time_tag": "2026-11-14T09:00:00", "Kp": 6.0}]
    protons = [{"time_tag": "x", "flux": 0.4, "energy": ">=10 MeV"}, {"time_tag": "x", "flux": 9, "energy": ">=100 MeV"}]
    xr = [{"time_tag": "x", "flux": 1.2e-5, "energy": "0.1-0.8nm"}]
    c = space_weather.parse_current(kp_list, protons, xr, NOW)
    assert (c.kp_index, c.proton_flux_10mev, c.xray_class, c.eva_status) == (3.33, 0.4, "M1.2", "go")
    assert space_weather.parse_current(kp_dict, [], [], NOW).eva_status == "caution"


def test_eva_windows_from_forecast():
    from datetime import timedelta
    kps = [2, 2, 3, 6, 6, 2, 1, 2, 3, 2]  # 3-hour slots from 12:00Z; storm (Kp 6) at slots 3-4
    fc = [["time_tag", "kp", "observed", "noaa_scale"]] + [
        [(NOW + timedelta(hours=3 * i)).strftime("%Y-%m-%d %H:%M:%S"), k, "predicted", None] for i, k in enumerate(kps)]
    wins = space_weather.eva_windows(fc, now=NOW)
    assert [w.status for w in wins] == ["go", "go"]
    assert wins[0].start == "2026-11-14T12:00Z" and wins[0].end == "2026-11-14T21:00Z"
    assert wins[1].start == "2026-11-15T03:00Z"
    assert space_weather.eva_windows(fc, current_proton_pfu=50, now=NOW) == []


def test_radiation_model():
    assert radiation.daily_dose("station") == 0.5
    assert radiation.daily_dose("spacecraft") == 1.8
    assert radiation.daily_dose("rover") > radiation.daily_dose("planetary_base")
    assert radiation.daily_dose("spacecraft", proton_pfu=300) > 5 * radiation.daily_dose("station", proton_pfu=300)
    s = radiation.dose_status(450, 1.8)
    assert s.level == "red" and s.days_of_margin == 83.3


def test_synthetic_mission_shape_and_trends():
    m = synthetic.generate_mission(30, "station", seed=1, end=NOW)
    metrics = {o["metric"] for o in m["observations"]}
    assert {"heart_rate", "sleep_hours", "body_temp", "bone_density_change_pct", "spo2"} <= metrics
    assert all(o["source"] == "synthetic" for o in m["observations"])
    assert len({o["client_id"] for o in m["observations"]}) == len(m["observations"])  # idempotent sync keys
    bone = [o["value"] for o in m["observations"] if o["metric"] == "bone_density_change_pct"]
    assert bone[-1] < bone[0]
    assert m["radiation"][-1]["cumulative_msv"] > 10
    fever = synthetic.generate_mission(30, "station", seed=1, event="fever", end=NOW)
    t = [o["value"] for o in fever["observations"] if o["metric"] == "body_temp"]
    assert max(t[-3:]) > 37.8
