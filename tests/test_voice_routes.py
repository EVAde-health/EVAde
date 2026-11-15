import xml.etree.ElementTree as ET

from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from api import voice
from api.main import app

client = TestClient(app)
FORM = {"CallSid": "CA123", "From": "+15550001111", "To": "+15550002222"}


def _stream(xml_text):
    root = ET.fromstring(xml_text)
    assert root.tag == "Response"
    connect = root.find("Connect")
    assert connect is not None
    stream = connect.find("Stream")
    assert stream is not None
    params = {p.get("name"): p.get("value") for p in stream.findall("Parameter")}
    return stream, params


def test_incoming_returns_connect_stream_twiml(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://evade.example.ngrok.app/")
    r = client.post("/voice/incoming", data=FORM)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    stream, params = _stream(r.text)
    assert stream.get("url") == "wss://evade.example.ngrok.app/voice/stream"
    assert params["caller"] == "+15550001111"
    assert params["token"] and voice.consume_stream_token(params["token"])
    assert not voice.consume_stream_token(params["token"])  # one-time


def test_incoming_falls_back_to_host_header():
    r = client.post("/voice/incoming", data=FORM, headers={"host": "localhost:8000"})
    stream, _ = _stream(r.text)
    assert stream.get("url") == "wss://localhost:8000/voice/stream"


def test_signature_rejected_when_missing_or_wrong(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "secret-token")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://evade.example.ngrok.app")
    assert client.post("/voice/incoming", data=FORM).status_code == 403
    r = client.post("/voice/incoming", data=FORM, headers={"X-Twilio-Signature": "bogus"})
    assert r.status_code == 403


def test_signature_accepted_when_valid(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "secret-token")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://evade.example.ngrok.app")
    sig = RequestValidator("secret-token").compute_signature(
        "https://evade.example.ngrok.app/voice/incoming", FORM)
    r = client.post("/voice/incoming", data=FORM, headers={"X-Twilio-Signature": sig})
    assert r.status_code == 200
    _stream(r.text)


def test_signature_check_can_be_disabled(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "secret-token")
    monkeypatch.setenv("TWILIO_VALIDATE_SIGNATURE", "false")
    assert client.post("/voice/incoming", data=FORM).status_code == 200


def test_alert_requires_twilio_config():
    r = client.post("/voice/alert", json={"to": "+15550001111"})
    assert r.status_code == 503


def test_alert_token_enforced(monkeypatch):
    monkeypatch.setenv("EVADE_ALERT_TOKEN", "abc")
    r = client.post("/voice/alert", json={"to": "+15550001111"})
    assert r.status_code == 401


def test_alert_places_call(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC" + "0" * 32)
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+15550009999")
    created = {}

    class FakeCalls:
        def create(self, **kw):
            created.update(kw)
            return type("Call", (), {"sid": "CA999", "status": "queued"})()

    class FakeClient:
        def __init__(self, sid, token):
            self.calls = FakeCalls()

    import twilio.rest
    monkeypatch.setattr(twilio.rest, "Client", FakeClient)
    r = client.post("/voice/alert", json={"to": "+15550001111", "message": "Red alert test"})
    assert r.status_code == 200 and r.json()["call_sid"] == "CA999"
    assert created["to"] == "+15550001111" and created["from_"] == "+15550009999"
    assert "<Say" in created["twiml"] and "Red alert test" in created["twiml"]


def test_health():
    assert client.get("/health").json() == {"status": "ok"}
