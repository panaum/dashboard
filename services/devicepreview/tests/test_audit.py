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
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
from devicepreview import SHOT_LIMIT_PX, capture_height, load_devices  # noqa: E402
FIX = ROOT / "fixtures"
TOUCH = "iphone-16"            # hasTouch: tap rules apply
DESKTOP = "desktop-1440-chrome"  # no touch: tap rules must stay silent


def run(fixture: str, devices: str, *extra: str) -> tuple[int, dict]:
    out = Path(tempfile.mkdtemp(prefix="dp-test-"))
    cmd = [sys.executable, str(ROOT / "devicepreview.py"), (FIX / fixture).resolve().as_uri(),
           "--devices", devices, "--no-self-check", "--out", str(out), "--json", *extra]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    report = json.loads((out / "report.json").read_text())
    # A capture that failed must not be mistaken for a page with no findings.
    # A crash inside the probe surfaces here as its error text, not as a
    # puzzling "rule did not fire".
    for d in report["devices"]:
        if d["status"] != "ok":
            raise AssertionError(f"{d['profile_id']} capture failed: {d['error']}\n{proc.stderr[-800:]}")
    report["_out"] = str(out)          # where the run wrote; tests of the files need it
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
        # B (48×48) next to C (20×20): C is undersized and its 24px spacing
        # circle reaches B's box, which is what WCAG 2.5.8 actually tests.
        self.assertIn(frozenset({"button#b", "button#c"}), pairs, f"got {pairs}")
        # A next to B: both large, 1px apart, and that is ordinary UI.
        self.assertNotIn(frozenset({"button#a", "button#b"}), pairs, "two large adjacent targets are not a defect")
        # The stacked 300×30 links are flush but not undersized: a menu is not
        # a defect, and reporting each adjacent pair of one is what made this
        # rule read as repetitive on real pages.
        self.assertEqual(len(close), 1, f"only the undersized pair: {[f['message'] for f in close]}")
        self.assertIn("1.0px apart", close[0]["message"])
        self.assertIn("24px tap circles overlap", close[0]["message"])
        self.assertEqual(close[0]["severity"], "warn", "C is under the 24px AA minimum")
        smalls = [f for f in dev["findings"] if f["rule"] == "tap-small"]
        listed = [f for f in smalls if f["severity"] == "warn"]
        self.assertEqual([f["selector"] for f in listed], ["button#c"],
                         "C is the only target under the 24px minimum")
        # The three 300×30 menu links are over the minimum, so they are one
        # note with a count rather than three rows of their own.
        band = [f for f in smalls if "44px AAA ideal" in f["message"]]
        self.assertEqual(len(band), 1, f"one note for the band, got {[f['message'] for f in smalls]}")
        self.assertEqual(band[0]["severity"], "info")
        self.assertIn("3 tap target(s)", band[0]["message"])


class TapSeverity(unittest.TestCase):
    def test_under_24px_is_a_warning_not_info(self):
        _, rep = run("tap-small.html", TOUCH)
        f = next(f for f in next(d for d in rep["devices"])["findings"] if f["rule"] == "tap-small")
        self.assertEqual(f["severity"], "warn", "20×20 fails the WCAG AA minimum")
        self.assertIn("24px WCAG AA", f["message"])


class TapInlineException(unittest.TestCase):
    """WCAG 2.5.8's Inline exception, which the rule used to ignore.

    Before this, every AA warning on apexure.com and nine of ten on
    breezioac.com were inline links inside prose — targets the standard
    itself exempts. They are still reported, as notes, naming the exception.
    """

    def test_inline_links_in_a_sentence_are_counted_not_failed(self):
        _, rep = run("tap-inline.html", TOUCH)
        dev = next(d for d in rep["devices"])
        smalls = [f for f in dev["findings"] if f["rule"] == "tap-small"]
        inline = [f for f in smalls if "inline text link" in f["message"]]
        # Both sentence links are counted, in one note rather than a row each:
        # an exemption nobody has to act on does not deserve two lines.
        self.assertEqual(len(inline), 1, f"one note, got {[f['message'] for f in smalls]}")
        self.assertEqual(inline[0]["severity"], "info")
        self.assertIn("2 small tap target(s)", inline[0]["message"])
        self.assertIn("WCAG 2.5.8 Inline", inline[0]["message"])
        # Counted, not deleted: nothing here is a warning.
        self.assertFalse([f for f in inline if f["severity"] == "warn"])

    def test_an_inline_block_button_keeps_its_warning(self):
        _, rep = run("tap-inline.html", TOUCH)
        dev = next(d for d in rep["devices"])
        f = next(f for f in dev["findings"] if f["rule"] == "tap-small" and f["selector"] == "button#block")
        self.assertEqual(f["severity"], "warn", "an inline-block box is the author's to size")
        self.assertIn("under the 24px WCAG AA minimum", f["message"])

    def test_two_inline_links_close_together_are_not_a_defect(self):
        _, rep = run("tap-inline.html", TOUCH)
        dev = next(d for d in rep["devices"])
        close = [f for f in dev["findings"] if f["rule"] == "tap-close"]
        for f in close:
            self.assertEqual(f["severity"], "info", f["message"])
            self.assertIn("Inline exception", f["message"])


