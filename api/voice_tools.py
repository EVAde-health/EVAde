"""Adapter between the voice agent and EVAde's health logic + storage.

Everything the Grok voice agent can *do* lives here: the function-tool schemas
it sees, and the Python that runs when it calls them.

STAND-IN: the team's real app already has a SQLite check-in store, check-in
rules and a flight-surgeon downlink queue (see README). Until that code is in
the repo, this module keeps its own small versions so the voice agent runs on
its own. To wire it into the real app later, repoint `save_checkin()` and
`queue_flight_surgeon_message()` at the real functions in `models/` / `api/`
and keep the return shapes (the agent reads them aloud).
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from models import checkin_rules

REPO_ROOT = Path(__file__).resolve().parent.parent
COMMS_MODES = {
    # mode: (status on insert, one-way delay in seconds or None)
    "online": ("sent", 0),          # ISS: near real-time link
    "mars": ("in_transit", 20 * 60),  # Mars: ~20-min one-way delay (3-22 min range)
    "blackout": ("queued", None),     # conjunction / LOS: hold until link returns
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    crew_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'voice',
    sleep_hours REAL,
    mood INTEGER,
    symptoms TEXT,
    systolic INTEGER,
    diastolic INTEGER,
    temperature_c REAL,
    blood_sugar_mg_dl REAL,
    notes TEXT,
    level TEXT NOT NULL,
    reasons TEXT NOT NULL,
    actions TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS downlink_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    crew_id TEXT NOT NULL,
    priority TEXT NOT NULL,
    message TEXT NOT NULL,
    checkin_id INTEGER,
    comms_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    arrives_at TEXT
);
"""


def db_path() -> Path:
    return Path(os.getenv("EVADE_DB_PATH") or REPO_ROOT / "data" / "evade.db")


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _num(value: Any, cast=float) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


def _baselines(conn: sqlite3.Connection, crew_id: str) -> tuple[Optional[float], Optional[float]]:
    """Personal baseline = average of the last 7 check-ins (needs at least 3)."""
    rows = conn.execute(
        "SELECT sleep_hours, mood FROM checkins WHERE crew_id = ? ORDER BY id DESC LIMIT 7",
        (crew_id,)).fetchall()
    sleeps = [r["sleep_hours"] for r in rows if r["sleep_hours"] is not None]
    moods = [r["mood"] for r in rows if r["mood"] is not None]
    avg = lambda xs: sum(xs) / len(xs) if len(xs) >= 3 else None  # noqa: E731
    return avg(sleeps), avg(moods)


