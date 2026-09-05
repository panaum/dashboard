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

ENTRYPOINT ["python", "devicepreview.py"]
