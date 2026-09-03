"""Pagecheck — web app.

Serves the single-page UI at / and runs checks. Playwright's sync API cannot
run inside the event loop, so every check runs in a worker thread; progress is
pushed onto a queue and streamed to the browser as it happens.

The engine is engine.check_page(). This file adds no checking logic.
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from engine import check_page

app = FastAPI(title="Pagecheck", docs_url=None, redoc_url=None)
HERE = Path(__file__).parent
MAX_URLS = 25


class CheckRequest(BaseModel):
    urls: list[str] = []


def _clean(urls: list[str]) -> list[str]:
    out: list[str] = []
    for u in urls:
        for part in str(u).splitlines():
            part = part.strip()
            if part and not part.startswith("#") and part not in out:
                out.append(part)
    return out[:MAX_URLS]


@app.get("/")
def index() -> FileResponse:
    return FileResponse(HERE / "index.html")


@app.post("/check")
async def check(req: CheckRequest) -> JSONResponse:
    """Blocking JSON check — one or many URLs. The streaming route below is
    what the UI uses; this is the plain contract for anything else."""
    urls = _clean(req.urls)
    if not urls:
        return JSONResponse({"error": "give at least one url"}, status_code=400)
    results = [await asyncio.to_thread(check_page, u) for u in urls]
    return JSONResponse({"results": results})


@app.get("/check/stream")
async def check_stream(u: list[str] = Query(default=[])) -> StreamingResponse:
    """Server-sent events: a `progress` event per step, a `result` event per
    URL, then `done`. The UI never shows a spinner with nothing behind it."""
    urls = _clean(list(u or []))

    async def events():
        if not urls:
            yield _sse("error", {"message": "give at least one url"})
            return

        for index, url in enumerate(urls):
            q: queue.Queue = queue.Queue()

            def run(url=url, q=q):
                try:
                    result = check_page(url, on_progress=lambda m: q.put(("progress", m)))
                    q.put(("result", result))
                except Exception as exc:  # noqa: BLE001 — a bad page is a result
                    q.put(("result", {"url": url, "outcome": "load_failed",
                                      "error": f"{type(exc).__name__}: {exc}",
                                      "checks": [], "failed": True,
                                      "counts": {"PASS": 0, "FAIL": 1, "WARN": 0, "INFO": 0}}))

            threading.Thread(target=run, daemon=True).start()

            while True:
                try:
                    kind, payload = await asyncio.to_thread(q.get, True, 1.0)
                except queue.Empty:
                    yield ": keep-alive\n\n"   # proxies drop a silent stream
                    continue
                if kind == "progress":
                    yield _sse("progress", {"url": url, "index": index,
                                            "total": len(urls), "message": payload})
                else:
                    yield _sse("result", {"index": index, "total": len(urls),
                                          "report": payload})
                    break
        yield _sse("done", {"total": len(urls)})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
