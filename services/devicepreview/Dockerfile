FROM python:3.11-slim

# Fonts FIRST. They are the single biggest source of garbage screenshots on
# headless Linux: without them every proportional face falls back to whatever
# is installed, which is often a monospace, and a hundred captures come out
# wrong the same way. Do NOT add Apple's San Francisco here — the licence does
# not permit it. Pages that ask for -apple-system are substituted, and the
# report says so in an info note.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-liberation fonts-noto fonts-noto-cjk fonts-noto-color-emoji \
      fonts-dejavu-core fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# All three engines: Chromium (Blink), Firefox (Gecko), WebKit (Safari's engine).
RUN playwright install --with-deps chromium firefox webkit

COPY . .
ENV PYTHONUNBUFFERED=1

# Fail the BUILD if font fallback is broken, rather than shipping a container
# that silently produces wrong screenshots. This renders a test page in all
# three engines and exits 2 if proportional text comes out monospace.
RUN python devicepreview.py --self-check

# The service the Dashboard talks to. Runs are kept under RUNS_DIR; mount a
# persistent volume there on Railway so galleries survive a redeploy.
ENV RUNS_DIR=/app/runs
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
# The CLI is still there for one-off use: docker run <image> python devicepreview.py <url>
