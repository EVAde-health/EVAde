"""Minimal FastAPI app for the EVAde voice agent.

NOTE: the team's real api/main.py (live monitor, check-in, mission trends) is not
in this repo yet. When it lands, MERGE: keep the real app and add these lines to it:

    from dotenv import load_dotenv; load_dotenv()
    from api.voice import router as voice_router
    from api.voice_browser import router as voice_browser_router
    app.include_router(voice_router)
    app.include_router(voice_browser_router)
"""
import logging

from dotenv import load_dotenv

load_dotenv()  # read .env before anything reads os.environ

from fastapi import FastAPI  # noqa: E402

from api.voice import router as voice_router  # noqa: E402
from api.voice_browser import router as voice_browser_router  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="EVAde · Crew Health Monitor (voice agent)")
app.include_router(voice_router)          # phone: /voice/incoming, /voice/stream, /voice/alert
app.include_router(voice_browser_router)  # browser: /voice/, /voice/browser, /voice/api/*


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
