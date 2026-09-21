"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isNews, type Activity } from "@/lib/board-alive";

// One timer for the whole board, not one per card: the board owns the poll and
// hands the open card its typing line. See /api/boards/pulse for why this is a
// poll and not a socket.

const INTERVAL_MS = 6_000;

export type Present = { memberId: string; name: string };

export function useBoardPulse(opts: {
  projectId?: string;
  boardShareId?: string;
  /** Who is watching, when that is knowable — so their own actions can be
   *  told apart from everybody else's. Null on a board link. */
  viewerId?: string | null;
  /** Fired once per thing somebody else did, never for your own. */
  onNews?: () => void;
}) {
  const [present, setPresent] = useState<Present[]>([]);
  const [typingLine, setTypingLine] = useState<string | null>(null);
  const openIssue = useRef<string | null>(null);
  const typing = useRef(false);
  const version = useRef<string | null>(null);
  const seenActivity = useRef<string | null>(null);
  const beatRef = useRef<() => void>(() => {});
  const router = useRouter();
  const { projectId, boardShareId, viewerId = null } = opts;
  // Held in a ref, refreshed after each render, so a caller can pass an inline
  // closure without restarting the heartbeat every time it re-renders — and
  // so the closure the beat calls is always the latest one, with the caller's
  // current state inside it.
  const onNews = useRef(opts.onNews);
  useEffect(() => { onNews.current = opts.onNews; });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const beat = async () => {
      // A hidden tab is not a viewer. This keeps a forgotten background tab
      // from reporting someone as present all afternoon — and stops it polling.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(beat, INTERVAL_MS);
        return;
      }
      try {
        const res = await fetch("/api/boards/pulse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, boardShareId, issueId: openIssue.current, typing: typing.current }),
        });
        if (res.ok && alive) {
          const data = (await res.json()) as {
            version: string; present: Present[]; typing: string | null; activity: Activity | null;
          };
          setPresent(data.present ?? []);
          setTypingLine(data.typing ?? null);
          // Somebody else moved a card or said something. Recorded before it
          // is announced, so a handler that throws cannot make it announce
          // the same thing again six seconds later.
          const news = isNews(seenActivity.current, data.activity, viewerId);
          seenActivity.current = data.activity?.at ?? seenActivity.current ?? "";
          if (news) onNews.current?.();
          // Someone else moved a card, commented, or added one: pull the new
          // server render. The first beat only records the version — there is
          // nothing to catch up on when the page just loaded.
          if (version.current !== null && data.version !== version.current) router.refresh();
          version.current = data.version;
        }
      } catch {
        // A missed beat is not an error worth showing anyone; the next one
        // corrects it, and presence expires on its own if they keep failing.
      } finally {
        if (alive) timer = setTimeout(beat, INTERVAL_MS);
      }
    };

    beatRef.current = () => { clearTimeout(timer); void beat(); };
    void beat();
    return () => { alive = false; clearTimeout(timer); };
  }, [projectId, boardShareId, viewerId, router]);

  /** Which card is open. This is what the viewer hears about; it does not
   *  claim anything on their behalf. */
  const setOpenIssue = useCallback((issueId: string | null) => {
    if (openIssue.current === issueId) return;
    openIssue.current = issueId;
    if (!issueId) typing.current = false;
    setTypingLine(null);
    beatRef.current();
  }, []);

  /** Claim or release "typing" on the open card. Beats immediately so the
   *  other side sees it within a keystroke rather than within six seconds. */
  const setTyping = useCallback((active: boolean) => {
    if (typing.current === active) return;
    typing.current = active;
    beatRef.current();
  }, []);

  return { present, typingLine, setOpenIssue, setTyping };
}

/**
 * A short, soft two-note chime, synthesised rather than shipped: no audio file,
 * no asset pipeline, and nothing to 404. Off unless the viewer turned it on in
 * this browser.
 *
 * The suspended-context dance is load-bearing, not defensive tidying. A browser
 * creates every new AudioContext in the "suspended" state until the document
 * has been interacted with, and notes scheduled on a suspended context are
 * dropped in silence — no error, nothing to see. Since a chime is triggered by
 * somebody ELSE's action arriving on a poll, the obvious case is exactly the
 * broken one: a board left open, untouched, when a card moves. So: resume
 * first, schedule after.
 */
export function playBoardChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const ring = () => {
      const now = ctx.currentTime;
      [
        { f: 587.33, t: 0 },     // D5
        { f: 880.0, t: 0.11 },   // A5
      ].forEach(({ f, t }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        // A short bell-ish envelope; nothing percussive, nothing long.
        gain.gain.setValueAtTime(0.0001, now + t);
        gain.gain.exponentialRampToValueAtTime(0.09, now + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.3);
      });
      setTimeout(() => void ctx.close(), 800);
    };
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      // Rejects when the page has never been clicked. Nothing to do about
      // that from here, and nothing worth telling anyone about.
      ctx.resume().then(ring, () => void ctx.close());
    } else {
      ring();
    }
  } catch {
    // No audio device, autoplay refused, or a browser without WebAudio: a
    // sound nobody hears is not worth an error.
  }
}

const SOUND_KEY = "boardsSoundEnabled";

/** Per browser, default off. localStorage throws in some privacy modes, so
 *  every read and write is guarded and the default survives. */
export function useSoundPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try { setOn(window.localStorage.getItem(SOUND_KEY) === "1"); } catch { /* private mode */ }
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try { window.localStorage.setItem(SOUND_KEY, next ? "1" : "0"); } catch { /* private mode */ }
  }, []);
  return [on, set];
}