class CaptureHeight(unittest.TestCase):
    """The ceiling is limit/dpr, not a flat number.

    A flat 30000 CSS px was safe only on the 1x desktop profiles. On every
    phone and tablet it asked for 60000-105000 device pixels, the engine
    refused the whole screenshot, and the device was lost from the run —
    which is exactly what happened on a real client page.
    """

    def test_a_short_page_is_never_padded(self):
        self.assertEqual(capture_height(1200, 3), 1200)
        self.assertEqual(capture_height(1200, 1), 1200)

    def test_the_ceiling_falls_as_pixel_density_rises(self):
        for dpr in (1, 2, 3, 3.5):
            self.assertLessEqual(capture_height(99999, dpr) * dpr, SHOT_LIMIT_PX, f"{dpr}x")
        self.assertLess(capture_height(99999, 3), capture_height(99999, 2))

    def test_every_profile_in_the_matrix_stays_under_the_engine_limit(self):
        for p in load_devices(None):
            px = capture_height(99999, p.device_scale_factor) * p.device_scale_factor
            self.assertLessEqual(px, SHOT_LIMIT_PX, f"{p.id} would still be refused at {px}px")

    def test_a_daft_scale_factor_cannot_produce_a_zero_height_clip(self):
        self.assertGreaterEqual(capture_height(5000, 0), 1)
        self.assertGreaterEqual(capture_height(0, 3), 1)
        self.assertGreaterEqual(capture_height(-10, 3), 1)


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
    # The fixture shifts ~70ms after navigation on purpose. On an is_mobile
    # profile Chromium marks that window as hadRecentInput, and an observer that
    # honoured the flag read 0 here while dropping every load-time shift on
    # every phone profile. This test fails if that filter ever comes back.
    def test_early_shift_on_a_phone_profile_is_counted(self):
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
                        self.assertIn("still drawn", f["message"])
                self.assertEqual(code, 0)
                twins = [f for f in d["fonts"]["faces"] if f["family"].strip('"') == "Twin Sans"]
                self.assertTrue(any(f["status"] == "loaded" for f in twins), twins)


class WebfontStacks(unittest.TestCase):
    """The unit of judgement is the stack the visitor's text is set in."""

    def test_dead_first_face_with_a_live_twin_in_the_stack_is_not_a_fallback(self):
        # apexure.com: "Poppins-Regular, Poppins, sans-serif" with the first in
        # WebKit's "error" while the screenshot showed Poppins everywhere.
        for dev in (TOUCH, ANDROID):
            with self.subTest(device=dev):
                code, rep = run("webfont-stack-twin.html", dev)
                d = next(x for x in rep["devices"])
                bad = [f for f in d["findings"] if f["rule"] == "webfont" and f["severity"] != "info"
                       and "fallback face" in f["message"]]
                self.assertEqual(bad, [], f"{dev}: text is drawn in Live Face, yet: {bad}")
                self.assertEqual(code, 0)
                st = next(s for s in d["fonts"]["stacks"] if "Dead Face" in s["stack"])
                self.assertEqual([x.lower() for x in st["declared"]], ["dead face", "live face"])

    def test_a_wrapper_naming_a_broken_face_is_not_used_text(self):
        # 52 wrappers on a live page carried a family no glyph was set in; they
        # made it "used" and a missing file became a fallback that nobody saw.
        for dev in (TOUCH, ANDROID):
            with self.subTest(device=dev):
                code, rep = run("webfont-container.html", dev)
                d = next(x for x in rep["devices"])
                self.assertEqual([s for s in d["fonts"]["stacks"] if "Ghost" in s["stack"]], [],
                                 "no element's own text is set in Ghost Face")
                ghost = next(f for f in d["fonts"]["faces"] if f["family"].strip('"') == "Ghost Face")
                self.assertFalse(ghost["used"])
                self.assertEqual([f for f in d["findings"] if f["rule"] == "webfont"
                                  and "fallback face" in f["message"]], [])
                self.assertEqual(code, 0)


