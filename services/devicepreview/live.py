#!/usr/bin/env python3
"""A live device session: a real browser, streamed.

The capture endpoints answer "what did this page look like". This one answers
"let me use it" — a Chromium context with the profile's real viewport, pixel
density, user agent and touch, streamed to the browser as JPEG frames, with
clicks, taps, scrolls and keys forwarded back in. The point is what an iframe
can never do: a tap here arrives at the page as pointerdown/touchstart/
touchend, not as a mouse pretending.

Measured before building, on a real client page: Chromium's CDP screencast
runs about 14fps at 37KB a frame, roughly half a megabyte a second.

Android/Chromium first, deliberately. It has native screencast and every input
primitive; WebKit needs a screenshot loop and has no mouse wheel at all, so it
is the second slice, not the first.

Auth: the browser cannot hold the service key, so the Dashboard signs a
short-lived token that PINS the url and profile. The service reads both from
the token and never from the query string, so a token opens exactly one page
on one profile — it can never be used to browse the service somewhere else.

Two things that review caught, both now closed:

  * The token arrives as the FIRST MESSAGE on the socket, not as a query
    parameter. A query string is written to the access log in full, and
    Railway keeps those logs, so a token in the URL is a token on disk.
  * It is SINGLE USE. Signature and expiry alone left a two-minute window in
    which the same token could open session after session; a used signature is
    now remembered until it expires.
"""
from __future__ import annotations

import asyncio
import base64
import hmac
import json
import os
import secrets
import time
from hashlib import sha256
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

SESSION_TTL_S = int(os.environ.get("LIVE_TOKEN_TTL_S", "120"))     # how long a token may be used to OPEN a session
IDLE_TIMEOUT_S = int(os.environ.get("LIVE_IDLE_TIMEOUT_S", "180"))  # no input for this long and the browser goes
MAX_SESSION_S = int(os.environ.get("LIVE_MAX_SESSION_S", "900"))    # a hard ceiling, whatever happens
JPEG_QUALITY = int(os.environ.get("LIVE_QUALITY", "60"))
# Chromium will hand over frames as fast as the socket drains them — measured
# at 50fps and 1.9MB/s on a real page, which is bandwidth spent on frames no
# eye resolves. Capped, the session costs about 0.8MB/s.
MAX_FPS = int(os.environ.get("LIVE_MAX_FPS", "20"))

# One at a time. Three browser engines on a small instance are already the
# limit; a live session holds one open for minutes rather than seconds.
_busy = asyncio.Lock()

# Signatures already spent, with the moment they expire. A token is good for
# one session: without this, anything that saw it — a log line, a proxy, a
# screen — could open sessions with it until it expired.
_spent: dict[str, float] = {}

AUTH_TIMEOUT_S = 5.0


def session_open() -> bool:
    """Whether a browser is currently held by a live session."""
    return _busy.locked()


def audit_running() -> bool:
    """Whether a capture run holds the instance. Imported late: server.py
    imports this module at load, so the dependency only goes one way there."""
    try:
        import server
        return any(e["status"] in ("running", "finishing") for e in server._runs.values())
    except Exception:                                             # noqa: BLE001 — never block a session on a lookup
        return False


def spend_token(sig: str, exp: float, now: float | None = None) -> bool:
    """True the first time a signature is presented, False every time after."""
    t = now if now is not None else time.time()
    for k, v in list(_spent.items()):
        if v <= t:
            _spent.pop(k, None)
    if sig in _spent:
        return False
    _spent[sig] = exp
    return True


def sign_token(secret: str, url: str, profile: str, now: float | None = None,
               nonce: str | None = None) -> str:
    """The Dashboard mints these; kept here so both sides read one implementation.

    `jti` is what makes two tokens for the same page in the same second
    different documents. Without it they are byte-identical, and single use
    would refuse the second person to open that page in that second.
    """
    payload = json.dumps({"url": url, "profile": profile,
                          "jti": nonce or secrets.token_hex(8),
                          "exp": int((now if now is not None else time.time()) + SESSION_TTL_S)},
                         separators=(",", ":"), sort_keys=True)
    body = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{body}.{_sig(secret, body)}"


