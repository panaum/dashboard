// What the preview service can honestly say while a run is in flight.
//
// The service reports {done, total, message}, where message is the CLI's most
// recent stderr line. One line is printed per capture:
//
//   "  iPhone 16                    webkit   light  ok        4213ms"
//
// so a poll can name the device that just finished and whether it captured.
// A poll only ever sees the latest line, so a device whose line landed between
// two polls is never marked captured: it stays "waiting" until the run ends
// and the saved report replaces all of this. Nothing here guesses which device
// finished from the count — the count is the service's, the per-device states
// are only the ones actually seen.

export type RunPhase = "idle" | "running" | "saving" | "done" | "failed";
/** What a poll saw of one device. "failed" covers a failed or blocked capture. */
export type DeviceRunState = "waiting" | "captured" | "failed";

export type RunProgress = {
  phase: RunPhase;
  done: number;
  total: number | null;
  message: string;
  /** By device label, only for devices a poll actually saw. */
  devices: Record<string, DeviceRunState>;
};

export const IDLE_PROGRESS: RunProgress = {
  phase: "idle", done: 0, total: null, message: "", devices: {},
};

// The CLI pads the label to 28 and the engine to 8; a longer label leaves one
// space, so the separator is "one or more", not "two".
const DEVICE_LINE = /^\s{2}(\S.*?)\s+(chromium|firefox|webkit)\s+(\w+)\s+(ok|failed|blocked)\b/;

export function parseDeviceLine(line: string): { label: string; state: DeviceRunState } | null {
  const m = DEVICE_LINE.exec(line ?? "");
  if (!m) return null;
  return { label: m[1].trim(), state: m[4] === "ok" ? "captured" : "failed" };
}

/** Fold one poll into the run state, keeping every device already seen. */
export function mergePoll(
  prev: RunProgress,
  poll: { phase?: RunPhase; done?: number | null; total?: number | null; message?: string | null },
): RunProgress {
  const message = poll.message ?? prev.message;
  const seen = parseDeviceLine(message);
  return {
    phase: poll.phase ?? prev.phase,
    done: poll.done ?? prev.done,
    total: poll.total ?? prev.total,
    message,
    devices: seen ? { ...prev.devices, [seen.label]: seen.state } : prev.devices,
  };
}

/** 0–100 for the bar; 0 until the service knows how many captures there are. */
export function progressPct(p: RunProgress): number {
  if (!p.total || p.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)));
}

/** The one line above the picker. Says what is true, not what is hoped. */
export function progressNote(p: RunProgress): string {
  switch (p.phase) {
    case "running":
      return p.total
        ? `Capturing — ${p.done} of ${p.total} done. Findings appear once the run is saved.`
        : "Starting the browsers… a full run takes one to two minutes.";
    case "saving":
      return "Saving this run and its screenshots…";
    case "done":
      return "Saved.";
    case "failed":
      return p.message || "The preview did not finish.";
    default:
      return "";
  }
}

export function isBusy(p: RunProgress): boolean {
  return p.phase === "running" || p.phase === "saving";
}