class Report(unittest.TestCase):
    """report.json is the contract; report.html must work from its own folder."""

    def test_report_json_is_versioned_and_images_are_relative(self):
        _, rep = run("clean.html", ANDROID)
        self.assertEqual(rep["schemaVersion"], 1)
        self.assertEqual(rep["files"], {"json": "report.json", "html": "report.html"})
        out = Path(rep["_out"])
        self.assertTrue((out / "report.html").is_file())
        for d in rep["devices"]:
            self.assertLessEqual({"fold", "full"}, set(d["images"]), d["notes"])   # thumb needs Pillow
            for kind, rel in d["images"].items():
                self.assertFalse(Path(rel).is_absolute(), f"{kind}: {rel} must be relative to the run dir")
                self.assertTrue((out / rel).is_file(), f"{kind}: {rel} is not under the run dir")
            self.assertIsNone(d["diff"], "baseline diffing is step 6; the slot is reserved so the schema holds")
            self.assertIn("is_mobile", d)
        for key in ("devicesPassed", "devicesFailed", "devicesWithErrors", "devicesWithWarnings"):
            self.assertIn(key, rep["summary"])

    def test_gallery_is_one_file_sorted_worst_first_with_overlays_and_compare(self):
        from playwright.sync_api import sync_playwright
        # Two devices, one warning between them: the warned one must lead.
        _, rep = run("cls.html", f"{TOUCH},{ANDROID}")
        out = Path(rep["_out"]); html = (out / "report.html").read_text()
        self.assertNotRegex(html, r'<(script|link|img)\b[^>]*\b(src|href)="https?://',
                            "self-contained: nothing fetched from the network")
        with sync_playwright() as p:
            b = p.chromium.launch()
            try:
                pg = b.new_page(viewport={"width": 1300, "height": 900})
                errors: list[str] = []
                pg.on("pageerror", lambda e: errors.append(str(e)))
                pg.goto((out / "report.html").resolve().as_uri())
                pg.wait_for_selector(".card")
                keys = pg.eval_on_selector_all(".card", "els => els.map(e => e.dataset.key)")
                self.assertEqual(keys[0], ANDROID, f"the device with a warning leads: {keys}")
                pg.wait_for_function("[...document.querySelectorAll('.card img')].every(i => i.complete)")
                broken = pg.eval_on_selector_all(
                    ".card img", "els => els.filter(i => !(i.naturalWidth > 0)).map(i => i.getAttribute('src'))")
                self.assertEqual(broken, [], "thumbnails must resolve from the HTML's own directory")
                # detail: one row per finding, and a box drawn for each finding that has one
                pg.click(f'.card[data-key="{ANDROID}"] .open')
                pg.wait_for_selector("#detail.open")
                dev = next(d for d in rep["devices"] if d["profile_id"] == ANDROID)
                self.assertEqual(pg.locator("#detail .f").count(), len(dev["findings"]))
                # page-level findings (viewport meta, layout shift, fonts) are
                # listed but never drawn — a viewport-sized box over the fold
                # pointed at nothing and hid what was under it
                drawable = [f for f in dev["findings"] if f.get("box") and f["box"]["width"] > 0
                            and f.get("scope") != "page"]
                pg.wait_for_function(f"document.querySelectorAll('#detail .box').length === {len(drawable)}")
                pg.keyboard.press("Escape")
                self.assertEqual(pg.locator("#detail.open").count(), 0)
                # compare: tick two, the button wakes, two panes appear
                self.assertTrue(pg.locator("#cmp").is_disabled())
                for k in (TOUCH, ANDROID):
                    pg.check(f'.card[data-key="{k}"] .pick')
                self.assertFalse(pg.locator("#cmp").is_disabled())
                pg.click("#cmp")
                pg.wait_for_selector("#compare.open")
                self.assertEqual(pg.locator("#compare .pane").count(), 2)
                self.assertIn("Unverified profiles", pg.inner_text("footer"))
                # the verdict is the first thing on the page and names the worst outcome
                self.assertRegex(pg.inner_text("header h1"), r"warning|clean|issue")
                self.assertEqual(errors, [], "the gallery's own script must not throw")
            finally:
                b.close()


