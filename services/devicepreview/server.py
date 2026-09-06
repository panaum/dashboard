#!/usr/bin/env python3
"""devicepreview as a service — what the Dashboard talks to.

The same shape as the LinkSpy service's responsive check, which the Dashboard
already drives: start a job, poll it, fetch what it produced.

    POST /api/devicepreview/run      {url, devices?, tier?, include_edge?, baseline?, …}
    GET  /api/devicepreview/status   ?run_id=
    GET  /api/devicepreview/report   ?run_id=                 report.json
    GET  /api/devicepreview/file     ?run_id=&path=            report.html, <profile>/full.png, …
    GET  /api/devicepreview/image    ?run_id=&profile=&kind=   JPEG variant, downscaled, for storage
    GET  /api/devicepreview/runs     ?url=                     retained runs for a page
    GET  /health

Each run is the CLI in its own process — Playwright's sync API and three
engines stay out of the server's event loop, and a run that hangs is killed
at its deadline instead of taking the service with it. Runs live under
RUNS_DIR (a Railway volume in production); the newest RETAIN_RUNS are kept.

Auth is one service key, DEVICEPREVIEW_KEY, as `Authorization: Bearer` or
`X-Api-Key`, compared in constant time. With no key configured every request
is refused: the ecosystem has enough endpoints that fail open (INFRASTRUCTURE
D13) and this one is not joining them.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response

HERE = Path(__file__).resolve().parent
RUNS_DIR = Path(os.environ.get("RUNS_DIR") or HERE / "runs").resolve()
RETAIN_RUNS = int(os.environ.get("RETAIN_RUNS", "40"))
RUN_TIMEOUT_S = int(os.environ.get("RUN_TIMEOUT_S", "900"))
CONCURRENCY = os.environ.get("DEVICEPREVIEW_CONCURRENCY", "2")
MAX_RUNNING = int(os.environ.get("MAX_RUNNING", "1"))
SERVICE_KEY = os.environ.get("DEVICEPREVIEW_KEY", "")

app = FastAPI(title="devicepreview", docs_url=None, redoc_url=None)

_runs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()

DEVICE_LINE = re.compile(r"^\s{2}.{28}\s(?:chromium|firefox|webkit)\s+\w+\s+(ok|failed|blocked)\b")
HEADER_LINE = re.compile(r"^\s{2}(\d+) device\(s\) × (\d+) scheme\(s\)")
ID_RX = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".html": "text/html; charset=utf-8",
         ".json": "application/json", ".webp": "image/webp"}


# ── auth ────────────────────────────────────────────────────────────────────

def _gate(authorization: str | None, x_api_key: str | None) -> JSONResponse | None:
    if not SERVICE_KEY:
        return JSONResponse({"error": "service not configured: DEVICEPREVIEW_KEY is unset"}, status_code=503)
    presented = ""
    if authorization and authorization.lower().startswith("bearer "):
        presented = authorization[7:].strip()
    elif x_api_key:
        presented = x_api_key.strip()
    if not presented or not hmac.compare_digest(presented.encode(), SERVICE_KEY.encode()):
        return JSONResponse({"error": "a valid devicepreview service key is required"}, status_code=401)
    return None


# ── runs ────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _public(entry: dict[str, Any]) -> dict[str, Any]:
    keys = ("run_id", "status", "url", "started_at", "finished_at", "progress", "error", "summary",
            "baseline", "baseline_missing", "exit_code")
    return {k: entry[k] for k in keys if entry.get(k) is not None}


def _index_existing() -> None:
    """Runs that survived a restart (on a volume) are listed again, from their
    own report.json; a directory without one was cut off and is dropped."""
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    for d in RUNS_DIR.iterdir():
        if not d.is_dir() or not ID_RX.match(d.name) or d.name in _runs:
            continue
        rep = d / "report.json"
        if not rep.is_file():
            shutil.rmtree(d, ignore_errors=True)
            continue
        try:
            r = json.loads(rep.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        _runs[d.name] = {"run_id": d.name, "status": "done", "url": r.get("url"),
                         "started_at": r.get("startedAt"), "finished_at": r.get("finishedAt"),
                         "summary": r.get("summary"), "dir": d, "restored": True}


def _prune() -> int:
    """Newest RETAIN_RUNS stay; a running one is never touched."""
    done = sorted((e for e in _runs.values() if e["status"] in ("done", "failed")),
                  key=lambda e: e.get("started_at") or "", reverse=True)
    removed = 0
    for e in done[RETAIN_RUNS:]:
        shutil.rmtree(e["dir"], ignore_errors=True)
        _runs.pop(e["run_id"], None)
        removed += 1
    return removed


def _args(body: dict[str, Any], out: Path) -> tuple[list[str], dict[str, Any]]:
    """The CLI invocation for a request body. Returns (argv, facts to record)."""
    facts: dict[str, Any] = {}
    argv = [sys.executable, str(HERE / "devicepreview.py"), body["url"], "--out", str(out),
            "--no-self-check", "--concurrency", CONCURRENCY, "--timeout", str(int(body.get("timeout") or 30))]
    devices = body.get("devices")
    if isinstance(devices, list) and devices:
        argv += ["--devices", ",".join(str(d) for d in devices)]
    elif devices == "all" or body.get("tier") == "all":
        argv += ["--tier", "all"]
    if body.get("include_edge") or devices == "all":
        argv.append("--include-edge")
    if body.get("landscape"):
        argv.append("--landscape")
    if body.get("color_scheme") in ("dark", "both"):
        argv += ["--color-scheme", body["color_scheme"]]
    regions = body.get("ignore_regions")
    if isinstance(regions, list) and regions:
        argv += ["--ignore-regions", ",".join(str(r) for r in regions)]
    if body.get("disable_rules"):
        argv += ["--disable-rule", ",".join(str(r) for r in body["disable_rules"])]
    baseline = body.get("baseline")
    if baseline:
        facts["baseline"] = str(baseline)
        bdir = RUNS_DIR / str(baseline)
        if ID_RX.match(str(baseline)) and (bdir / "report.json").is_file():
            argv += ["--baseline", str(bdir)]
        else:
            facts["baseline_missing"] = True   # the run still happens; the diff cannot
    return argv, facts


def _run_job(run_id: str) -> None:
    entry = _runs[run_id]
    out: Path = entry["dir"]
    try:
        proc = subprocess.Popen(entry["argv"], cwd=str(HERE), stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE, text=True)
    except OSError as exc:
        entry.update(status="failed", error=f"could not start the run: {exc}", finished_at=_now())
        return
    entry["pid"] = proc.pid
    tail: list[str] = []
    deadline = time.time() + RUN_TIMEOUT_S

    def reader() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.rstrip("\n")
            if not line.strip() or "Task was destroyed" in line or "Future exception" in line:
                continue
            tail.append(line); del tail[:-30]
            m = HEADER_LINE.match(line)
            if m:
                entry["progress"]["total"] = int(m.group(1)) * int(m.group(2))
            elif DEVICE_LINE.match(line):
                entry["progress"]["done"] += 1
            entry["progress"]["message"] = line.strip()[:160]

    t = threading.Thread(target=reader, daemon=True); t.start()
    while proc.poll() is None:
        if time.time() > deadline:
            proc.kill()
            entry.update(status="failed", error=f"run exceeded {RUN_TIMEOUT_S}s and was stopped", finished_at=_now())
            break
        time.sleep(0.5)
    t.join(timeout=5)
    if proc.stderr is not None:
        proc.stderr.close()
    if entry["status"] == "running":
        rep = out / "report.json"
        if rep.is_file():
            try:
                r = json.loads(rep.read_text(encoding="utf-8"))
                entry.update(status="done", summary=r.get("summary"), exit_code=proc.returncode,
                             finished_at=r.get("finishedAt") or _now())
            except ValueError:
                entry.update(status="failed", error="report.json is not readable", finished_at=_now())
        else:
            entry.update(status="failed", exit_code=proc.returncode, finished_at=_now(),
                         error=("the run produced no report: " + " | ".join(tail[-3:]))[:400])
    with _lock:
        _prune()


# ── endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    running = sum(1 for e in _runs.values() if e["status"] == "running")
    return {"ok": True, "running": running, "retained": sum(1 for e in _runs.values() if e["status"] == "done"),
            "configured": bool(SERVICE_KEY), "runs_dir": str(RUNS_DIR)}


@app.post("/api/devicepreview/run")
async def start_run(request: Request, authorization: str | None = Header(default=None),
                    x_api_key: str | None = Header(default=None)):
    if (err := _gate(authorization, x_api_key)):
        return err
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"error": "bad json"}, status_code=400)
    url = str(body.get("url") or "").strip()
    if not re.match(r"^https?://[^\s]+$", url) and not url.startswith("file://"):
        return JSONResponse({"error": "a valid http(s) url is required"}, status_code=400)
    with _lock:
        running = sum(1 for e in _runs.values() if e["status"] == "running")
        if running >= MAX_RUNNING:
            return JSONResponse({"error": "run_capacity", "detail": f"{running} run(s) already in progress; "
                                 "three browser engines are enough for one at a time"}, status_code=429)
        run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
        out = RUNS_DIR / run_id
        out.mkdir(parents=True, exist_ok=True)
        argv, facts = _args({**body, "url": url}, out)
        _runs[run_id] = {"run_id": run_id, "status": "running", "url": url, "started_at": _now(),
                         "progress": {"done": 0, "total": None, "message": "starting"}, "dir": out, "argv": argv,
                         **facts}
    threading.Thread(target=_run_job, args=(run_id,), daemon=True).start()
    return {"run_id": run_id, "status": "running", **{k: facts[k] for k in facts}}


def _entry(run_id: str) -> dict[str, Any] | None:
    if not ID_RX.match(run_id or ""):
        return None
    e = _runs.get(run_id)
    if e is None:
        _index_existing()
        e = _runs.get(run_id)
    return e


@app.get("/api/devicepreview/status")
def status(run_id: str = Query(...), authorization: str | None = Header(default=None),
           x_api_key: str | None = Header(default=None)):
    if (err := _gate(authorization, x_api_key)):
        return err
    e = _entry(run_id)
    return _public(e) if e else {"status": "not_found"}


@app.get("/api/devicepreview/report")
def report(run_id: str = Query(...), authorization: str | None = Header(default=None),
           x_api_key: str | None = Header(default=None)):
    if (err := _gate(authorization, x_api_key)):
        return err
    e = _entry(run_id)
    if not e or e["status"] != "done":
        return JSONResponse({"error": "not_found" if not e else e["status"]}, status_code=404)
    return FileResponse(e["dir"] / "report.json", media_type="application/json",
                        headers={"Cache-Control": "private, max-age=86400, immutable"})


@app.get("/api/devicepreview/file")
def file(run_id: str = Query(...), path: str = Query(...), authorization: str | None = Header(default=None),
         x_api_key: str | None = Header(default=None)):
    """A file from the run directory, by its relative path — report.html and
    the images it references. The path is resolved inside the run directory
    and refused otherwise; a browser may ask for anything."""
    if (err := _gate(authorization, x_api_key)):
        return err
    e = _entry(run_id)
    if not e or e["status"] != "done":
        return JSONResponse({"error": "not_found"}, status_code=404)
    base = e["dir"].resolve()
    target = (base / path.lstrip("/")).resolve()
    if base not in target.parents or not target.is_file() or target.suffix.lower() not in MEDIA:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return FileResponse(target, media_type=MEDIA[target.suffix.lower()],
                        headers={"Cache-Control": "private, max-age=86400, immutable"})


@app.get("/api/devicepreview/image")
def image(run_id: str = Query(...), profile: str = Query(...), kind: str = Query("fold"),
          max_width: int = Query(1400, ge=200, le=4000), quality: int = Query(82, ge=40, le=95),
          authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    """A JPEG variant of a capture, downscaled, for the Dashboard to keep. The
    PNG originals are the truth; this is the copy that fits in a database."""
    if (err := _gate(authorization, x_api_key)):
        return err
    e = _entry(run_id)
    if not e or e["status"] != "done" or not ID_RX.match(profile) or kind not in ("fold", "full", "thumb", "diff"):
        return JSONResponse({"error": "not_found"}, status_code=404)
    src = e["dir"] / profile / f"{kind}.png"
    if not src.is_file():
        return JSONResponse({"error": "not_found"}, status_code=404)
    dst = e["dir"] / profile / f"{kind}.{max_width}.q{quality}.jpg"
    if not dst.is_file():
        try:
            from PIL import Image
            with Image.open(src) as im:
                im = im.convert("RGB")
                if im.width > max_width:
                    im = im.resize((max_width, max(1, round(im.height * max_width / im.width))), Image.LANCZOS)
                im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
        except Exception as exc:  # noqa: BLE001 — a variant that cannot be made is a 500 with a reason
            return JSONResponse({"error": f"could not encode: {exc}"}, status_code=500)
    return FileResponse(dst, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400, immutable"})


@app.get("/api/devicepreview/runs")
def runs(url: str | None = Query(default=None), limit: int = Query(20, ge=1, le=100),
         authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    if (err := _gate(authorization, x_api_key)):
        return err
    _index_existing()
    items = [_public(e) for e in _runs.values() if e["status"] == "done" and (not url or e.get("url") == url)]
    items.sort(key=lambda e: e.get("started_at") or "", reverse=True)
    return {"runs": items[:limit]}


_index_existing()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
