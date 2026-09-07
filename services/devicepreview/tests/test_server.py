"""The HTTP service, driven the way the Dashboard drives it: start, poll,
fetch. Runs the real CLI on a fixture in a subprocess, as production does.

    ../pagecheck/.venv/bin/python -m unittest tests.test_server
"""
from __future__ import annotations

import importlib
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FIX = ROOT / "fixtures"
KEY = "test-service-key-0123456789"


def _load(env: dict[str, str]):
    """A fresh server module under a given environment (it reads env at import)."""
    for k in ("RUNS_DIR", "RETAIN_RUNS", "RETAIN_PER_SITE", "RUN_TIMEOUT_S", "DEVICEPREVIEW_KEY", "MAX_RUNNING", "DEVICEPREVIEW_CONCURRENCY"):
        os.environ.pop(k, None)
    os.environ.update(env)
    sys.path.insert(0, str(ROOT))
    if "server" in sys.modules:
        del sys.modules["server"]
    return importlib.import_module("server")


def _wait(client, run_id: str, headers: dict[str, str], timeout: float = 120.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = client.get("/api/devicepreview/status", params={"run_id": run_id}, headers=headers).json()
        if s.get("status") in ("done", "failed", "not_found"):
            return s
        time.sleep(0.5)
    raise AssertionError("run did not finish in time")


class Service(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        cls.runs = Path(tempfile.mkdtemp(prefix="dp-runs-"))
        cls.mod = _load({"RUNS_DIR": str(cls.runs), "DEVICEPREVIEW_KEY": KEY, "RETAIN_PER_SITE": "2",
                         "DEVICEPREVIEW_CONCURRENCY": "1"})
        cls.client = TestClient(cls.mod.app)
        cls.h = {"Authorization": f"Bearer {KEY}"}

    def test_no_key_no_entry(self):
        r = self.client.get("/api/devicepreview/status", params={"run_id": "x" * 8})
        self.assertEqual(r.status_code, 401)
        r = self.client.get("/api/devicepreview/status", params={"run_id": "x" * 8}, headers={"Authorization": "Bearer wrong"})
        self.assertEqual(r.status_code, 401)
        r = self.client.get("/api/devicepreview/status", params={"run_id": "x" * 8}, headers={"X-Api-Key": KEY})
        self.assertEqual(r.json(), {"status": "not_found"}, "X-Api-Key is accepted like the LinkSpy service")
        self.assertTrue(self.client.get("/health").json()["configured"])

    def test_unconfigured_service_refuses_everything(self):
        mod = _load({"RUNS_DIR": str(self.runs)})          # no DEVICEPREVIEW_KEY
        from fastapi.testclient import TestClient
        r = TestClient(mod.app).get("/api/devicepreview/runs", headers=self.h)
        self.assertEqual(r.status_code, 503); self.assertIn("DEVICEPREVIEW_KEY", r.json()["error"])
        type(self).mod = _load({"RUNS_DIR": str(self.runs), "DEVICEPREVIEW_KEY": KEY, "RETAIN_PER_SITE": "2",
                                "DEVICEPREVIEW_CONCURRENCY": "1"})
        type(self).client = TestClient(self.mod.app)

    def test_start_poll_fetch_and_retention(self):
        url = (FIX / "clean.html").resolve().as_uri()
        r = self.client.post("/api/devicepreview/run", json={"url": url, "devices": ["galaxy-s25"]}, headers=self.h)
        self.assertEqual(r.status_code, 200, r.text); run_id = r.json()["run_id"]
        # a second run while the first is in progress is refused, not queued
        r2 = self.client.post("/api/devicepreview/run", json={"url": url, "devices": ["galaxy-s25"]}, headers=self.h)
        self.assertEqual(r2.status_code, 429); self.assertEqual(r2.json()["error"], "run_capacity")
        s = _wait(self.client, run_id, self.h)
        self.assertEqual(s["status"], "done", s)
        self.assertEqual(s["progress"]["total"], 1); self.assertEqual(s["progress"]["done"], 1)
        self.assertEqual(s["summary"]["devicesPassed"], 1); self.assertEqual(s["exit_code"], 0)
        rep = self.client.get("/api/devicepreview/report", params={"run_id": run_id}, headers=self.h).json()
        self.assertEqual(rep["schemaVersion"], 1); self.assertEqual(rep["devices"][0]["profile_id"], "galaxy-s25")
        html = self.client.get("/api/devicepreview/file", params={"run_id": run_id, "path": "report.html"}, headers=self.h)
        self.assertEqual(html.status_code, 200); self.assertTrue(html.headers["content-type"].startswith("text/html"))
        png = self.client.get("/api/devicepreview/file", params={"run_id": run_id, "path": "galaxy-s25/fold.png"}, headers=self.h)
        self.assertEqual(png.status_code, 200); self.assertEqual(png.headers["content-type"], "image/png")
        # nothing outside the run directory, and nothing that is not a media/report file
        for bad in ("../../devicepreview.py", "/etc/passwd", "galaxy-s25/../../report.json/../devicepreview.py"):
            self.assertEqual(self.client.get("/api/devicepreview/file", params={"run_id": run_id, "path": bad}, headers=self.h).status_code, 404, bad)
        jpg = self.client.get("/api/devicepreview/image", params={"run_id": run_id, "profile": "galaxy-s25", "kind": "fold", "max_width": 600}, headers=self.h)
        self.assertEqual(jpg.status_code, 200); self.assertEqual(jpg.headers["content-type"], "image/jpeg")
        self.assertLess(len(jpg.content), len(png.content), "the JPEG variant is the smaller copy the Dashboard keeps")
        listed = self.client.get("/api/devicepreview/runs", params={"url": url}, headers=self.h).json()["runs"]
        self.assertIn(run_id, [x["run_id"] for x in listed])
        # baseline against the first run, then retention keeps only the newest two
        ids = [run_id]
        for i in range(2):
            r = self.client.post("/api/devicepreview/run", json={"url": url, "devices": ["galaxy-s25"], "baseline": ids[-1]}, headers=self.h)
            self.assertEqual(r.status_code, 200, r.text); ids.append(r.json()["run_id"])
            s = _wait(self.client, ids[-1], self.h); self.assertEqual(s["status"], "done", s)
            self.assertEqual(s["baseline"], ids[-2]); self.assertNotIn("baseline_missing", s)
        rep = self.client.get("/api/devicepreview/report", params={"run_id": ids[-1]}, headers=self.h).json()
        self.assertIsNotNone(rep["devices"][0]["diff"]); self.assertEqual(rep["devices"][0]["diff"]["percent"], 0)
        self.assertFalse((self.runs / ids[0]).exists(), "the oldest run of this site was pruned (RETAIN_PER_SITE=2)")
        # Retention keeps the derivative, not the original: the second-newest run has
        # its JPEGs and report but no PNGs; the newest keeps both.
        older, newest = self.runs / ids[1], self.runs / ids[2]
        self.assertTrue((older / "report.json").is_file()); self.assertFalse(any(older.glob("*/*.png")), "PNGs dropped from the older run")
        self.assertTrue((older / "galaxy-s25" / "full.900.q82.jpg").is_file() and (older / "galaxy-s25" / "fold.900.q82.jpg").is_file())
        self.assertTrue(any(newest.glob("*/full.png")) and (newest / "galaxy-s25" / "full.900.q82.jpg").is_file(), "newest keeps originals and derivatives")
        st = self.client.get("/api/devicepreview/status", params={"run_id": ids[1]}, headers=self.h).json()
        self.assertFalse(st["originals"]); self.assertTrue(self.client.get("/api/devicepreview/status", params={"run_id": ids[2]}, headers=self.h).json()["originals"])
        for w in (900, 600):
            r = self.client.get("/api/devicepreview/image", params={"run_id": ids[1], "profile": "galaxy-s25", "kind": "full", "max_width": w}, headers=self.h)
            self.assertEqual(r.status_code, 200, w); self.assertEqual(r.headers["content-type"], "image/jpeg")
        self.assertEqual(self.client.get("/api/devicepreview/file", params={"run_id": ids[1], "path": "galaxy-s25/full.png"}, headers=self.h).status_code, 404)
        # another site is untouched by this site's churn
        other = (FIX / "dynamic.html").resolve().as_uri()
        r = self.client.post("/api/devicepreview/run", json={"url": other, "devices": ["galaxy-s25"]}, headers=self.h); oid = r.json()["run_id"]; _wait(self.client, oid, self.h)
        for _ in range(2):
            r = self.client.post("/api/devicepreview/run", json={"url": url, "devices": ["galaxy-s25"]}, headers=self.h); _wait(self.client, r.json()["run_id"], self.h)
        self.assertTrue((self.runs / oid / "galaxy-s25" / "full.png").is_file(), "the other site's only run keeps its originals")
        self.assertEqual(self.client.get("/api/devicepreview/status", params={"run_id": ids[0]}, headers=self.h).json()["status"], "not_found")
        # a baseline that no longer exists is reported, and the run still happens
        r = self.client.post("/api/devicepreview/run", json={"url": url, "devices": ["galaxy-s25"], "baseline": ids[0]}, headers=self.h)
        self.assertEqual(r.status_code, 200); self.assertTrue(r.json().get("baseline_missing"))
        s = _wait(self.client, r.json()["run_id"], self.h); self.assertEqual(s["status"], "done")

    def test_bad_requests(self):
        self.assertEqual(self.client.post("/api/devicepreview/run", json={"url": "not a url"}, headers=self.h).status_code, 400)
        self.assertEqual(self.client.post("/api/devicepreview/run", content=b"{", headers={**self.h, "Content-Type": "application/json"}).status_code, 400)
        self.assertEqual(self.client.get("/api/devicepreview/report", params={"run_id": "nope-nope"}, headers=self.h).status_code, 404)

    def test_a_failed_run_says_why(self):
        r = self.client.post("/api/devicepreview/run", json={"url": "https://this-host-does-not-exist.invalid/", "devices": ["galaxy-s25"], "timeout": 5}, headers=self.h)
        self.assertEqual(r.status_code, 200)
        s = _wait(self.client, r.json()["run_id"], self.h)
        # the CLI still writes a report with the failed capture; the service reports done with exit 2
        self.assertEqual(s["status"], "done"); self.assertEqual(s["exit_code"], 2); self.assertEqual(s["summary"]["devicesFailed"], ["galaxy-s25"])


if __name__ == "__main__":
    unittest.main()
