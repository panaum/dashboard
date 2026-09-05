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


# ── step 4 rules ──────────────────────────────────────────────────────────────

ANDROID = "galaxy-s25"  # chromium: the only engine that can measure layout shift


def one(rep: dict, device: str, rule: str) -> dict:
    dev = next(d for d in rep["devices"] if d["profile_id"] == device)
    hits = [f for f in dev["findings"] if f["rule"] == rule]
    assert hits, f"{rule} did not fire on {device}: {[f['rule'] for f in dev['findings']]}"
    return hits[0]


class ClippedTextRule(unittest.TestCase):
    def test_text_cut_by_overflow_hidden(self):
        _, rep = run("clipped-text.html", TOUCH)
        f = one(rep, TOUCH, "clipped-text")
        self.assertTrue(f["selector"].startswith("div#culprit"))
        self.assertIn("below its box", f["message"])
        self.assertEqual(rules_fired(rep, TOUCH) - {"cls"}, {"clipped-text"})


class TextSmallRule(unittest.TestCase):
    def test_ten_px_text_on_mobile(self):
        _, rep = run("text-small.html", TOUCH)
        f = one(rep, TOUCH, "text-small")
        self.assertTrue(f["selector"].startswith("p#culprit"))
        self.assertIn("10.0px", f["message"])

    def test_silent_on_desktop(self):
        _, rep = run("text-small.html", DESKTOP)
        self.assertNotIn("text-small", rules_fired(rep, DESKTOP))


class FixedChromeRule(unittest.TestCase):
    def test_bars_over_a_quarter_of_the_viewport(self):
        _, rep = run("fixed-chrome.html", TOUCH)
        f = one(rep, TOUCH, "fixed-chrome")
        self.assertIn("40%", f["message"])
        self.assertEqual(rules_fired(rep, TOUCH) - {"cls"}, {"fixed-chrome"})


class ViewportMetaRule(unittest.TestCase):
    def test_missing_meta_is_an_error_on_mobile(self):
        code, rep = run("viewport-meta-missing.html", TOUCH)
        f = one(rep, TOUCH, "viewport-meta")
        self.assertEqual(f["severity"], "error")
        self.assertIn("No <meta", f["message"])
        self.assertEqual(code, 1)

    def test_zoom_blocked_is_a_warning(self):
        code, rep = run("viewport-meta-noscale.html", TOUCH)
        f = one(rep, TOUCH, "viewport-meta")
        self.assertEqual(f["severity"], "warn")
        self.assertIn("WCAG 1.4.4", f["message"])
        self.assertEqual(code, 0)


class WebfontRule(unittest.TestCase):
    def test_missing_font_file_is_an_error_where_the_network_saw_it(self):
        code, rep = run("webfont.html", ANDROID)
        dev = next(d for d in rep["devices"])
        hits = [f for f in dev["findings"] if f["rule"] == "webfont"]
        self.assertEqual(len(hits), 1, f"one fact, one finding: {hits}")
        self.assertEqual(hits[0]["severity"], "error")
        self.assertIn("missing-font.woff2", hits[0]["message"])
        self.assertEqual(code, 1)
        self.assertTrue(dev["fonts"]["failed_requests"], "the network record must carry the failure")

    def test_never_loaded_face_is_still_reported_when_no_request_happens(self):
        # WebKit refuses the file:// font before the network, so there is no
        # request to fail; the used-but-unloaded face must not pass silently.
        _, rep = run("webfont.html", TOUCH)
        dev = next(d for d in rep["devices"])
        hits = [f for f in dev["findings"] if f["rule"] == "webfont"]
        self.assertTrue(hits, f"webfont stayed silent on webkit: {dev['fonts']}")
        self.assertIn("Missing Sans", hits[0]["message"])
        face = next(f for f in dev["fonts"]["faces"] if f["family"].strip('"') == "Missing Sans")
        self.assertTrue(face["used"], "the fixture's paragraph uses this family")


class OffscreenRule(unittest.TestCase):
    def test_parked_text_is_info(self):
        code, rep = run("offscreen.html", TOUCH)
        f = one(rep, TOUCH, "offscreen")
        self.assertEqual(f["severity"], "info")
        self.assertTrue(f["selector"].startswith("div#ghost"))
        self.assertEqual(code, 0)
        self.assertNotIn("element-wider", rules_fired(rep, TOUCH), "wholly off screen is not 'wider than viewport'")


