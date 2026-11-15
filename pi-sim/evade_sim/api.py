"""Small client for the EVAde model API with a timing log (no signal values or user IDs are logged).

The key comes from the EVADE_API_KEY environment variable and is sent as X-EVAde-Key. Never put it in a file.
Point it at a staging deployment, or through the team Worker in production.
"""
from __future__ import annotations

import csv
import json
import os
import re
import time
from pathlib import Path

import httpx


_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _template(path: str) -> str:
    """Endpoint without IDs or query, e.g. /v1/users/{id}: the log never holds user IDs."""
    return _UUID.sub("{id}", path.split("?")[0])


class Api:
    def __init__(self, base_url: str, log_path: str | Path | None = None, timeout: float = 30.0):
        key = os.environ.get("EVADE_API_KEY")
        if not key:
            raise SystemExit("set EVADE_API_KEY in the environment (staging key; never commit it)")
        self.c = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout,
                              headers={"X-EVAde-Key": key, "Content-Type": "application/json"})
        self.log = None
        if log_path:
            Path(log_path).parent.mkdir(parents=True, exist_ok=True)
            new = not Path(log_path).exists()
            self._fh = open(log_path, "a", newline="", encoding="utf-8")
            self.log = csv.writer(self._fh)
            if new:
                self.log.writerow(["t_send_unix", "endpoint", "status", "latency_ms", "bytes_sent", "flag",
                                   "source", "model_ids", "scenario_t_s", "events"])

    def call(self, method: str, path: str, body: dict | None = None, *, scen_t: float = 0.0,
             events: list[str] = (), flag_of=None) -> dict | None:
        data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        t0 = time.time()
        try:
            r = self.c.request(method, path, content=data)
            status, out = r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else {})
        except httpx.HTTPError as e:
            status, out = 0, {"error": {"code": type(e).__name__}}
        ms = (time.time() - t0) * 1000.0
        d = out.get("data", {}) if isinstance(out, dict) else {}
        flag = flag_of(d) if (flag_of and status == 200) else ""
        if self.log:
            self.log.writerow([f"{t0:.3f}", _template(path), status, f"{ms:.1f}", len(data or b""), flag or "",
                               d.get("source", "") if isinstance(d, dict) else "", ";".join(out.get("model_ids", []) or [])
                               if isinstance(out, dict) else "", f"{scen_t:.1f}", ";".join(events)])
            self._fh.flush()
        if status != 200:
            code = (out.get("error") or {}).get("code", "") if isinstance(out, dict) else ""
            print(f"  {method} {_template(path)} -> {status} {code} ({ms:.0f} ms)")
            return None
        return out

    def create_user(self, user_id: str | None = None) -> str:
        body = {"consent": True, "cohort": "simulated"}
        if user_id:
            body["user_id"] = user_id
        out = self.call("POST", "/v1/users", body)
        if not out:
            raise SystemExit("could not create the simulated user (check the URL and EVADE_API_KEY)")
        return out["data"]["user_id"]

    def delete_user(self, user_id: str) -> None:
        self.call("DELETE", f"/v1/users/{user_id}")
