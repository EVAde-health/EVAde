"""Tiny stdlib client for the EVAde Cloudflare Worker API (no dependencies)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


class EVAdeClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: float = 20):
        self.base = (base_url or os.environ.get("EVADE_API_URL", "http://localhost:8787")).rstrip("/")
        self.key = api_key or os.environ.get("EVADE_API_KEY")
        self.timeout = timeout

    def _req(self, method: str, path: str, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "evade-space-python/1.0")  # Cloudflare blocks the default urllib agent
        if self.key:
            req.add_header("X-EVAde-Key", self.key)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                body = r.read().decode()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}") from None

    get = lambda self, p: self._req("GET", p)  # noqa: E731
    post = lambda self, p, b=None: self._req("POST", p, b if b is not None else {})  # noqa: E731

    def health(self):
        return self.get("/health")

    def create_user(self, display_name: str, environment: str = "station", mission_name: str | None = None, role="astronaut"):
        return self.post("/users", {"display_name": display_name, "environment": environment,
                                    "mission_name": mission_name, "role": role})

    def push_observations(self, user_id: str, observations: list[dict], chunk: int = 400):
        n = 0
        for i in range(0, len(observations), chunk):
            n += len(self.post("/observations", {"user_id": user_id, "observations": observations[i:i + chunk]})["stored"])
        return n

    def push_radiation(self, user_id: str, rows: list[dict]):
        for r in rows:
            self.post("/radiation", {"user_id": user_id, **r})
        return len(rows)

    def push_self_reports(self, user_id: str, rows: list[dict]):
        for r in rows:
            self.post("/self-reports", {"user_id": user_id, **r})
        return len(rows)

    def push_space_weather(self, rows: list[dict]):
        return self.post("/space-weather", {"rows": rows})

    def push_model_result(self, user_id: str, endpoint: str, output: dict, model_id: str | None = None):
        return self.post("/model-results", {"user_id": user_id, "endpoint": endpoint, "output": output,
                                            "model_id": model_id, "flag": output.get("flag"),
                                            "confidence": output.get("confidence")})

    def baseline(self, user_id: str, metric: str, days: int = 14):
        return self.post(f"/users/{user_id}/baseline/{metric}", {"days": days})

    def risk(self, user_id: str):
        return self.get(f"/users/{user_id}/risk")

    def dashboard(self, user_id: str):
        return self.get(f"/users/{user_id}/dashboard")
