# Runbook — the devicepreview runs volume

**Symptom this fixes:** a device on Layout checks shows only its first screen,
with the caption *"First screen only — the full page for this run is no longer
on the preview service. Run the check again to capture it."* Most devices say
it, most of the time, and the scroll ruler never appears.

**Cause:** `server.py` writes every run under `RUNS_DIR`, which the Dockerfile
sets to `/app/runs` (`ENV RUNS_DIR=/app/runs`, `WORKDIR /app`). With no volume
there, that path is container-local, so **every redeploy deletes every capture**.
The Dashboard stores its own copy of the *fold* in Postgres, which is why the
device still renders at all — the first screen survives and nothing below it
does.

Only the captures are at stake. Folds, findings, verdicts and run history live
in the Dashboard's database and are untouched by any of this.

## Sizing

Retention is **per site, not a global count** — a busy week on one page must
never evict another page's latest run — and it keeps derivatives over
originals. Per URL, the newest `RETAIN_PER_SITE` (default **2**) runs are kept:

| | |
|---|---|
| Newest run per site | report + PNG originals (~5 MB a phone) + 900px JPEGs |
| Older kept run | report + 900px JPEGs only (~1 MB a phone) |
| Anything older | deleted |

So the disk follows **the number of sites, not how often you check them**:
budget **≈ 100 MB per site** and multiply. Twenty sites ≈ 2 GB; fifty ≈ 5 GB.

**5 GB** is a sensible starting point for a portfolio of this size. Railway
volumes can be grown later but not shrunk, so there is no prize for guessing
high.

## Doing it

Mounting a volume restarts the service, so **the mount is the redeploy** — one
window, not two. If Railway deploys this repo's default branch, that same
restart also picks up whatever is currently on `main`.

1. Railway → the `devicepreview` service → **Data** (or **Volumes**) →
   **Add volume**.
2. Mount path: **`/app/runs`** — exactly this. It must match `RUNS_DIR`, which
   the Dockerfile sets. A typo here fails silently: the service keeps writing
   to container-local disk and nothing looks wrong until the next redeploy.
3. Size: **5 GB**, or `sites × 100 MB` if you have a number in mind.
4. Let it redeploy. Whatever captures exist now are lost — they were going to
   be lost at the next redeploy regardless.

## Verifying it actually worked

`/health` needs no key and reports the path and the retention figure:

```
curl -s https://<devicepreview-host>/health
# {"ok":true,"running":0,"retained":0,"configured":true,
#  "runs_dir":"/app/runs","retain_per_site":2,"live_session":false,"busy":false}
```

`runs_dir` reads `/app/runs` whether or not a volume is attached — the
Dockerfile sets it either way — so **that line confirms the path, not the
persistence.** The only real test is survival across a restart:

1. Layout checks → a site → **Devices** → **Run again**. Wait for it to finish.
2. Open a device and scroll. The full page should load and the ruler should
   appear, with no "First screen only" caption.
3. In Railway, **redeploy the service** — any redeploy will do.
4. Re-open that same run. Full page still there ⇒ the volume is mounted and
   working. Back to "First screen only" ⇒ the mount path does not match
   `RUNS_DIR`. Check it for a typo.

## When it fills up

Pruning runs after each capture and never touches a run in progress. If the
volume fills, the lever is `RETAIN_PER_SITE` — dropping it to `1` roughly
halves the footprint, at the cost of the baseline diff having nothing to
compare against. `DERIVATIVE_WIDTH` (900) and `DERIVATIVE_QUALITY` (82) trade
JPEG fidelity for space if you need a smaller cut.
