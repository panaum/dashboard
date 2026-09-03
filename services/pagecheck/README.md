# Pagecheck

Paste a landing page URL, get a verdict on whether that page will actually
capture leads and attribution — or whether it is silently losing them.

    pip install -r requirements.txt
    playwright install chromium

**Web UI** — one screen, no login:

    uvicorn app:app --port 8000      # then open http://127.0.0.1:8000

**Command line** — same engine, same report:

    python cli.py https://example.com/lp
    python cli.py --file urls.txt --json     # non-zero exit on any FAIL

`engine.py` holds every check. `app.py` and `cli.py` are thin callers of
`check_page()` — one implementation, never two.

Read-only: it loads pages with test attribution parameters attached and reads
the forms back. It never submits a form.
