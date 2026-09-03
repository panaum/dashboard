// ATTRIBUTION, IN PLAIN LANGUAGE.
//
// The engine reports in its own vocabulary — "no attribution field exists on
// any form", "test values also found in cookie[_gcl_aw]". True, precise, and
// unreadable unless you already know what a hidden field is.
//
// This turns a report into the three things a reader actually needs: what it
// means, what we found, and what to do about it. Pure — no I/O, no React.

export type RawCheck = { name: string; status: "PASS" | "FAIL" | "WARN" | "INFO"; detail: string };

export type RawReport = {
  outcome?: string;
  error?: string;
  platform?: string;
  platform_note?: string;
  checks?: RawCheck[];
  storage_hits?: string[];
  /** Platforms identifying the visitor by cookie, which attribute a lead
   *  without needing a hidden field. Their presence changes the verdict. */
  cookie_attribution?: string[];
  forms?: Array<{ frame?: string; fields?: Array<{ name?: string; value?: string; hidden?: boolean }> }>;
};

export type PlainVerdict = {
  tone: "error" | "warning" | "success" | "neutral";
  /** The answer, in one line, from the reader's side of the screen. */
  headline: string;
  /** Two sentences of what that means for them. */
  meaning: string;
  /** Bullet findings, already in human words. */
  findings: string[];
  /** Empty when nothing is wrong. */
  fix: string[];
};

const UTM_FIELDS = "utm_source, utm_medium, utm_campaign, gclid";

/** "a, b and c" — a list a person would say out loud. */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Check names differ between the two engines that have fed this panel
 *  ("Attribution fields" vs "Attribution capture", "Tracking present" vs
 *  "Tracking tags"). Match on any known alias so a rename cannot silently
 *  turn a real failure into a clean bill of health. */
const ALIASES: Record<string, string[]> = {
  "Attribution fields": ["Attribution fields", "Attribution capture"],
  "Attribution captured": ["Attribution captured", "Attribution capture"],
  "Forms found": ["Forms found"],
  "Tracking present": ["Tracking present", "Tracking tags"],
  "Population timing": ["Population timing"],
};

function check(report: RawReport, name: string): RawCheck | undefined {
  const names = ALIASES[name] ?? [name];
  return (report.checks ?? []).find((c) => names.includes(c.name));
}

/** Count the forms the engine found, from its own summary line. */
function formCounts(report: RawReport): { forms: number; embedded: number } {
  const detail = check(report, "Forms found")?.detail ?? "";
  const forms = Number(/(\d+)\s+form/.exec(detail)?.[1] ?? 0);
  const embedded = Number(/(\d+)\s+inside an iframe/.exec(detail)?.[1] ?? 0);
  return { forms, embedded };
}

/** Which ad platforms tagged the visit, named as products not variables. */
function trackersPresent(report: RawReport): string[] {
  const detail = check(report, "Tracking present")?.detail ?? "";
  const out: string[] = [];
  if (/GTM/.test(detail)) out.push("Google Tag Manager");
  if (/GA4/.test(detail)) out.push("Google Analytics");
  if (/Meta pixel/i.test(detail)) out.push("the Meta pixel");
  return out;
}

/** Did the campaign information reach the browser at all? Cookie names like
 *  _gcl_aw and _fbc are Google's and Meta's own click trackers. */
function browserGotIt(report: RawReport): boolean {
  return (report.storage_hits ?? []).length > 0;
}