class BotWalls(unittest.TestCase):
    """A page served instead of the site must never count as the site passing."""

    def test_a_block_page_is_blocked_not_passed(self):
        from playwright.sync_api import sync_playwright
        out = Path(tempfile.mkdtemp(prefix="dp-test-"))
        proc = subprocess.run([sys.executable, str(ROOT / "devicepreview.py"), (FIX / "blocked.html").resolve().as_uri(),
                               "--devices", DESKTOP, "--no-self-check", "--out", str(out), "--json"],
                              capture_output=True, text=True, timeout=180)
        rep = json.loads((out / "report.json").read_text())
        d = rep["devices"][0]
        self.assertEqual(d["status"], "blocked", d)
        self.assertIn("cf-", d["error"])
        self.assertEqual(d["findings"], [], "nothing on a wall is a finding about the site")
        self.assertTrue((out / d["images"]["fold"]).is_file(), "the wall is kept as evidence")
        self.assertFalse(any("attempt" in n for n in d["notes"]), "a wall is an answer; it is not retried")
        self.assertEqual(rep["summary"]["devicesBlocked"], [DESKTOP])
        self.assertEqual(rep["summary"]["devicesPassed"], 0)
        self.assertEqual(proc.returncode, 2, "a run that never saw the site cannot vouch for it")
        with sync_playwright() as p:
            b = p.chromium.launch()
            try:
                pg = b.new_page(); pg.goto((out / "report.html").resolve().as_uri()); pg.wait_for_selector(".card")
                self.assertIn("blocked", pg.inner_text(".card .badges").lower())
                self.assertIn("blocked", pg.inner_text("header").lower())
            finally:
                b.close()

    def test_default_chromium_profile_does_not_announce_headless(self):
        # The desktop profile has no UA of its own. Headless Chromium's default
        # says "HeadlessChrome", which Cloudflare walls on sight; the mobile
        # profile with a descriptor UA sailed through the same site.
        _, rep = run("clean.html", DESKTOP)
        ua = rep["devices"][0]["page"]["userAgent"]
        self.assertNotIn("Headless", ua, ua)
        self.assertIn("Chrome/", ua, ua)


