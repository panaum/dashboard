"""Per-width attribution on responsive findings, and the mirror that must
match it.

The Dashboard's Layout checks page shows one screenshot at a time, so it needs
to know which widths a finding is about. The prose has always said it ("at
350–470"); `widths` says it in a field. Written as unittest so it runs under
`pytest tests/` here and under `python -m unittest` anywhere.

The same function is duplicated in services/pagecheck/pagecheck.py — the
responsive engine the Dashboard's checker mirrors. The last test compares the
two sources so the copies cannot drift apart silently.
"""
import re
import unittest
from pathlib import Path

from responsive_engine import WIDTH_LIST, responsive_findings

MIRROR = Path(__file__).resolve().parents[2] / "pagecheck" / "pagecheck.py"


def sweep() -> dict:
    """A sweep with one real break, one bot wall, one width that never loaded."""
    return {
        "widths": [
            {"width": 350, "height": 750, "docOverflow": 40,
             "culprits": [{"sel": ".hero", "over": 40, "text": "Book now"}],
             "edge": [], "cut": [], "overlaps": [],
             "cta": {"top": 900, "text": "Book now", "sel": "a.cta"}},
            {"width": 375, "height": 812, "docOverflow": 20,
             "culprits": [{"sel": ".hero", "over": 20, "text": "Book now"}],
             "edge": [], "cut": [], "overlaps": []},
            {"width": 1440, "height": 900, "docOverflow": 0,
             "culprits": [], "edge": [], "cut": [], "overlaps": [],
             "cta": {"top": 300, "text": "Book now", "sel": "a.cta"}},
            {"width": 768, "height": 1024, "challenged": True, "challengedWhy": "cloudflare"},
        ],
        "errors": ["1024px: TimeoutError: navigation"],
        "shots": [{"width": 350, "path": "350.png"}, {"width": 1440, "path": "1440.png"}],
    }


def by_id(findings) -> dict:
    return {f["id"]: f for f in findings}


class Widths(unittest.TestCase):
    def test_every_finding_carries_widths(self):
        for f in responsive_findings(sweep()):
            self.assertIn("widths", f, f["id"])
            self.assertIsInstance(f["widths"], list, f["id"])
            self.assertEqual(f["widths"], sorted(f["widths"]), f"{f['id']} is unsorted")
            for w in f["widths"]:
                self.assertIn(w, WIDTH_LIST, f["id"])

    def test_a_break_names_only_the_widths_it_broke_at(self):
        f = by_id(responsive_findings(sweep()))["overflow"]
        self.assertEqual(f["status"], "FAIL")
        self.assertEqual(f["widths"], [350, 375])

    def test_a_pass_is_about_every_width_that_rendered(self):
        found = by_id(responsive_findings(sweep()))
        # 768 was blocked and 1024 never loaded, so neither vouches for anything.
        for fid in ("edge", "clipped", "overlap"):
            self.assertEqual(found[fid]["status"], "PASS", fid)
            self.assertEqual(found[fid]["widths"], [350, 375, 1440], fid)

    def test_blocked_and_unmeasured_widths_are_named(self):
        found = by_id(responsive_findings(sweep()))
        self.assertEqual(found["blocked"]["widths"], [768])
        self.assertEqual(found["responsive-load"]["widths"], [425, 450, 470, 1024])

    def test_the_cta_finding_names_where_it_is_hidden(self):
        f = by_id(responsive_findings(sweep()))["cta"]
        self.assertEqual(f["status"], "WARN")
        self.assertEqual(f["widths"], [350], "the width where it sits below the fold")

    def test_a_clean_cta_names_every_width_it_was_seen_at(self):
        s = sweep()
        s["widths"][0]["cta"]["top"] = 100          # now visible everywhere
        f = by_id(responsive_findings(s))["cta"]
        self.assertEqual(f["status"], "PASS")
        self.assertEqual(f["widths"], [350, 1440])

    def test_screenshots_name_the_widths_they_are_of(self):
        self.assertEqual(by_id(responsive_findings(sweep()))["shots"]["widths"], [350, 1440])

    def test_the_field_is_additive(self):
        """Everything a consumer read before is untouched."""
        f = by_id(responsive_findings(sweep()))["overflow"]
        self.assertEqual(set(f) - {"widths"}, {"id", "status", "title", "detail", "evidence"})
        self.assertIn("350–375", f["detail"], "the prose still says the range")

    def test_a_sweep_that_measured_nothing_still_answers(self):
        found = responsive_findings({"errors": ["350px: boom"], "widths": []})
        self.assertEqual([f["id"] for f in found], ["responsive-load"])
        self.assertEqual(found[0]["widths"], WIDTH_LIST)

    def test_pagecheck_mirror_is_identical(self):
        """Change them in every copy or not at all (root CLAUDE.md)."""
        mine = Path(__file__).resolve().parents[1] / "responsive_engine.py"
        for name in ("responsive_findings", "_ranges"):
            # Up to the next top-level line, so what follows the function in
            # either file (pagecheck carries the cross-browser pass) is not
            # mistaken for drift.
            pat = rf"^def {name}\(.*?\n(?=^\S|\Z)"
            a = re.search(pat, mine.read_text(), re.M | re.S).group(0).rstrip()
            b = re.search(pat, MIRROR.read_text(), re.M | re.S).group(0).rstrip()
            self.assertEqual(a, b, f"{name} has drifted between the two copies")


class Images(unittest.TestCase):
    """A picture the browser could not draw is a finding of its own, by source."""

    def test_a_missing_picture_is_a_warning_at_the_widths_it_was_missing(self):
        s = sweep()
        s["widths"][0]["brokenImages"] = [{"src": "https://x.test/u/boiler-board.webp", "w": 745, "h": 419, "alt": "Boiler board", "sel": "img.wp-image-9"}]
        s["widths"][1]["brokenImages"] = [{"src": "https://x.test/u/boiler-board.webp", "w": 340, "h": 191, "alt": "Boiler board", "sel": "img.wp-image-9"}]
        f = by_id(responsive_findings(s))["images"]
        self.assertEqual(f["status"], "WARN")
        self.assertEqual(f["widths"], [350, 375])
        self.assertIn("1 picture did not load at 350–375", f["detail"])
        self.assertEqual(len(f["evidence"]), 1, "one source, however many widths")
        self.assertIn("boiler-board.webp", f["evidence"][0])
        self.assertIn("745x419px", f["evidence"][0], "the largest size it was seen at")

    def test_every_picture_loading_is_a_pass_about_every_width_that_rendered(self):
        f = by_id(responsive_findings(sweep()))["images"]
        self.assertEqual(f["status"], "PASS")
        self.assertEqual(f["widths"], [350, 375, 1440])

    def test_it_is_never_a_fail(self):
        s = sweep()
        s["widths"][2]["brokenImages"] = [{"src": f"https://x.test/{i}.jpg", "w": 300, "h": 200} for i in range(12)]
        f = by_id(responsive_findings(s))["images"]
        self.assertEqual(f["status"], "WARN")
        self.assertIn("12 pictures", f["detail"])
        self.assertEqual(len(f["evidence"]), 8, "the evidence is capped; the count is not")


if __name__ == "__main__":
    unittest.main()
