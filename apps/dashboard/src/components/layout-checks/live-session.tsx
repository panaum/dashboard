"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCw, ChevronLeft, X, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// A real browser on the other end of a socket: the service runs a Chromium
// context at this profile's viewport, density, user agent and touch, and sends
// JPEG frames. What you do here is forwarded back — and a tap arrives at the
// page as a real touch event, which is the whole reason this exists rather
// than an iframe.
//
// Frames are binary, state is text, so the two never need sniffing apart.
// The stream is change-driven: a still page sends nothing at all.

type State =
  | { phase: "connecting" }
  | { phase: "live"; title?: string }
  | { phase: "closed"; detail: string };

/** What a person means when they type an address, or null if it is not one. */
function normalise(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/** The address without the QA parameters we add — those are plumbing. */
function clean(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
                     "gclid", "fbclid"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

export function LiveSession({
  url,
  profileId,
  viewport,
  hasTouch,
  onExit,
}: {
  url: string;
  profileId: string;
  viewport: { width: number; height: number };
  hasTouch: boolean;
  onExit: () => void;
}) {
  // The session opens on the page being checked, and the address bar takes you
  // anywhere else. Each address is a fresh token: the token pins one url, which
  // is what makes a leaked one harmless, so a new address means a new mint
  // rather than a loosening of the pin.
  const [target, setTarget] = useState(url);
  const [typed, setTyped] = useState(url);
  const [state, setState] = useState<State>({ phase: "connecting" });
  const [frame, setFrame] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const lastUrl = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // One session per mount. No automatic reconnect: a dropped socket means the
  // browser on the other side is gone, and silently starting another would
  // hold a second one open without anyone asking.
  useEffect(() => {
    let live = true;
    let ws: WebSocket | null = null;

    (async () => {
      try {
        const res = await fetch("/api/devicepreview/live-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target, profile: profileId }),
        });
        const data = await res.json();
        if (!live) return;
        if (!res.ok || !data?.socketUrl) {
          setState({ phase: "closed", detail: data?.error ?? "Could not start a session." });
          return;
        }
        ws = new WebSocket(data.socketUrl);
        ws.binaryType = "blob";
        socket.current = ws;

        // The token goes in the first message, never the URL: a query string
        // is written to the service's access log in full, and a token on disk
        // is one that can be replayed until it expires.
        ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", token: data.token }));

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            const msg = JSON.parse(ev.data);
            if (msg.type === "ready") setState({ phase: "live", title: msg.title });
            else if (msg.type === "closed") setState({ phase: "closed", detail: msg.detail });
            // The browser is ours, so unlike an iframe it can say where a click
            // took you. The QA parameters we sign in are stripped for display:
            // they are how the visit stays out of the client's analytics, not
            // part of the address anyone means.
            else if (msg.type === "url" && typeof msg.url === "string") setTyped(clean(msg.url));
            return;
          }
          // A frame. Swap the object URL and release the previous one, or the
          // tab leaks a blob per frame — twenty a second adds up quickly.
          const next = URL.createObjectURL(ev.data as Blob);
          if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
          lastUrl.current = next;
          setFrame(next);
        };
        ws.onerror = () => live && setState({ phase: "closed", detail: "The connection to the preview service failed." });
        ws.onclose = () => live && setState((s) => s.phase === "live"
          ? { phase: "closed", detail: "The session ended." } : s);
      } catch {
        if (live) setState({ phase: "closed", detail: "Could not reach the Dashboard to start a session." });
      }
    })();

    return () => {
      live = false;
      // No need to cancel a pending wheel flush: send() checks the socket, and
      // the socket is dropped on the next line, so a late frame does nothing.
      ws?.close();
      socket.current = null;
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, [target, profileId]);

  // A trackpad emits wheel events far faster than any browser can act on them,
  // and one message per event puts a queue between your fingers and the page:
  // the service applies each wheel as its own round trip, in order. Deltas are
  // accumulated and flushed once per animation frame instead, so a flick
  // becomes a few large scrolls rather than a hundred small ones.
  const wheel = useRef({ dx: 0, dy: 0 });
  const wheelFrame = useRef<number | null>(null);

  const send = useCallback((ev: Record<string, unknown>) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
  }, []);

  /** Screen coordinates → the device's own CSS pixels, whatever size we drew it. */
  const toDevice = (clientX: number, clientY: number) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return {
      x: Math.round(((clientX - r.left) / r.width) * viewport.width),
      y: Math.round(((clientY - r.top) / r.height) * viewport.height),
    };
  };

  const live = state.phase === "live";

  const go = () => {
    const next = normalise(typed);
    if (!next) return;
    setFrame(null);
    setState({ phase: "connecting" });
    setTarget(next);            // a new address is a new session on a new token
  };

  return (
    <div className="flex w-full flex-col items-center gap-2.5">
      <div
        className={cn("relative w-full max-w-full overflow-hidden rounded-md bg-white",
                      live ? "cursor-pointer" : "cursor-default")}
        style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
        onPointerDown={(e) => {
          const p = toDevice(e.clientX, e.clientY);
          if (p) send({ type: hasTouch ? "tap" : "click", ...p });
        }}
        onWheel={(e) => {
          wheel.current.dx += e.deltaX;
          wheel.current.dy += e.deltaY;
          if (wheelFrame.current !== null) return;
          wheelFrame.current = requestAnimationFrame(() => {
            wheelFrame.current = null;
            const { dx, dy } = wheel.current;
            wheel.current = { dx: 0, dy: 0 };
            if (dx || dy) send({ type: "scroll", dx, dy });
          });
        }}
        onKeyDown={(e) => {
          if (e.key.length === 1) send({ type: "type", text: e.key });
          else send({ type: "key", key: e.key });
          if (e.key !== "Tab") e.preventDefault();
        }}
        tabIndex={0}
        role="application"
        aria-label={`Live session on this device. Click to interact; the page responds as it would on the device.`}
      >
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={imgRef} src={frame} alt="" draggable={false}
               className="block h-full w-full select-none object-top" />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center">
            {state.phase === "closed" ? (
              <p className="text-[12.5px] leading-relaxed text-text-secondary">{state.detail}</p>
            ) : (
              <p className="flex items-center gap-2 text-[12.5px] text-text-muted">
                <Loader2 className="size-4 animate-spin" /> Starting a browser on the device…
              </p>
            )}
          </div>
        )}

        {state.phase === "closed" && frame && (
          <div className="absolute inset-0 grid place-items-center bg-white/85 px-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-text-secondary">{state.detail}</p>
          </div>
        )}
      </div>

      <form
        className="flex w-full max-w-[420px] items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); go(); }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          spellCheck={false}
          inputMode="url"
          aria-label="Address to open on this device"
          className="h-8 min-w-0 flex-1 rounded-md border border-border-soft bg-card px-2.5 font-mono text-[12px] text-text-primary outline-none transition-colors focus:border-accent/50"
        />
        <Button type="submit" variant="secondary" size="sm" title="Open this address on the device">
          <CornerDownLeft className="size-4" /> Go
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={!live}
                onClick={() => send({ type: "back" })} title="Back, in the device's browser">
          <ChevronLeft className="size-4" /> Back
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={!live}
                onClick={() => send({ type: "reload" })}>
          <RotateCw className="size-4" /> Reload
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onExit}>
          <X className="size-4" /> End session
        </Button>
      </div>

      <p className="max-w-sm text-center text-[11.5px] leading-relaxed text-text-muted">
        {live
          ? "A real browser on the device's profile — taps arrive as touch events, and the visit is tagged as QA so it stays out of the client's analytics. It closes itself after a few minutes idle."
          : state.phase === "connecting"
            ? "One session runs at a time."
            : "The browser has been released."}
      </p>
    </div>
  );
}
