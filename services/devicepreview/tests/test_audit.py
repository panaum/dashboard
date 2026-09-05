"""Audit-rule tests against the fixtures. Standard library only.

Each fixture deliberately triggers exactly one rule. The assertions check both
directions: the intended rule fires, and no other rule does. The second half is
the one that catches regressions — a rule that starts firing on a page it used
to ignore is a false positive nobody asked for.

Runs the real CLI end to end, so this also covers wiring, config and exit codes.
Slow-ish (a browser per engine), so it is a test file, not something on every save:

    ../pagecheck/.venv/bin/python -m unittest tests/test_audit.py -v
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FIX = ROOT / "fixtures"
TOUCH = "iphone-16"            # hasTouch: tap rules apply
DESKTOP = "desktop-1440-chrome"  # no touch: tap rules must stay silent


def run(fixture: str, devices: str, *extra: str) -> tuple[int, dict]:
    out = Path(tempfile.mkdtemp(prefix="dp-test-"))
    cmd = [sys.executable, str(ROOT / "devicepreview.py"), (FIX / fixture).resolve().as_uri(),
           "--devices", devices, "--no-self-check", "--out", str(out), "--json", *extra]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    report = json.loads((out / "report.json").read_text())
    return proc.returncode, report


def rules_fired(report: dict, device: str) -> set[str]:
    dev = next(d for d in report["devices"] if d["profile_id"] == device)
    return {f["rule"] for f in dev["findings"]}


class OverflowRule(unittest.TestCase):
    def test_scrolling_page_is_an_error_and_names_the_culprit(self):
        code, rep = run("overflow.html", TOUCH)
        fired = rules_fired(rep, TOUCH)
        self.assertIn("overflow", fired)
        self.assertNotIn("element-wider", fired, "overflow and element-wider must be disjoint")
        self.assertFalse(fired & {"tap-small", "tap-close"}, "no interactive elements on this page")
        dev = rep["devices"][0]
        culprits = [f for f in dev["findings"] if f["rule"] == "overflow" and f["selector"] != "html"]
        self.assertTrue(any(f["selector"].startswith("div#culprit") for f in culprits),
                        f"expected div#culprit named, got {[f['selector'] for f in culprits]}")
        self.assertEqual(code, 1, "an error-severity finding must exit 1")
        self.assertEqual(rep["summary"]["errors"], len([f for f in dev["findings"] if f["severity"] == "error"]))


class ElementWiderRule(unittest.TestCase):
    def test_clipped_wide_element_is_a_warning_not_overflow(self):
        code, rep = run("element-wider.html", TOUCH)
        fired = rules_fired(rep, TOUCH)
        self.assertIn("element-wider", fired)
        self.assertNotIn("overflow", fired, "the page does not scroll, so overflow must stay quiet")
        dev = rep["devices"][0]
        f = next(f for f in dev["findings"] if f["rule"] == "element-wider")
        self.assertEqual(f["severity"], "warn")
        self.assertTrue(f["selector"].startswith("div#culprit"))
        self.assertIn("clipped", f["message"])
        self.assertEqual(code, 0, "a warning alone must not fail the run")


class TapSmallRule(unittest.TestCase):
    def test_tiny_button_on_touch_device(self):
        _, rep = run("tap-small.html", TOUCH)
        fired = rules_fired(rep, TOUCH)
        self.assertIn("tap-small", fired)
        self.assertNotIn("tap-close", fired, "a single button has no neighbour")
        f = next(f for f in next(d for d in rep["devices"])["findings"] if f["rule"] == "tap-small")
        self.assertTrue(f["selector"].startswith("button#tiny"))
        self.assertIn("20×20", f["message"])

    def test_tap_rules_are_silent_without_touch(self):
        _, rep = run("tap-small.html", DESKTOP)
        self.assertFalse(rules_fired(rep, DESKTOP) & {"tap-small", "tap-close"})


class TapCloseRule(unittest.TestCase):
    def test_only_pairs_involving_a_small_target_are_reported(self):
        _, rep = run("tap-close.html", TOUCH)
        dev = next(d for d in rep["devices"])
        close = [f for f in dev["findings"] if f["rule"] == "tap-close"]
        pairs = {frozenset((f["selector"], f["related"])) for f in close}
        # B (48×48) next to C (30×30): spacing matters because C is small.
        self.assertIn(frozenset({"button#b", "button#c"}), pairs, f"got {pairs}")
        # A next to B: both large, 2px apart, and that is ordinary UI.
        self.assertNotIn(frozenset({"button#a", "button#b"}), pairs, "two large adjacent targets are not a defect")
        self.assertEqual(len(close), 1)
        self.assertIn("2.0px apart", close[0]["message"])
        # C is 30×30: meets the 24px AA floor, misses the 44px AAA target → info.
        self.assertEqual(close[0]["severity"], "info")
        smalls = [f for f in dev["findings"] if f["rule"] == "tap-small"]
        self.assertEqual([f["selector"] for f in smalls], ["button#c"])
        self.assertEqual(smalls[0]["severity"], "info")


class TapSeverity(unittest.TestCase):
    def test_under_24px_is_a_warning_not_info(self):
        _, rep = run("tap-small.html", TOUCH)
        f = next(f for f in next(d for d in rep["devices"])["findings"] if f["rule"] == "tap-small")
        self.assertEqual(f["severity"], "warn", "20×20 fails the WCAG AA minimum")
        self.assertIn("24px WCAG AA", f["message"])


class CleanPage(unittest.TestCase):
    def test_negative_control_has_no_findings(self):
        code, rep = run("clean.html", f"{TOUCH},{DESKTOP}")
        for d in rep["devices"]:
            self.assertEqual(d["findings"], [], f"{d['profile_id']} should be clean: {d['findings']}")
        self.assertEqual(code, 0)
        self.assertEqual(rep["summary"]["devicesPassed"], 2)


class RuleConfig(unittest.TestCase):
    def test_disable_rule_switches_it_off(self):
        code, rep = run("overflow.html", TOUCH, "--disable-rule", "overflow")
        self.assertNotIn("overflow", rules_fired(rep, TOUCH))
        self.assertIs(rep["rules"]["overflow"], False)
        self.assertEqual(code, 0, "with the only error rule off the run passes")

    def test_unknown_rule_name_is_rejected(self):
        proc = subprocess.run([sys.executable, str(ROOT / "devicepreview.py"), "http://x",
                               "--disable-rule", "typo", "--no-self-check"],
                              capture_output=True, text=True, timeout=60)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("unknown rule", proc.stderr)


if __name__ == "__main__":
    unittest.main()