def read_token(secret: str, token: str, now: float | None = None) -> dict[str, Any] | None:
    """The url and profile to open, or None. Signature first: everything in
    the token is attacker-supplied text until the HMAC checks out."""
    if not secret or not token or "." not in token:
        return None
    body, _, sig = token.rpartition(".")
    if not hmac.compare_digest(sig, _sig(secret, body)):
        return None
    try:
        pad = "=" * (-len(body) % 4)
        claims = json.loads(base64.urlsafe_b64decode(body + pad))
    except (ValueError, TypeError):
        return None
    if float(claims.get("exp", 0)) < (now if now is not None else time.time()):
        return None
    if not isinstance(claims.get("url"), str) or not isinstance(claims.get("profile"), str):
        return None
    return claims


def _sig(secret: str, body: str) -> str:
    return hmac.new(secret.encode(), body.encode(), sha256).hexdigest()


@router.websocket("/api/devicepreview/live-session")
async def live_session(ws: WebSocket) -> None:
    from devicepreview import load_devices          # local: keeps CLI import cost off startup

    secret = os.environ.get("DEVICEPREVIEW_KEY", "")
    await ws.accept()
    # The token is the first message, never the URL: a query string is written
    # to the access log in full, and a token on disk is a token that can be
    # replayed within its window.
    try:
        hello = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT_S))
        token = str(hello.get("token", ""))
    except (asyncio.TimeoutError, ValueError, TypeError, KeyError, WebSocketDisconnect):
        await _bye(ws, "unauthorized", "No session token was sent.")
        return

    claims = read_token(secret, token)
    if not claims:
        await _bye(ws, "unauthorized", "That session token is not valid, or it has expired.")
        return
    if not spend_token(token.rpartition(".")[2], float(claims["exp"])):
        await _bye(ws, "token_spent", "That session token has already been used. Start a new session.")
        return

    profile = next((p for p in load_devices(None) if p.id == claims["profile"]), None)
    if profile is None:
        await _bye(ws, "unknown_profile", f"No profile called {claims['profile']}.")
        return
    if profile.engine != "chromium":
        # Honest refusal beats a session that silently behaves like a desktop.
        await _bye(ws, "unsupported_engine",
                   f"{profile.label} runs on {profile.engine}, which has no frame streaming yet. "
                   "Chromium profiles only for now.")
        return
    if _busy.locked():
        await _bye(ws, "busy", "Another live session is open. They run one at a time on this instance.")
        return
    if audit_running():
        await _bye(ws, "busy", "A capture run is using the browsers. Runs and sessions share one slot; "
                               "try again when it finishes.")
        return

    async with _busy:
        await _drive(ws, profile, claims["url"])


async def _drive(ws: WebSocket, profile: Any, url: str) -> None:
    from playwright.async_api import async_playwright

    # (jpeg, sessionId): Chromium stops sending until each frame is acked, so
    # the ack has to be awaited, not fired and forgotten. Doing it in the pump
    # after the send also gives free backpressure — the page cannot outrun the
    # socket. An earlier version acked with ensure_future and the stream
    # stalled after a couple of dozen frames; a 25-frame test did not notice.
    frames: asyncio.Queue[tuple[bytes, str]] = asyncio.Queue(maxsize=2)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        try:
            ctx = await browser.new_context(**profile.context_options(False))
            page = await ctx.new_page()
            cdp = await ctx.new_cdp_session(page)

            def on_frame(event: dict[str, Any]) -> None:
                if frames.full():                      # drop the stale one, never the newest
                    try: frames.get_nowait()
                    except asyncio.QueueEmpty: pass
                frames.put_nowait((base64.b64decode(event["data"]), event["sessionId"]))

            cdp.on("Page.screencastFrame", on_frame)
            await ws.send_json({"type": "opening", "url": url, "profile": profile.id,
                                "label": profile.label, "viewport": profile.viewport,
                                "engine": profile.engine})
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as exc:                                  # noqa: BLE001 — reported, not raised
                await _bye(ws, "navigation_failed", f"{type(exc).__name__}: {str(exc)[:160]}")
                return

            await cdp.send("Page.startScreencast", {
                "format": "jpeg", "quality": JPEG_QUALITY,
                "maxWidth": profile.viewport["width"], "maxHeight": profile.viewport["height"],
                "everyNthFrame": 1})
            await ws.send_json({"type": "ready", "title": await page.title()})

            pump = asyncio.create_task(_pump(ws, frames, cdp))
            try:
                await _input_loop(ws, page)
            finally:
                pump.cancel()
                try: await cdp.send("Page.stopScreencast")
                except Exception: pass                                # noqa: BLE001 — closing anyway
        finally:
            await browser.close()


