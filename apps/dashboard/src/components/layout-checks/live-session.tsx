"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCw, ChevronLeft, X } from "lucide-react";
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
          body: JSON.stringify({ url, profile: profileId }),
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

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            const msg = JSON.parse(ev.data);
            if (msg.type === "ready") setState({ phase: "live", title: msg.title });
            else if (msg.type === "closed") setState({ phase: "closed", detail: msg.detail });
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
      ws?.close();
      socket.current = null;
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, [url, profileId]);

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
        onWheel={(e) => send({ type: "scroll", dx: e.deltaX, dy: e.deltaY })}
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
          ? "A real browser on the device's profile — taps arrive as touch events. It closes itself after a few minutes idle."
          : state.phase === "connecting"
            ? "One session runs at a time."
            : "The browser has been released."}
      </p>
    </div>
  );
}
