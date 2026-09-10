// COPY FOR THE DEVELOPER.
//
// What actually happens to a finding is that someone pastes it into Slack, a
// ticket or an email. Doing that by hand loses the half that matters — which
// device, which size, which selector, and why it is worth fixing — so the
// paste arrives as "the button is small" and comes back as "works for me".
// This writes the whole thing out as plain text, ready to send.

export type CopyFinding = {
  /** The short line: "Tap target 77 × 14". */
  label: string;
  /** The tool's own sentence, with the numbers in it. */
  message?: string;
  selector: string | null;
  pageLevel?: boolean;
  /** "Samsung Galaxy S25 · Chromium · 412 × 892", or "470px · Phone". */
  where: string;
  /** What it does to a visitor, and the usual fix. */
  why?: string;
  fix?: string;
  /** Its number on the screenshot, when it has one. */
  pin?: number | null;
  severity?: "error" | "warn" | "info";
};

const SEV: Record<string, string> = { error: "Error", warn: "Warning", info: "Note" };

/** One finding, as pasteable text. */
export function findingText(f: CopyFinding, url: string): string {
  const head = [f.pin ? `#${f.pin}` : null, f.severity ? `[${SEV[f.severity] ?? f.severity}]` : null, f.label]
    .filter(Boolean).join(" ");
  const lines = [
    head,
    `Where: ${f.where}`,
    `Element: ${f.pageLevel ? "whole page" : (f.selector ?? "not recorded")}`,
  ];
  if (f.message && f.message !== f.label) lines.push(`Measured: ${f.message}`);
  if (f.why) lines.push(`Why it matters: ${f.why}`);
  if (f.fix) lines.push(`Usual fix: ${f.fix}`);
  lines.push(`Page: ${url}`);
  return lines.join("\n");
}

/** Every finding shown, under one heading. */
export function allFindingsText(findings: CopyFinding[], url: string, heading: string): string {
  if (!findings.length) return `${heading}\nNothing to fix.\nPage: ${url}`;
  const body = findings.map((f) => findingText({ ...f, }, url)
    .split("\n").filter((l) => !l.startsWith("Page: ")).join("\n"));
  return [`${heading} — ${findings.length} finding${findings.length === 1 ? "" : "s"}`, "", ...body.map((b) => b + "\n"), `Page: ${url}`].join("\n");
}