async def _pump(ws: WebSocket, frames: asyncio.Queue[tuple[bytes, str]], cdp: Any) -> None:
    """Frames out, as binary. Text is reserved for state, so the client can
    tell a picture from a message without sniffing.

    Rate-capped rather than as-fast-as-possible: the queue holds two, so what
    this drops is always the stale frame, never the current one.
    """
    min_gap = 1.0 / max(MAX_FPS, 1)
    last = 0.0
    while True:
        data, session_id = await frames.get()
        wait = min_gap - (time.monotonic() - last)
        if wait > 0:
            await asyncio.sleep(wait)
        await ws.send_bytes(data)
        last = time.monotonic()
        await cdp.send("Page.screencastFrameAck", {"sessionId": session_id})


async def _input_loop(ws: WebSocket, page: Any) -> None:
    started = last_input = time.monotonic()
    while True:
        timeout = min(IDLE_TIMEOUT_S - (time.monotonic() - last_input),
                      MAX_SESSION_S - (time.monotonic() - started))
        if timeout <= 0:
            await _bye(ws, "timed_out", "The session was idle, so the browser was closed.")
            return
        try:
            msg = await asyncio.wait_for(ws.receive_text(), timeout=timeout)
        except asyncio.TimeoutError:
            await _bye(ws, "timed_out", "The session was idle, so the browser was closed.")
            return
        except WebSocketDisconnect:
            return
        last_input = time.monotonic()
        try:
            await _apply(page, json.loads(msg))
        except Exception as exc:                                      # noqa: BLE001 — one bad event must not end the session
            await ws.send_json({"type": "input_error", "detail": f"{type(exc).__name__}: {str(exc)[:120]}"})


async def _apply(page: Any, ev: dict[str, Any]) -> None:
    """One event from the viewer. Coordinates are CSS px in the device's own
    viewport — the client unscales them, so nothing here needs to know how big
    the picture is on their screen."""
    kind = ev.get("type")
    if kind == "tap":
        await page.touchscreen.tap(float(ev["x"]), float(ev["y"]))
    elif kind == "click":
        await page.mouse.click(float(ev["x"]), float(ev["y"]))
    elif kind == "scroll":
        # A wheel event, not window.scrollTo: sticky headers and scroll-linked
        # animations respond to the former and ignore the latter.
        await page.mouse.wheel(float(ev.get("dx", 0)), float(ev.get("dy", 0)))
    elif kind == "key":
        await page.keyboard.press(str(ev["key"])[:32])
    elif kind == "type":
        await page.keyboard.type(str(ev["text"])[:200])
    elif kind == "back":
        await page.go_back(wait_until="domcontentloaded")
    elif kind == "forward":
        await page.go_forward(wait_until="domcontentloaded")
    elif kind == "reload":
        await page.reload(wait_until="domcontentloaded")
    elif kind == "ping":
        pass                                    # keeps the idle timer alive while someone is reading


async def _bye(ws: WebSocket, code: str, detail: str) -> None:
    try:
        await ws.send_json({"type": "closed", "code": code, "detail": detail})
        await ws.close()
    except Exception:                                                 # noqa: BLE001 — already gone
        pass
