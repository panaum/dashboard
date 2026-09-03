#!/usr/bin/env python3
"""Pagecheck — command line.

    pagecheck https://example.com/lp
    pagecheck --file urls.txt --json
    pagecheck https://a.test https://b.test

Argument parsing and printing only; the checking is engine.check_page().
Exit codes: 0 = nothing failed, 1 = at least one FAIL, 2 = usage problem.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import check_page, DEFAULT_TIMEOUT_MS, LATE_DELAY_S  # noqa: E402

MARK = {"PASS": "PASS", "FAIL": "FAIL", "WARN": "WARN", "INFO": "····"}
OUTCOME = {"load_failed": "PAGE DID NOT LOAD", "timeout": "TIMED OUT",
           "no_form": "NO FORM FOUND"}


def render(rep: dict) -> None:
    print()
    print("─" * 78)
    print(rep["url"])
    if rep.get("platform") and rep["platform"] != "unknown":
        note = rep.get("platform_note") or ""
        print(f"{rep['platform']}{f' · {note}' if note else ''}")
    if rep.get("outcome") not in ("ok", None):
        line = OUTCOME.get(rep["outcome"], rep["outcome"].upper())
        print(f"  {line}" + (f" — {rep['error']}" if rep.get("error") else ""))
        if rep["outcome"] != "no_form":
            return
    print("─" * 78)
    for c in rep.get("checks", []):
        print(f"  {MARK.get(c['status'], c['status']):<4}  {c['name']:<22} {c['detail']}")
        for ev in c.get("evidence", [])[:6]:
            print(f"          {ev}")

    diff = (rep.get("consent_diff") or {}).get("fields_differ") or {}
    if diff:
        print("\n  consent divergence")
        print(f"    {'field':<18} {'accepted':<26} ignored")
        for field, v in diff.items():
            print(f"    {field:<18} {(v['accepted'] or '(empty)'):<26} {v['ignored'] or '(empty)'}")


def summarise(reports: list[dict]) -> None:
    bad = [r for r in reports if r.get("failed")]
    print()
    print("─" * 78)
    if not bad:
        print(f"  {len(reports)} page(s) checked · nothing failed")
    else:
        print(f"  {len(reports)} page(s) checked · {len(bad)} with failures:")
        for r in bad:
            why = OUTCOME.get(r.get("outcome")) or next(
                (c["detail"] for c in r.get("checks", []) if c["status"] == "FAIL"), "failed")
            print(f"    {r['url']} — {why}")
    print()


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="pagecheck",
        description="Will this landing page actually capture leads and attribution?")
    ap.add_argument("urls", nargs="*", help="page URL(s)")
    ap.add_argument("--file", help="file of URLs, one per line (# comments allowed)")
    ap.add_argument("--json", action="store_true", dest="as_json", help="emit JSON")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_MS // 1000,
                    help="page load timeout in seconds (default 30)")
    ap.add_argument("--delay", type=float, default=LATE_DELAY_S,
                    help="seconds before the second read (default 3)")
    args = ap.parse_args()

    urls = list(args.urls)
    if args.file:
        try:
            urls += [ln.strip() for ln in Path(args.file).read_text(encoding="utf-8").splitlines()
                     if ln.strip() and not ln.strip().startswith("#")]
        except OSError as exc:
            print(f"could not read {args.file}: {exc}", file=sys.stderr)
            return 2
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

    reports = []
    for url in urls:
        rep = check_page(url, args.timeout * 1000, args.delay)
        reports.append(rep)
        if not args.as_json:
            render(rep)

    if args.as_json:
        print(json.dumps({"results": reports}, indent=2))
    else:
        summarise(reports)
    return 1 if any(r.get("failed") for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