class ImageSizeRule(unittest.TestCase):
    def test_upscaled_image_is_a_warning(self):
        _, rep = run("image-size.html", TOUCH)
        f = one(rep, TOUCH, "image-size")
        self.assertEqual(f["severity"], "warn")
        self.assertIn("look soft", f["message"])
        self.assertTrue(f["selector"].startswith("img#culprit"))


class ClsRule(unittest.TestCase):
    def test_late_insert_shifts_layout_on_chromium(self):
        _, rep = run("cls.html", ANDROID)
        f = one(rep, ANDROID, "cls")
        self.assertIn(f["severity"], ("warn", "error"), f["message"])
        dev = next(d for d in rep["devices"])
        self.assertIsNotNone(dev["page"]["cls"])
        self.assertGreater(dev["page"]["cls"], 0.1)

    def test_not_measurable_on_webkit_says_so_instead_of_faking_zero(self):
        _, rep = run("cls.html", TOUCH)
        dev = next(d for d in rep["devices"])
        self.assertIsNone(dev["page"]["cls"])
        self.assertNotIn("cls", rules_fired(rep, TOUCH))
        self.assertTrue(any("not measurable" in n for n in dev["notes"]))


class CleanPageAllRules(unittest.TestCase):
    def test_negative_control_only_reports_cls_info(self):
        code, rep = run("clean.html", f"{ANDROID},{TOUCH},{DESKTOP}")
        for d in rep["devices"]:
            rules = {f["rule"] for f in d["findings"]}
            self.assertLessEqual(rules, {"cls"}, f"{d['profile_id']} fired {rules}")
            for f in d["findings"]:
                self.assertEqual(f["severity"], "info", f)
        self.assertEqual(code, 0)


# ── real-page lessons: negative controls ─────────────────────────────────────

class MarqueeIsNotADefect(unittest.TestCase):
    def test_carousel_track_and_its_items_stay_silent(self):
        _, rep = run("marquee.html", TOUCH)
        fired = rules_fired(rep, TOUCH) - {"cls"}
        self.assertNotIn("element-wider", fired, "a marquee track is meant to be wider than its frame")
        self.assertNotIn("offscreen", fired, "marquee items scroll into view on their own")
        self.assertEqual(fired, set(), f"nothing else should fire either: {fired}")


class WebfontSibling(unittest.TestCase):
    def test_failed_declaration_with_a_loaded_twin_is_not_reported(self):
        # Chromium fetches the missing file (an error request), WebKit refuses
        # before the network (an unloaded face); on both, the family still
        # renders through its local() twin, so nothing is wrong for the visitor.
        for dev in (ANDROID, TOUCH):
            with self.subTest(device=dev):
                code, rep = run("webfont-sibling.html", dev)
                d = next(x for x in rep["devices"])
                errors = [f for f in d["findings"] if f["rule"] == "webfont" and f["severity"] == "error"]
                self.assertEqual(errors, [], f"{dev}: family renders via its twin, yet an ERROR: {errors}")
                # Chromium sees the 404 — a dead declaration is worth a warning
                # that says the family still loaded, and must not fail the run.
                for f in d["findings"]:
                    if f["rule"] == "webfont" and f["severity"] == "warn":
                        self.assertIn("still loaded", f["message"])
                self.assertEqual(code, 0)
                twins = [f for f in d["fonts"]["faces"] if f["family"].strip('"') == "Twin Sans"]
                self.assertTrue(any(f["status"] == "loaded" for f in twins), twins)


class ImageSizeThresholds(unittest.TestCase):
    def test_a_2x_asset_on_a_3x_screen_is_not_soft(self):
        # The iPhone 16 profile is 3x. A 1x pixel stretched 240 wide IS soft
        # (fixture image-size.html). This checks the other side: the tool must
        # not call every 2x asset soft just because the screen is 3x.
        _, rep = run("image-size-2x.html", TOUCH)
        d = next(x for x in rep["devices"])
        soft = [f for f in d["findings"] if f["rule"] == "image-size" and f["severity"] == "warn"]
        self.assertEqual(soft, [], f"a 2x asset is the universal practice and is not soft: {soft}")
