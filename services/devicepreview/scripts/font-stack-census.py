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

# A page that is not the page: a bot wall or an error stub styles itself, and
# measuring its stylesheet measures the wall. Cloudflare's block page, for one,
# sets -apple-system on every heading and would count as exposed.
BLOCKED = re.compile(r"attention required|just a moment|access denied|you have been blocked|"
                     r"page not found|nopage_error", re.I)

def leading(stack: str) -> bool:
    """Is the platform face the FIRST family, i.e. does it actually draw?"""
    first = stack.split(",")[0].strip().strip('"\'').lower()
    return first in ("-apple-system", "system-ui", "blinkmacsystemfont")

def classify(fams: dict[str, str]) -> tuple[str, list[str]]:
    """Verdict, and the sampled elements whose text is set in the platform face.

    Every element is judged on its own stack. Checking body alone overstated
    one real page (links in the system face, headings in a webfont) and would
    have missed any page whose paragraphs lead with it under a webfont body."""
    exposed = [sel for sel, ff in fams.items() if leading(ff)]
    blob = " | ".join(fams.values())
    kind = "apple" if APPLE.search(blob) else "system-ui" if SYSUI.search(blob) else None
    if kind is None:
        return "none", []
    return (f"{kind} LEADING" if exposed else f"{kind} (fallback)"), exposed

def page_key(url: str) -> str:
    """One page, however it was spelled: /LisaMarie and /LisaMarie/ are the same."""
    u = urlparse(url)
    return f"{u.netloc.replace('www.', '')}{u.path.rstrip('/')}"

def same_host(a, b):
    return urlparse(a).netloc.replace("www.", "") == urlparse(b).netloc.replace("www.", "")

def within(link, seed):
    """Crawl inside the seed's own path: dev.apexure.org hosts more than one client."""
    base = urlparse(seed).path.rstrip("/")
    return same_host(link, seed) and urlparse(link).path.rstrip("/").startswith(base)

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
                    if not h.startswith("http") or not within(h, seed): continue
                    h = h.split("#")[0].rstrip("/") + "/"
                    if h not in todo and h not in extra and not re.search(r"\.(pdf|jpe?g|png|zip)$", h, re.I):
                        extra.append(h)
                todo += extra[:a.crawl]
        todo = list(dict.fromkeys(todo))
        seen = set()
        for u in todo:
            try:
                pg.goto(u, wait_until="domcontentloaded", timeout=30000); pg.wait_for_timeout(1200)
                fams = pg.evaluate(PROBE, SAMPLE)
                title = pg.title(); text = pg.evaluate("()=>document.body.innerText.slice(0,300)")
            except Exception as e:
                rows.append({"url": u, "verdict": "ERROR", "body": str(e)[:60], "elements": []}); continue
            key = page_key(pg.url)              # after redirects, not as requested
            if key in seen: continue
            seen.add(key)
            if BLOCKED.search(title) or BLOCKED.search(text):
                rows.append({"url": pg.url, "verdict": "BLOCKED", "body": title[:52], "elements": []}); continue
            v, exposed = classify(fams)
            rows.append({"url": pg.url, "verdict": v, "body": fams.get("body", ""), "elements": exposed})
        b.close()
    if a.json:
        print(json.dumps(rows, indent=2)); return 0
    print(f"{'verdict':22} {'url':52} body font-family / exposed elements")
    for r in rows:
        extra = f"  [{', '.join(r['elements'])}]" if r.get("elements") else ""
        print(f"{r['verdict']:22} {r['url'][:52]:52} {r['body'][:40]}{extra}")
    measured = [r for r in rows if r["verdict"] not in ("ERROR", "BLOCKED")]
    exposed = sum(1 for r in measured if "LEADING" in r["verdict"])
    named = sum(1 for r in measured if r["verdict"] != "none")
    err = sum(1 for r in rows if r["verdict"] == "ERROR")
    blocked = sum(1 for r in rows if r["verdict"] == "BLOCKED")
    print(f"\n  pages measured         {len(measured)}  ({err} failed to load, {blocked} blocked or an error stub)")
    print(f"  name a platform face   {named}")
    print(f"  EXPOSED (it leads)     {exposed}")
    print("\n  Exposed pages are the ones whose typography follows the capturing machine.")
    print("  See docs/decisions/ADR-003-devicepreview-stops-at-the-honest-label.md")
    return 0

if __name__ == "__main__":
    sys.exit(main())
