import json
import sqlite3

from api import voice_tools
from models import checkin_rules


def test_green_checkin_saved():
    out = voice_tools.save_checkin("+1555", {"sleep_hours": 7.5, "mood": 4, "symptoms": [],
                                             "systolic": 118, "diastolic": 76,
                                             "temperature": 36.8, "blood_sugar_mg_dl": 90})
    assert out["level"] == "green"
    assert out["checkin_id"] == 1
    assert "not a medical device" in out["reminder"]
    row = sqlite3.connect(voice_tools.db_path()).execute(
        "SELECT crew_id, source, level, sleep_hours FROM checkins").fetchone()
    assert row == ("+1555", "voice", "green", 7.5)


def test_yellow_checkin_has_reasons_and_actions():
    out = voice_tools.save_checkin("+1555", {"sleep_hours": 5, "mood": 3,
                                             "symptoms": ["mild headache"]})
    assert out["level"] == "yellow"
    assert any("5 hours" in r for r in out["reasons"])
    assert any("headache" in r for r in out["reasons"])
    assert out["actions"]


def test_red_checkin_from_red_flag_symptom():
    out = voice_tools.save_checkin("+1555", {"sleep_hours": 7, "mood": 3,
                                             "symptoms": "chest pain, nausea"})
    assert out["level"] == "red"
    assert out["actions"][0] == "Send this check-in to the flight surgeon."


def test_red_from_vitals():
    r = checkin_rules.assess(systolic=185, diastolic=100)
    assert r["level"] == "red"
    assert checkin_rules.assess(temperature_c=39.6)["level"] == "red"
    assert checkin_rules.assess(blood_sugar_mg_dl=50)["level"] == "red"
    assert checkin_rules.assess(sleep_hours=3)["level"] == "red"
    assert checkin_rules.assess(mood=1)["level"] == "red"


def test_fahrenheit_temperature_is_converted():
    out = voice_tools.save_checkin("+1555", {"sleep_hours": 8, "mood": 4, "temperature": 101.2})
    assert out["level"] == "yellow"  # 38.4 C
    temp = sqlite3.connect(voice_tools.db_path()).execute(
        "SELECT temperature_c FROM checkins").fetchone()[0]
    assert temp == 38.4


def test_personal_baseline_flags_drop():
    for _ in range(3):
        voice_tools.save_checkin("crew-a", {"sleep_hours": 8.5, "mood": 4})
    out = voice_tools.save_checkin("crew-a", {"sleep_hours": 6.5, "mood": 4})
    assert out["level"] == "yellow"
    assert any("your own recent average" in r for r in out["reasons"])
    # another astronaut's history doesn't count
    assert voice_tools.save_checkin("crew-b", {"sleep_hours": 6.5, "mood": 4})["level"] == "green"


def test_downlink_queue_insert_modes(monkeypatch):
    online = voice_tools.queue_flight_surgeon_message("+1555", {"message": "Red check-in",
                                                                "priority": "urgent",
                                                                "checkin_id": 3})
    assert online["status"] == "sent" and online["comms_mode"] == "online"
    mars = voice_tools.queue_flight_surgeon_message("+1555", {"message": "m", "priority": "routine",
                                                              "comms_mode": "mars"})
    assert mars["status"] == "in_transit" and mars["arrives_at"]
    monkeypatch.setenv("EVADE_COMMS_MODE", "blackout")
    black = voice_tools.queue_flight_surgeon_message("+1555", {"message": "b", "priority": "routine"})
    assert black["status"] == "queued" and black["arrives_at"] is None
    rows = sqlite3.connect(voice_tools.db_path()).execute(
        "SELECT crew_id, priority, message, checkin_id, comms_mode, status FROM downlink_queue "
        "ORDER BY id").fetchall()
    assert rows[0] == ("+1555", "urgent", "Red check-in", 3, "online", "sent")
    assert [r[4] for r in rows] == ["online", "mars", "blackout"]


def test_run_tool_handles_json_and_errors():
    out = voice_tools.run_tool("save_checkin", "x", json.dumps({"sleep_hours": 8, "mood": 5}))
    assert out["level"] == "green"
    assert "error" in voice_tools.run_tool("nope", "x", "{}")
    assert "error" in voice_tools.run_tool("save_checkin", "x", "{not json")


def test_tool_schemas_shape():
    names = {t["name"] for t in voice_tools.TOOLS}
    assert names == set(voice_tools.HANDLERS)
    for t in voice_tools.TOOLS:
        assert t["type"] == "function" and t["parameters"]["type"] == "object"
