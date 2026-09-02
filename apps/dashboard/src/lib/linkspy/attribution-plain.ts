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

function check(report: RawReport, name: string): RawCheck | undefined {
  return (report.checks ?? []).find((c) => c.name === name);
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

  const findings: string[] = [];
  if (forms || embedded) {
    const parts: string[] = [];
    if (forms) parts.push(`${forms} form${forms === 1 ? "" : "s"} on the page`);
    if (embedded) parts.push(`${embedded} inside an embedded widget`);
    findings.push(`We found ${parts.join(", and ")}.`);
  }

  // Case 1 — nothing on the page can hold the campaign information.
  if (fieldsCheck?.status === "FAIL") {
    findings.push("None of them has anywhere to record which campaign the visitor came from.");
    if (trackers.length) {
      findings.push(
        `${trackers.join(", ")} did tag the visit, so your reports will still show the traffic — ` +
        "but the lead itself arrives with nothing attached.");
    }
    if (inBrowser) {
      findings.push(
        "The campaign details did reach the browser and were stored there, so the information " +
        "exists — it just never gets attached to the lead. Some setups attach it at the moment " +
        "of submitting, which we can't confirm without actually submitting the form.");
    }
    return {
      tone: "error",
      headline: "Leads from this page won't say where they came from",
      meaning:
        "We visited as someone arriving from an ad. When a visitor fills in this form, the " +
        "campaign that brought them is not saved with their details — so every lead looks the " +
        "same no matter which ad, email or post produced it.",
      findings,
      fix: [
        `Add hidden fields to the form named ${UTM_FIELDS}.`,
        "Have the page copy those values out of the page address when it loads.",
        inBrowser
          ? "If your form tool already stores them (we found them saved in the browser), it may " +
            "just need connecting to these fields."
          : "Most page builders have a setting for this — it is usually called hidden fields or " +
            "URL parameters.",
      ],
    };
  }

  // Case 2 — the boxes exist, and they arrive empty. The nastiest one.
  if (capturedCheck?.status === "FAIL") {
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
    const missing = /missing:\s*([a-z_, ]+)/i.exec(fieldsCheck.detail)?.[1]?.trim();
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
