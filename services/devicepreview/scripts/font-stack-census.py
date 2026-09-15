#!/usr/bin/env python3
"""Which pages depend on the platform's own font, and how exposed are they?

The question behind ADR-003. A page that sets `-apple-system` or `system-ui`
FIRST renders in the host's UI face, so its typography follows whichever
machine captured it. A page that names one of them behind a webfont only does
so if that webfont fails.

    scripts/font-stack-census.py URL [URL ...]
    scripts/font-stack-census.py --crawl 6 https://example.com/
    scripts/font-stack-census.py --file urls.txt

Reads computed `font-family` on the same elements devicepreview's own probe
samples, so the verdict here and the verdict in a run agree.
"""
import argparse, json, re, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

APPLE = re.compile(r"-apple-system|blinkmacsystemfont|sf pro|san francisco", re.I)
SYSUI = re.compile(r"(^|[\s,\"'])system-ui([\s,\"']|$)", re.I)
SAMPLE = ["body", "h1", "h2", "h3", "p", "a", "button"]
PROBE = """(sels) => Object.fromEntries(sels.flatMap(s => {
  const el = document.querySelector(s);
  return el ? [[s, getComputedStyle(el).fontFamily]] : [];
}))"""

def leading(stack: str) -> bool:
    """Is the platform face the FIRST family, i.e. does it actually draw?"""
    first = stack.split(",")[0].strip().strip('"\'').lower()
    return first in ("-apple-system", "system-ui", "blinkmacsystemfont")

def classify(fams: dict[str, str]) -> tuple[str, str]:
    body = fams.get("body", "")
    blob = " | ".join(fams.values())
    if APPLE.search(blob): kind = "apple"
    elif SYSUI.search(blob): kind = "system-ui"
    else: return "none", body
    return (kind + (" LEADING" if leading(body) else " (fallback)")), body

def same_host(a, b):
    return urlparse(a).netloc.replace("www.", "") == urlparse(b).netloc.replace("www.", "")

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--file", help="newline-separated URLs")
    ap.add_argument("--crawl", type=int, default=0, metavar="N",
                    help="also take up to N same-origin links from each URL given")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    seeds = list(a.urls) + ([l.strip() for l in open(a.file) if l.strip()] if a.file else [])
    if not seeds:
        ap.print_help(); return 2
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context(viewport={"width": 412, "height": 892}).new_page()
        todo = list(seeds)
        if a.crawl:
            for seed in seeds:
                try:
                    pg.goto(seed, wait_until="domcontentloaded", timeout=30000); pg.wait_for_timeout(1000)
                    hrefs = pg.evaluate("()=>[...document.querySelectorAll('a[href]')].map(x=>x.href)")
                except Exception:
                    continue
                extra = []
                for h in hrefs:
                    if not h.startswith("http") or not same_host(h, seed): continue
                    h = h.split("#")[0].rstrip("/") + "/"
                    if h not in todo and h not in extra and not re.search(r"\.(pdf|jpe?g|png|zip)$", h, re.I):
                        extra.append(h)
                todo += extra[:a.crawl]
        todo = list(dict.fromkeys(todo))
        for u in todo:
            try:
                pg.goto(u, wait_until="domcontentloaded", timeout=30000); pg.wait_for_timeout(1200)
                fams = pg.evaluate(PROBE, SAMPLE)
            except Exception as e:
                rows.append({"url": u, "verdict": "ERROR", "body": str(e)[:60]}); continue
            v, body = classify(fams)
            rows.append({"url": u, "verdict": v, "body": body})
        b.close()
    if a.json:
        print(json.dumps(rows, indent=2)); return 0
    print(f"{'verdict':22} {'url':56} body font-family")
    for r in rows:
        print(f"{r['verdict']:22} {r['url'][:56]:56} {r['body'][:52]}")
    n = len(rows)
    exposed = sum(1 for r in rows if "LEADING" in r["verdict"])
    named = sum(1 for r in rows if r["verdict"].startswith(("apple", "system-ui")))
    err = sum(1 for r in rows if r["verdict"] == "ERROR")
    print(f"\n  pages            {n}  ({err} failed to load)")
    print(f"  name a platform face   {named}")
    print(f"  EXPOSED (it leads)     {exposed}")
    print("\n  Exposed pages are the ones whose typography follows the capturing machine.")
    print("  See docs/decisions/ADR-003-devicepreview-stops-at-the-honest-label.md")
    return 0

if __name__ == "__main__":
    sys.exit(main())