export function plainAttribution(report: RawReport | null | undefined): PlainVerdict {
  if (!report) {
    return {
      tone: "neutral",
      headline: "We couldn't check this page",
      meaning: "The check didn't complete. Nothing else on this scan is affected.",
      findings: [], fix: [],
    };
  }

  if (report.outcome && report.outcome !== "ok") {
    const why = report.outcome === "no_form"
      ? "This page has no form on it, so there is nothing to capture a lead with."
      : report.outcome === "timeout"
        ? "The page took too long to load, so we couldn't read its forms."
        : "The page wouldn't load, so we couldn't read its forms.";
    return {
      tone: report.outcome === "no_form" ? "neutral" : "warning",
      headline: report.outcome === "no_form" ? "No form on this page" : "We couldn't check this page",
      meaning: why,
      findings: [], fix: [],
    };
  }

  const { forms, embedded } = formCounts(report);
  const fieldsCheck = check(report, "Attribution fields");
  const capturedCheck = check(report, "Attribution captured");
  const timing = check(report, "Population timing");
  const trackers = trackersPresent(report);
  const inBrowser = browserGotIt(report);

  // One line, not a briefing. Anything more precise lives under Technical
  // detail — nobody reads four bullets in a scanner tab.
  const findings: string[] = [];
  if (forms || embedded) {
    const parts: string[] = [];
    if (forms) parts.push(`${forms} form${forms === 1 ? "" : "s"}`);
    if (embedded) parts.push(`${embedded} in an embedded widget`);
    findings.push(`Checked ${parts.join(", ")}.`);
  }
  const trackerLine = trackers.length ? `${listWords(trackers)} are installed.` : null;
  if (trackerLine) findings.push(trackerLine);

  // Case 1 — no field on the page holds the campaign information. Whether
  // that is a problem depends entirely on whether something else is tracking
  // the visitor, so the two cases are answered differently.
  // "Attribution fields" warns for two different reasons: no field at all
  // (with cookies covering it), or some fields present and a couple missing.
  // Only the first belongs here — the engine omits "Attribution captured"
  // entirely when it found no fields, which is the reliable signal.
  const detail = (fieldsCheck?.detail ?? "").toLowerCase();
  const saysEmpty = detail.includes("stayed empty") || detail.includes("but they arrived empty");
  const saysNoField = detail.includes("no attribution field");
  // One engine emits a separate "Attribution captured" check; the other folds
  // both into one line. Trust an explicit "no attribution field" over the
  // absence of a second check.
  const noFieldsAtAll = saysNoField || (!capturedCheck && !saysEmpty && !detail.includes("captured"));
  if (noFieldsAtAll && (fieldsCheck?.status === "FAIL" || fieldsCheck?.status === "WARN")) {
    const byCookie = report.cookie_attribution ?? [];

    if (byCookie.length) {
      return {
        tone: "warning",
        headline: "The form itself records no campaign data",
        meaning:
          `${listWords(byCookie)} track this visitor separately, so a lead that reaches ` +
          `those tools will still show a source. A lead sent anywhere else — an email ` +
          `notification, a webhook, a different CRM — arrives with nothing attached.`,
        findings,
        fix: [
          `Only needed if leads go somewhere those tools don't reach: add hidden fields ` +
          `named ${UTM_FIELDS} and have the page fill them from the page address.`,
        ],
      };
    }

    return {
      tone: "error",
      headline: "Nothing is recording where these leads come from",
      meaning:
        "The form has nowhere to store the campaign, and no ad or analytics tool is " +
        "tracking the visit either — so every lead looks the same whatever produced it.",
      findings,
      fix: [`Add hidden fields named ${UTM_FIELDS} and have the page fill them from the page address.`],
    };
  }

  // Case 2 — the boxes exist, and they arrive empty. The nastiest one.
  if (capturedCheck?.status === "FAIL" || (saysEmpty && fieldsCheck?.status === "FAIL")) {
    findings.push("The form has the right boxes, but they arrived empty.");
    if (inBrowser) {
      findings.push("The campaign details did reach the browser, so the information is available — " +
        "it simply isn't reaching the form.");
    }
    return {
      tone: "error",
      headline: "The campaign details aren't reaching the form",
      meaning:
        "This page is set up to record where visitors come from, but the boxes were still empty " +
        "when we looked. Leads will arrive looking complete while the campaign information is " +
        "silently missing.",
      findings,
      fix: [
        "Check whatever fills those fields — a script or a builder setting — is still running.",
        "This usually breaks after a redesign or a plugin update, and nothing visibly changes.",
      ],
    };
  }

  // Case 3 — works, but only after a delay.
  if (timing?.status === "WARN") {
    findings.push("The details were not there the instant the page loaded, but arrived shortly after.");
    return {
      tone: "warning",
      headline: "Campaign details arrive, but a little late",
      meaning:
        "The form does record where visitors come from, but the values land a few seconds after " +
        "the page opens. Anyone who fills the form very quickly could submit before they arrive.",
      findings,
      fix: ["Ask whoever built the page to set these values as early as possible, ideally before " +
            "the form becomes usable."],
    };
  }

  // Case 4 — working.
  if (fieldsCheck?.status === "WARN") {
    // Two engines, two wordings: "missing: x, y" and "not present: x, y".
    const missing = /(?:missing|not present):\s*([a-z_, ]+)/i.exec(fieldsCheck.detail)?.[1]?.trim();
    findings.push("The campaign details were recorded correctly.");
    if (missing) {
      findings.push(`Not recorded: ${missing}. ` +
        (/gclid|fbclid/.test(missing)
          ? "Those two identify the exact ad click for Google and Meta — worth adding if you run paid ads."
          : "Add these only if you use them."));
    }
    return {
      tone: "success",
      headline: "Leads from this page will carry their source",
      meaning: "We arrived as someone from a campaign, and the form recorded it correctly.",
      findings,
      fix: [],
    };
  }

  findings.push("The campaign details were recorded correctly, straight away.");
  return {
    tone: "success",
    headline: "Leads from this page will carry their source",
    meaning: "We arrived as someone from a campaign, and the form recorded every detail correctly.",
    findings,
    fix: [],
  };
}

/** The platform line, without the parenthetical apparatus. */
export function plainPlatform(report: RawReport | null | undefined): string | null {
  const p = report?.platform;
  if (!p || p === "unknown") return null;
  return p;
}