class WebfontWording(unittest.TestCase):
    """_font_findings is pure; these cases cannot be staged in a browser on demand."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("devicepreview", ROOT / "devicepreview.py")
        mod = importlib.util.module_from_spec(spec); sys.modules["devicepreview"] = mod; spec.loader.exec_module(mod)
        cls.ff = staticmethod(mod._font_findings)

    def _stack(self, fam, **kw):
        base = {"stack": f'"{fam}", sans-serif', "weight": "400", "style": "normal", "elements": 12,
                "sample": "p.hero", "witness": "Most companies do not have", "declared": [fam],
                "status": {fam.lower(): ["error", "error"]}, "display": {fam.lower(): "auto"}, "renders": False}
        base.update(kw); return base

    def test_an_optional_face_skipped_by_the_browser_is_named_as_such(self):
        # apexure.com: font-display: optional on two families; one load in four
        # the browser kept the fallback with identical bytes served every time.
        out = self.ff({"stacks": [self._stack("Poppins-Regular", display={"poppins-regular": "optional"})],
                       "failed_requests": []}, 393, 852)
        self.assertEqual(len(out), 1); m = out[0]["message"]
        self.assertIn("font-display: optional", m); self.assertIn("Most companies", m); self.assertEqual(out[0]["severity"], "warn")
        self.assertNotIn("declarations are in error", m)

    def test_a_document_served_for_a_font_url_is_a_failed_request(self):
        out = self.ff({"stacks": [self._stack("Brand Sans")],
                       "failed_requests": [{"url": "https://x/f/Brand.woff2", "status": 200, "contentType": "text/html; charset=utf-8"}]}, 393, 852)
        errs = [f for f in out if f["severity"] == "error"]
        self.assertEqual(len(errs), 1); self.assertIn("served as text/html instead of a font", errs[0]["message"])

    def test_no_witness_means_no_verdict(self):
        out = self.ff({"stacks": [self._stack("Brand Sans", renders=None, witness=None)], "failed_requests": []}, 393, 852)
        self.assertEqual([f for f in out if f["severity"] != "info"], [])


class BaselineDiff(unittest.TestCase):
    """--baseline diffs each capture against the same profile in a previous run."""

    def test_two_runs_of_a_static_page_differ_by_nothing(self):
        _, a = run("clean.html", ANDROID)
        code, b = run("clean.html", ANDROID, "--baseline", a["_out"])
        d = b["devices"][0]["diff"]
        self.assertEqual(d["percent"], 0, d); self.assertFalse(d["regressed"]); self.assertEqual(d["engine"], "pillow")
        self.assertTrue((Path(b["_out"]) / d["image"]).is_file(), "a diff image is written even when nothing changed")
        self.assertEqual(b["baseline"]["dir"], a["_out"]); self.assertEqual(b["summary"]["devicesRegressed"], [])
        self.assertEqual(code, 0)

    def test_a_region_that_changes_is_regressed_unless_masked(self):
        _, a = run("dynamic.html", ANDROID)
        code, b = run("dynamic.html", ANDROID, "--baseline", a["_out"])
        d = b["devices"][0]["diff"]
        self.assertTrue(d["regressed"], d); self.assertGreater(d["percent"], 0.1)
        self.assertEqual(b["summary"]["devicesRegressed"], [ANDROID]); self.assertEqual(code, 1, "a regression fails the run like an error")
        self.assertTrue(any("visual regression" in n for n in b["devices"][0]["notes"]))
        hot = d.get("hotspots") or []
        self.assertTrue(hot and hot[0]["selector"].startswith("div#clock"), f"the change should be attributed to the clock: {hot}")
        self.assertGreater(hot[0]["shareOfChange"], 90)
        code2, c = run("dynamic.html", ANDROID, "--baseline", a["_out"], "--ignore-regions", "#clock")
        d2 = c["devices"][0]["diff"]
        self.assertFalse(d2["regressed"], d2); self.assertEqual(d2["percent"], 0); self.assertEqual(d2["maskedBoxes"], 2)
        self.assertEqual(c["devices"][0]["ignore_regions"][0]["selector"], "#clock"); self.assertEqual(code2, 0)

    def test_a_profile_missing_from_the_baseline_is_noted_not_regressed(self):
        _, a = run("clean.html", TOUCH)
        code, b = run("clean.html", ANDROID, "--baseline", a["_out"])
        d = b["devices"][0]
        self.assertEqual(d["diff"], {"missing": True}); self.assertTrue(any("no baseline" in n for n in d["notes"]))
        self.assertEqual(code, 0)

    def test_odiff_is_used_when_given(self):
        import shutil as _sh
        if not _sh.which("npx"):
            self.skipTest("npx not available; odiff path untested here")
        _, a = run("dynamic.html", ANDROID)
        _, b = run("dynamic.html", ANDROID, "--baseline", a["_out"], "--odiff", "npx -y odiff-bin")
        d = b["devices"][0]["diff"]
        self.assertEqual(d["engine"], "odiff", d); self.assertTrue(d["regressed"]); self.assertGreater(d["percent"], 0.1)
        self.assertTrue((Path(b["_out"]) / d["image"]).is_file())
        _, c = run("clean.html", ANDROID)
        _, e = run("clean.html", ANDROID, "--baseline", c["_out"], "--odiff", "npx -y odiff-bin")
        self.assertEqual(e["devices"][0]["diff"]["engine"], "odiff"); self.assertEqual(e["devices"][0]["diff"]["percent"], 0)

    def test_gallery_shows_the_regression(self):
        from playwright.sync_api import sync_playwright
        _, a = run("dynamic.html", ANDROID)
        _, b = run("dynamic.html", ANDROID, "--baseline", a["_out"])
        with sync_playwright() as p:
            br = p.chromium.launch()
            try:
                pg = br.new_page(); pg.goto((Path(b["_out"]) / "report.html").resolve().as_uri()); pg.wait_for_selector(".card")
                self.assertIn("regressed", pg.inner_text(".card .badges").lower())
                self.assertIn("regression", pg.inner_text("header h1").lower())
                pg.click(".card .open"); pg.wait_for_selector("#detail.open")
                self.assertEqual(pg.locator("#detail .diffimg").count(), 1)
            finally:
                br.close()


class MacOSBackendTests(unittest.TestCase):
    """The same engines on a Mac: one name, one fact (Apple fonts are real)."""

    @unittest.skipUnless(sys.platform == "darwin", "the macos backend only runs on a Mac")
    def test_macos_backend_captures_and_does_not_call_apple_fonts_substituted(self):
        _, local = run("apple-font.html", TOUCH)
        self.assertTrue(any("Apple's system font" in f["message"] for f in local["devices"][0]["findings"]),
                        "the local backend notes the substitution")
        code, mac = run("apple-font.html", TOUCH, "--backend", "macos")
        d = mac["devices"][0]
        self.assertEqual(mac["backend"], "macos"); self.assertEqual(d["backend"], "macos"); self.assertEqual(d["status"], "ok")
        self.assertFalse(any("Apple's system font" in f["message"] for f in d["findings"]), "authentic on a Mac")
        self.assertIn("Apple's real font stack", mac["fidelityNote"]); self.assertEqual(mac["host"]["platform"], "darwin")
        self.assertEqual(code, 0)

    def test_macos_backend_refuses_other_platforms(self):
        mod = _module()
        real = mod.sys.platform
        try:
            mod.sys.platform = "linux"
            with self.assertRaises(SystemExit) as cm:
                mod.make_backend("macos", None)
            self.assertIn("macOS host", str(cm.exception))
        finally:
            mod.sys.platform = real


def _module():
    import importlib.util
    if "devicepreview" in sys.modules:
        return sys.modules["devicepreview"]
    spec = importlib.util.spec_from_file_location("devicepreview", ROOT / "devicepreview.py")
    mod = importlib.util.module_from_spec(spec); sys.modules["devicepreview"] = mod; spec.loader.exec_module(mod)
    return mod


class FakeBrowserStack:
    """The Screenshots API as documented, without the network."""

    def __init__(self, available, polls_until_done=2, image_png=b""):
        self.available, self.polls_until_done, self.png = available, polls_until_done, image_png
        self.calls, self.job, self._polls = [], None, 0

    def __call__(self, method, url, body=None, raw=False):
        self.calls.append((method, url, body))
        if url.endswith("/screenshots/browsers.json"):
            return 200, self.available
        if method == "POST" and url.endswith("/screenshots"):
            self.job = {"job_id": "job-1", "state": "pending",
                        "screenshots": [{**b, "id": f"s{i}", "state": "pending", "url": body["url"]} for i, b in enumerate(body["browsers"])]}
            return 200, self.job
        if url.endswith("/screenshots/job-1.json"):
            self._polls += 1
            done = self._polls >= self.polls_until_done
            return 200, {"id": "job-1", "state": "done" if done else "queued",
                         "screenshots": [{**sh, "state": "done" if done else "processing",
                                          "image_url": f"https://img.test/{sh['id']}.png", "thumb_url": f"https://img.test/{sh['id']}-t.png"}
                                         for sh in self.job["screenshots"]]}
        if url.startswith("https://img.test/"):
            return 200, self.png
        return 404, {"message": "not found"}


AVAILABLE = [
    {"os": "ios", "os_version": "18", "browser": "Mobile Safari", "browser_version": None, "device": "iPhone 16"},
    {"os": "ios", "os_version": "27 Beta", "browser": "Mobile Safari", "browser_version": None, "device": "iPhone 16 Pro Max"},
    {"os": "ios", "os_version": "17", "browser": "Mobile Safari", "browser_version": None, "device": "iPhone 16 Pro Max"},
    {"os": "android", "os_version": "15.0", "browser": "Android Browser", "browser_version": None, "device": "Galaxy S25"},
    {"os": "Windows", "os_version": "11", "browser": "chrome", "browser_version": "128.0", "device": None},
    {"os": "Windows", "os_version": "11", "browser": "chrome", "browser_version": "131.0", "device": None},
    {"os": "OS X", "os_version": "Sequoia", "browser": "safari", "browser_version": "18.0", "device": None},
]


class BrowserStackBackendTests(unittest.TestCase):
    """The Screenshots API, driven exactly as documented, against a fake."""

    def setUp(self):
        self.mod = _module()
        from PIL import Image
        import io
        buf = io.BytesIO(); Image.new("RGB", (1179, 5000), (200, 30, 30)).save(buf, "PNG"); self.png = buf.getvalue()

    def _profiles(self, *ids):
        return [p for p in self.mod.load_devices(None) if p.id in ids]

    def _say(self, *a, **k):
        pass

    def test_missing_credentials_explain_how_to_enable(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("BROWSERSTACK")}
        self.assertIsNone(self.mod.browserstack_credentials(env))
        self.assertEqual(self.mod.browserstack_credentials({**env, "BROWSERSTACK_KEY": "me:secret"}), ("me", "secret"))
        self.assertEqual(self.mod.browserstack_credentials({**env, "BROWSERSTACK_USERNAME": "me", "BROWSERSTACK_ACCESS_KEY": "s"}), ("me", "s"))
        self.assertIn("BROWSERSTACK_USERNAME", self.mod.BROWSERSTACK_HOWTO); self.assertIn("--backend browserstack", self.mod.BROWSERSTACK_HOWTO)

    def test_mappings_resolve_against_the_live_list_with_fallbacks(self):
        r = self.mod.resolve_browserstack
        entry, note = r({"os": "ios", "os_version": "18", "device": "iPhone 16"}, AVAILABLE)
        self.assertEqual((entry["device"], entry["os_version"], note), ("iPhone 16", "18", None))
        entry, note = r({"os": "ios", "os_version": "18", "device": "iPhone 16 Pro Max"}, AVAILABLE)
        self.assertEqual(entry["os_version"], "17", "prefer the latest non-beta version when the asked one is gone"); self.assertIn("not 18", note)
        entry, note = r({"os": "Windows", "os_version": "11", "browser": "chrome", "browser_version": "latest"}, AVAILABLE)
        self.assertEqual(entry["browser_version"], "131.0")
        entry, note = r({"os": "ios", "os_version": "18", "device": "iPhone 17"}, AVAILABLE)
        self.assertIsNone(entry); self.assertIn("closest", note); self.assertIn("iPhone 16", note)
        entry, note = r(None, AVAILABLE)
        self.assertIsNone(entry); self.assertIn("null", note)
        # A profile that records WHY it has no mapping says that instead: the
        # reader needs to know it is BrowserStack's fleet, not our data file.
        entry, note = r(None, AVAILABLE, "BrowserStack lists no Galaxy Z Flip")
        self.assertIsNone(entry); self.assertEqual(note, "BrowserStack lists no Galaxy Z Flip")

    def test_every_profile_without_a_browserstack_mapping_says_why(self):
        """A null mapping is a claim that we checked. Make it carry evidence."""
        for prof in self.mod.load_devices(None):
            if prof.browserstack is None:
                self.assertTrue(prof.browserstack_absent,
                                f"{prof.id}: browserstack is null with no browserstackAbsent reason")
                self.assertIn("2026", prof.browserstack_absent,
                              f"{prof.id}: the reason should date the check, since the fleet drifts")

    def test_one_job_per_run_polled_to_done_and_images_laid_out_like_local(self):
        fake = FakeBrowserStack(AVAILABLE, polls_until_done=2, image_png=self.png)
        be = self.mod.BrowserStackBackend(("me", "secret"), http=fake, poll_s=0, sleep=lambda s: None)
        out = Path(tempfile.mkdtemp(prefix="dp-bs-"))
        opts = self.mod.CaptureOptions(out_dir=out)
        profiles = self._profiles("iphone-16", "galaxy-s25", "galaxy-z-flip-open")
        be.prepare("https://example.test/", profiles, opts, self._say)
        posts = [c for c in fake.calls if c[0] == "POST"]
        self.assertEqual(len(posts), 1, "one job for the whole matrix")
        body = posts[0][2]
        self.assertEqual(body["url"], "https://example.test/"); self.assertEqual(body["orientation"], "portrait")
        self.assertEqual([b["device"] for b in body["browsers"]], ["iPhone 16", "Galaxy S25"], "the unmapped profile is not sent")
        self.assertEqual(sum(1 for c in fake.calls if c[1].endswith("job-1.json")), 2, "polled until done")
        res = {p.id: be.capture("https://example.test/", p, opts) for p in profiles}
        ok = res["iphone-16"]
        self.assertEqual(ok.status, "ok"); self.assertEqual(ok.backend, "browserstack")
        self.assertEqual(set(ok.images), {"full", "fold", "thumb"})
        for rel in ok.images.values():
            self.assertTrue((out / rel).is_file(), rel)
        self.assertEqual(ok.device_scale_factor, 3.0, "1179px wide for a 393px viewport is a 3x device")
        self.assertEqual(ok.findings, []); self.assertTrue(any("no DOM access" in n for n in ok.notes))
        self.assertEqual(ok.page["browserstack"]["device"], "iPhone 16")
        skipped = res["galaxy-z-flip-open"]
        # The skip carries the recorded reason, so the report says BrowserStack
        # has no such handset rather than pointing at an empty field.
        self.assertEqual(skipped.status, "failed")
        self.assertIn("Galaxy Z Flip", skipped.error); self.assertIn("BrowserStack", skipped.error)
        # identical shape to a local result
        from dataclasses import asdict
        local_keys = set(asdict(self.mod.CaptureResult(profile_id="x", label="x", engine="webkit", platform="ios", tier="primary", verified=False, backend="local", url="u")))
        self.assertEqual(set(asdict(ok)), local_keys)

    def test_bad_credentials_and_refused_jobs_stop_with_a_reason(self):
        def unauthorized(method, url, body=None, raw=False):
            return 401, {"message": "Unauthorized"}
        be = self.mod.BrowserStackBackend(("me", "wrong"), http=unauthorized, poll_s=0, sleep=lambda s: None)
        with self.assertRaises(SystemExit) as cm:
            be.prepare("https://example.test/", self._profiles("iphone-16"), self.mod.CaptureOptions(out_dir=Path(tempfile.mkdtemp())), self._say)
        self.assertIn("401", str(cm.exception)); self.assertIn("BROWSERSTACK_USERNAME", str(cm.exception))


class FullMatrixIntegration(unittest.TestCase):
    """The whole matrix against one local page. The report's shape is the
    contract; this pins it, and the run order, across all three engines."""

    def test_full_matrix_report_shape(self):
        import dataclasses
        code, rep = run("clean.html", "all", "--include-edge")
        out = Path(rep["_out"])
        profiles = json.loads((ROOT / "devices.json").read_text())["profiles"]
        self.assertEqual(rep["schemaVersion"], 1)
        for key in ("tool", "files", "url", "startedAt", "finishedAt", "backend", "options", "timing", "rules",
                    "summary", "devices", "unverifiedProfiles", "fidelityNote", "host", "baseline"):
            self.assertIn(key, rep, key)
        self.assertEqual(rep["backend"], "local"); self.assertIsNone(rep["baseline"])
        self.assertEqual(len(rep["devices"]), len(profiles), "every profile, edge tier included")
        expected = [p["id"] for p in profiles if p["tier"] == "primary"] + [p["id"] for p in profiles if p["tier"] == "edge"]
        self.assertEqual([d["profile_id"] for d in rep["devices"]], expected, "matrix order: primary tier, then edge")
        self.assertEqual({d["engine"] for d in rep["devices"]}, {"chromium", "firefox", "webkit"})
        device_keys = {f.name for f in dataclasses.fields(_module().CaptureResult)}
        for d in rep["devices"]:
            with self.subTest(device=d["profile_id"]):
                self.assertEqual(set(d), device_keys, "one shape for every backend")
                self.assertEqual(d["status"], "ok", d.get("error"))
                self.assertLessEqual({"fold", "full", "thumb"}, set(d["images"]))
                for rel in d["images"].values():
                    self.assertTrue((out / rel).is_file(), rel)
                self.assertIsNone(d["diff"]); self.assertIsInstance(d["findings"], list)
                for f in d["findings"]:
                    self.assertLessEqual({"severity", "rule", "message", "selector", "box"}, set(f))
                    self.assertIn(f["severity"], ("error", "warn", "info")); self.assertIn(f["rule"], rep["rules"])
                self.assertLessEqual({"faces", "stacks", "requests", "failed_requests"}, set(d["fonts"]))
                self.assertLessEqual({"title", "scrollHeight", "userAgent"}, set(d["page"]))
                self.assertIn("total", d["timings_ms"])
                self.assertEqual(d["viewport"], next(p["viewport"] for p in profiles if p["id"] == d["profile_id"]))
        self.assertEqual(sorted(rep["unverifiedProfiles"]), sorted(p["id"] for p in profiles if not p.get("verified")))
        self.assertEqual(rep["summary"]["errors"], 0, "the clean fixture has no error on any device")
        self.assertEqual(rep["summary"]["devicesPassed"], len(profiles))
        self.assertTrue((out / "report.html").is_file())
        self.assertEqual(code, 0)


class ImageSizeThresholds(unittest.TestCase):
    def test_a_2x_asset_on_a_3x_screen_is_not_soft(self):
        # The iPhone 16 profile is 3x. A 1x pixel stretched 240 wide IS soft
        # (fixture image-size.html). This checks the other side: the tool must
        # not call every 2x asset soft just because the screen is 3x.
        _, rep = run("image-size-2x.html", TOUCH)
        d = next(x for x in rep["devices"])
        soft = [f for f in d["findings"] if f["rule"] == "image-size" and f["severity"] == "warn"]
        self.assertEqual(soft, [], f"a 2x asset is the universal practice and is not soft: {soft}")


class EdgeCutRule(unittest.TestCase):
    def test_ordinary_width_element_positioned_past_the_edge(self):
        # Narrower than the viewport, so the spec's "width exceeds viewport"
        # wording would never catch it — yet 80px of it is clipped and unreachable.
        code, rep = run("edge-cut.html", TOUCH)
        f = one(rep, TOUCH, "element-wider")
        self.assertTrue(f["selector"].startswith("div#culprit"), f)
        self.assertIn("past the right edge", f["message"])
        self.assertNotIn("overflow", rules_fired(rep, TOUCH), "the page does not scroll")
        self.assertEqual(code, 0)