def save_checkin(crew_id: str, args: dict) -> dict:
    """Store a spoken check-in and return a green/yellow/red assessment."""
    symptoms = args.get("symptoms") or []
    if isinstance(symptoms, str):
        symptoms = [s.strip() for s in symptoms.split(",") if s.strip()]
    mood = _num(args.get("mood"), int)
    if mood is not None:
        mood = max(1, min(5, mood))
    values = dict(
        sleep_hours=_num(args.get("sleep_hours")),
        mood=mood,
        symptoms=list(symptoms),
        systolic=_num(args.get("systolic"), int),
        diastolic=_num(args.get("diastolic"), int),
        temperature_c=checkin_rules.normalise_temperature_c(_num(args.get("temperature"))),
        blood_sugar_mg_dl=_num(args.get("blood_sugar_mg_dl")),
    )
    with closing(connect()) as conn:
        base_sleep, base_mood = _baselines(conn, crew_id)
        result = checkin_rules.assess(**values, baseline_sleep=base_sleep, baseline_mood=base_mood)
        cur = conn.execute(
            """INSERT INTO checkins (created_at, crew_id, source, sleep_hours, mood, symptoms,
               systolic, diastolic, temperature_c, blood_sugar_mg_dl, notes, level, reasons, actions)
               VALUES (?, ?, 'voice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (_now().isoformat(), crew_id, values["sleep_hours"], values["mood"],
             json.dumps(values["symptoms"]), values["systolic"], values["diastolic"],
             values["temperature_c"], values["blood_sugar_mg_dl"], args.get("notes"),
             result["level"], json.dumps(result["reasons"]), json.dumps(result["actions"])))
        conn.commit()
        checkin_id = cur.lastrowid
    return {"checkin_id": checkin_id, "level": result["level"], "reasons": result["reasons"],
            "actions": result["actions"],
            "reminder": "Decision support only, not a medical device."}


def queue_flight_surgeon_message(crew_id: str, args: dict) -> dict:
    """Add a message to the flight-surgeon downlink queue."""
    mode = (args.get("comms_mode") or os.getenv("EVADE_COMMS_MODE") or "online").lower()
    if mode not in COMMS_MODES:
        mode = "online"
    priority = (args.get("priority") or "routine").lower()
    if priority not in ("routine", "urgent"):
        priority = "routine"
    message = (args.get("message") or "").strip() or "Crew member requested contact."
    status, delay = COMMS_MODES[mode]
    now = _now()
    arrives_at = (now + timedelta(seconds=delay)).isoformat() if delay is not None else None
    with closing(connect()) as conn:
        cur = conn.execute(
            """INSERT INTO downlink_queue (created_at, crew_id, priority, message, checkin_id,
               comms_mode, status, arrives_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (now.isoformat(), crew_id, priority, message, _num(args.get("checkin_id"), int),
             mode, status, arrives_at))
        conn.commit()
        queue_id = cur.lastrowid
    spoken = {
        "online": "Sent to the flight surgeon now.",
        "mars": "Transmitting; it will reach Earth in about 20 minutes.",
        "blackout": "Comms are down, so it is queued and will send when the link is back.",
    }[mode]
    return {"queue_id": queue_id, "comms_mode": mode, "status": status,
            "arrives_at": arrives_at, "summary": spoken}


# ---------------------------------------------------------------- tool schemas
TOOLS: list[dict] = [
    {
        "type": "function",
        "name": "save_checkin",
        "description": (
            "Save the crew member's daily health check-in and get an assessment "
            "(green/yellow/red) with reasons and recommended actions. Call this once "
            "you have at least sleep hours and mood; include anything else they told you."),
        "parameters": {
            "type": "object",
            "properties": {
                "sleep_hours": {"type": "number", "description": "Hours slept last sleep period"},
                "mood": {"type": "integer", "description": "Mood from 1 (very low) to 5 (very good)"},
                "symptoms": {"type": "array", "items": {"type": "string"},
                             "description": "Symptoms in their own words; empty list if none"},
                "systolic": {"type": "integer", "description": "Systolic blood pressure (top number), mmHg"},
                "diastolic": {"type": "integer", "description": "Diastolic blood pressure (bottom number), mmHg"},
                "temperature": {"type": "number", "description": "Body temperature, Celsius or Fahrenheit"},
                "blood_sugar_mg_dl": {"type": "number", "description": "Blood sugar in mg/dL"},
                "notes": {"type": "string", "description": "Anything else worth recording"},
            },
            "required": ["sleep_hours", "mood"],
        },
    },
    {
        "type": "function",
        "name": "queue_flight_surgeon_message",
        "description": (
            "Send a message to the flight surgeon through the downlink queue. Use it when the "
            "assessment is red, or whenever the crew member asks to contact the flight surgeon."),
        "parameters": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Short summary for the flight surgeon"},
                "priority": {"type": "string", "enum": ["routine", "urgent"]},
                "checkin_id": {"type": "integer", "description": "checkin_id from save_checkin, if any"},
                "comms_mode": {"type": "string", "enum": ["online", "mars", "blackout"],
                               "description": "Leave out to use the current mission setting"},
            },
            "required": ["message", "priority"],
        },
    },
]

HANDLERS = {
    "save_checkin": save_checkin,
    "queue_flight_surgeon_message": queue_flight_surgeon_message,
}


def run_tool(name: str, crew_id: str, arguments: str | dict | None) -> dict:
    """Execute a tool call from the model. Never raises: errors go back to the model."""
    handler = HANDLERS.get(name)
    if handler is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        args = json.loads(arguments) if isinstance(arguments, str) else dict(arguments or {})
    except json.JSONDecodeError:
        return {"error": "Arguments were not valid JSON."}
    try:
        return handler(crew_id, args)
    except Exception as exc:  # pragma: no cover - defensive
        return {"error": f"{type(exc).__name__}: {exc}"}


# ------------------------------------------------------------ read helpers
def latest_checkin(crew_id: Optional[str] = None) -> Optional[dict]:
    """Most recent check-in (optionally for one crew member), or None."""
    sql = "SELECT * FROM checkins"
    params: tuple = ()
    if crew_id:
        sql += " WHERE crew_id = ?"
        params = (crew_id,)
    with closing(connect()) as conn:
        row = conn.execute(sql + " ORDER BY id DESC LIMIT 1", params).fetchone()
    if row is None:
        return None
    out = dict(row)
    for key in ("symptoms", "reasons", "actions"):
        out[key] = json.loads(out[key]) if out.get(key) else []
    return out


def list_downlink(limit: int = 10, crew_id: Optional[str] = None) -> list[dict]:
    """Newest flight-surgeon downlink messages first."""
    limit = max(1, min(int(limit), 100))
    sql = "SELECT * FROM downlink_queue"
    params: tuple = ()
    if crew_id:
        sql += " WHERE crew_id = ?"
        params = (crew_id,)
    with closing(connect()) as conn:
        rows = conn.execute(sql + " ORDER BY id DESC LIMIT ?", params + (limit,)).fetchall()
    return [dict(r) for r in rows]
