"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// X-RAY VIEW — a full-page screenshot of the scanned page with every
// clickable element boxed on top. Its own headless capture (seconds), so it
// loads ON DEMAND, never as part of a scan. Best-effort: an unavailable
// capture says so and the scanner carries on.

type XrayElement = { x: number; y: number; w: number; h: number; kind?: string | null; href?: string | null };
type Xray =
  | {
      available: true; screenshot: string; mime?: string;
      page_width: number; page_height: number; elements?: XrayElement[];
    }
  | { available: false; error?: string };

export function ScannerXray({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [xray, setXray] = useState<Xray | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const started = useRef(false);

  // Opening the tab IS the request. The parent mounts this on first open and
  // keeps it mounted, so the capture runs once, not on every tab switch.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/linkspy/monitor?view=xray&url=${encodeURIComponent(url)}`);
      const body = (await res.json()) as Xray & { unavailable?: boolean };
      if (body && "available" in body && body.available) {
        setXray(body);
        setState("done");
      } else {
        setState("failed");
      }
    } catch {
      setState("failed");
    }
  }

  if (state === "idle" || state === "loading") {
    return (
      <p className="flex items-center gap-2 text-[13px] text-text-secondary">
        <Loader2 className="size-4 animate-spin" /> Capturing the page…
      </p>
    );
  }

  if (state === "failed" || !xray || !("screenshot" in xray)) {
    return (
      <p className="text-[13px] text-text-secondary">
        The X-ray capture is unavailable for this page — the results above are unaffected.
      </p>
    );
  }

  const els = xray.elements ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} />
          Show clickable elements ({els.length})
        </label>
      </div>
      {/* The screenshot is the coordinate space: box positions come back in
          page pixels, so the overlay scales with the image via percentages. */}
      <div className="relative max-h-[560px] overflow-auto rounded-lg border border-border-soft">
        <div className="relative" style={{ width: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${xray.mime ?? "image/png"};base64,${xray.screenshot}`}
            alt="Full-page capture of the scanned page"
            className="block w-full"
          />
          {showBoxes &&
            els.map((el, i) => (
              <span
                key={i}
                title={el.href ?? el.kind ?? "clickable"}
                className="absolute border border-accent/70 bg-accent/10"
                style={{
                  left: `${(el.x / (xray.page_width || 1)) * 100}%`,
                  top: `${(el.y / (xray.page_height || 1)) * 100}%`,
                  width: `${(el.w / (xray.page_width || 1)) * 100}%`,
                  height: `${(el.h / (xray.page_height || 1)) * 100}%`,
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
