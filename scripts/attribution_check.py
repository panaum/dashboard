#!/usr/bin/env python3
"""Landing page attribution checker — command line front door.

Give it a URL. It reports whether the page's forms would actually capture UTM
and click-id parameters, or whether leads arrive with the fields empty.

This file is only the terminal interface: argument parsing and the printed
report. The check itself lives in services/linkspy-api/attribution.py, which
the dashboard's scanner calls too — one implementation, two ways in.

    attribution_check.py https://example.com/lp
    attribution_check.py --file urls.txt --json
    attribution_check.py https://a.test https://b.test

Exit codes: 0 = no failures, 1 = at least one FAIL, 2 = usage/setup problem.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The engine lives with the backend that also serves it over HTTP.
ENGINE_DIR = Path(__file__).resolve().parents[1] / "services" / "linkspy-api"
sys.path.insert(0, str(ENGINE_DIR))

try:
    from attribution import (  # noqa: E402
        check_attribution, canonical_for, LATE_PASS_DELAY_S, DEFAULT_TIMEOUT_MS,
    )
except ImportError as exc:  # pragma: no cover - setup failure path
    print(f"could not load the attribution engine from {ENGINE_DIR}: {exc}", file=sys.stderr)
    raise SystemExit(2)


GLYPH = {"PASS": "PASS", "FAIL": "FAIL", "WARN": "WARN", "INFO": "····"}
OUTCOME_LINE = {
    "load_failed": "PAGE DID NOT LOAD",
    "timeout": "TIMED OUT",
    "no_form": "NO FORM FOUND",
}


def print_report(rep: dict) -> None:
    print()
    print("─" * 78)
    print(rep["url"])
    if rep.get("outcome") != "ok":
        line = OUTCOME_LINE.get(rep["outcome"], rep["outcome"].upper())
        print(f"  {line}" + (f" — {rep['error']}" if rep.get("error") else ""))
        if rep["outcome"] != "no_form":
            return
    print("─" * 78)
    for c in rep.get("checks", []):
        print(f"  {GLYPH.get(c['status'], c['status']):<4}  {c['name']:<22} {c['detail']}")

    fields = [
        (f.get("name"), f.get("value"), f.get("hidden"), form.get("frame"))
        for form in rep.get("forms", [])
        for f in form.get("fields", [])
        if canonical_for(f.get("name", ""))
    ]
    if fields:
        print()
        print("  attribution fields")
        for name, value, hidden, frame in fields:
            shown = value if value else "(empty)"
            where = "main" if frame == "main" else "iframe"
            flag = "hidden" if hidden else "visible"
            print(f"    {name:<28} {shown:<20} {flag:<8} {where}")


def summarise(reports: list[dict]) -> None:
    failed = [r for r in reports if r.get("failed")]
    print()
    print("─" * 78)
    if not failed:
        print(f"  {len(reports)} page(s) checked · no failures")
    else:
        print(f"  {len(reports)} page(s) checked · {len(failed)} with failures:")
        for r in failed:
            reason = OUTCOME_LINE.get(r.get("outcome")) or next(
                (c["detail"] for c in r.get("checks", []) if c["status"] == "FAIL"), "failed")
            print(f"    {r['url']} — {reason}")
    print()


def read_urls(args) -> list[str]:
    urls = list(args.urls)
    if args.file:
        try:
            for line in Path(args.file).read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    urls.append(line)
        except OSError as e:
            print(f"could not read {args.file}: {e}", file=sys.stderr)
            raise SystemExit(2)
    return urls


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Check whether a landing page's forms actually capture attribution.")
    ap.add_argument("urls", nargs="*", help="page URL(s) to check")
    ap.add_argument("--file", help="file of URLs, one per line (# comments allowed)")
    ap.add_argument("--json", action="store_true", dest="as_json",
                    help="emit JSON instead of the readable report")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_MS // 1000,
                    help="page load timeout in seconds (default 30)")
    ap.add_argument("--delay", type=float, default=LATE_PASS_DELAY_S,
                    help="seconds to wait before the second read (default 3)")
    args = ap.parse_args()

    urls = read_urls(args)
    if not urls:
        ap.print_usage(sys.stderr)
        print("give at least one URL, or --file", file=sys.stderr)
        return 2

    try:
        import playwright  # noqa: F401
    except ImportError:
        print("playwright is not installed. pip install playwright && playwright install chromium",
              file=sys.stderr)
        return 2

    reports: list[dict] = []
    for url in urls:
        rep = check_attribution(url, args.timeout * 1000, args.delay)
        reports.append(rep)
        if not args.as_json:
            print_report(rep)

    if args.as_json:
        print(json.dumps({"results": reports}, indent=2))
    else:
        summarise(reports)

    return 1 if any(r.get("failed") for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
