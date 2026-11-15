import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_ENV = ["XAI_API_KEY", "XAI_VOICE", "XAI_MODEL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
        "TWILIO_PHONE_NUMBER", "PUBLIC_BASE_URL", "TWILIO_VALIDATE_SIGNATURE",
        "EVADE_COMMS_MODE", "EVADE_ALERT_TOKEN", "EVADE_BROWSER_TOKEN"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch, tmp_path):
    for name in _ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("EVADE_DB_PATH", str(tmp_path / "evade.db"))
    yield
