"""The live device session: the token contract, and a real streamed browser.

    ../pagecheck/.venv/bin/python -m unittest tests.test_live
"""
from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

KEY = "test-service-key-0123456789"
FIX = (ROOT / "fixtures" / "clean.html").resolve().as_uri()


def _mod():
    """A fresh module under a known environment (it reads env at import)."""
    for k in ("DEVICEPREVIEW_KEY", "LIVE_TOKEN_TTL_S", "LIVE_IDLE_TIMEOUT_S", "LIVE_MAX_SESSION_S"):
        os.environ.pop(k, None)
    os.environ["DEVICEPREVIEW_KEY"] = KEY
    for name in ("live", "server"):
        sys.modules.pop(name, None)
    import live
    return live


class TokenContract(unittest.TestCase):
    """The browser cannot hold the service key, so the token is the whole
    guard. It pins one url on one profile for a short window."""

    def setUp(self):
        self.live = _mod()

    def test_a_signed_token_reads_back_as_what_was_signed(self):
        t = self.live.sign_token(KEY, FIX, "galaxy-s25")
        claims = self.live.read_token(KEY, t)
        self.assertEqual(claims["url"], FIX)
        self.assertEqual(claims["profile"], "galaxy-s25")

    def test_a_tampered_token_is_refused(self):
        t = self.live.sign_token(KEY, FIX, "galaxy-s25")
        body, _, sig = t.rpartition(".")
        # Swap the url for another site, keeping the signature.
        import base64, json
        evil = json.dumps({"url": "https://example.com/", "profile": "galaxy-s25",
                           "exp": int(time.time() + 60)}, separators=(",", ":"), sort_keys=True)
        forged = base64.urlsafe_b64encode(evil.encode()).decode().rstrip("=") + "." + sig
        self.assertIsNone(self.live.read_token(KEY, forged),
                          "a token must not be re-pointable at another page")

    def test_the_wrong_key_is_refused(self):
        t = self.live.sign_token(KEY, FIX, "galaxy-s25")
        self.assertIsNone(self.live.read_token("another-key-entirely", t))

    def test_an_expired_token_is_refused(self):
        t = self.live.sign_token(KEY, FIX, "galaxy-s25", now=time.time() - 10_000)
        self.assertIsNone(self.live.read_token(KEY, t))
        # and it was valid at the time it was minted
        self.assertIsNotNone(self.live.read_token(KEY, t, now=time.time() - 10_000))

    def test_rubbish_is_refused_rather_than_raising(self):
        for bad in ("", "nonsense", "a.b", "....", "x" * 400):
            self.assertIsNone(self.live.read_token(KEY, bad), bad[:20])
        self.assertIsNone(self.live.read_token("", self.live.sign_token(KEY, FIX, "galaxy-s25")),
                          "an unconfigured service refuses every token")


class Session(unittest.TestCase):
    """The real thing: a browser launched, streamed, and driven."""

    @classmethod
    def setUpClass(cls):
        cls.live = _mod()
        import server
        from fastapi.testclient import TestClient
        cls.client = TestClient(server.app)

    def _open(self, profile="galaxy-s25", url=FIX, token=None):
        t = token if token is not None else self.live.sign_token(KEY, url, profile)
        return self.client.websocket_connect(f"/api/devicepreview/live-session?token={t}")

    def test_a_session_opens_streams_and_takes_input(self):
        with self._open() as ws:
            opening = ws.receive_json()
            self.assertEqual(opening["type"], "opening")
            self.assertEqual(opening["profile"], "galaxy-s25")
            ready = ws.receive_json()
            self.assertEqual(ready["type"], "ready", ready)

            # Frames arrive as binary; state as text. A viewer can tell them
            # apart without sniffing the payload.
            first = ws.receive_bytes()
            self.assertGreater(len(first), 500, "a frame, not an empty buffer")
            self.assertEqual(first[:2], b"\xff\xd8", "JPEG")

            # Input is accepted and the page keeps streaming after it.
            ws.send_json({"type": "scroll", "dy": 300})
            ws.send_json({"type": "tap", "x": 20, "y": 20})
            self.assertGreater(len(ws.receive_bytes()), 500)

    def test_an_invalid_token_is_told_so_and_closed(self):
        with self._open(token="not-a-token") as ws:
            msg = ws.receive_json()
            self.assertEqual(msg["type"], "closed")
            self.assertEqual(msg["code"], "unauthorized")

    def test_a_non_chromium_profile_is_refused_rather_than_faked(self):
        with self._open(profile="iphone-16") as ws:
            msg = ws.receive_json()
            self.assertEqual(msg["code"], "unsupported_engine", msg)
            self.assertIn("webkit", msg["detail"])

    def test_an_unknown_profile_is_named(self):
        with self._open(profile="nokia-3310") as ws:
            self.assertEqual(ws.receive_json()["code"], "unknown_profile")


if __name__ == "__main__":
    unittest.main()
