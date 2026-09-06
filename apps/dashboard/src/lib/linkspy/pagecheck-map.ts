// Pagecheck + responsive sweep → QA checklist prefills. Pure: no I/O, no React,
// no secrets. Safe to import from either side.
//
// Same doctrine as catalog-map.ts, and for the same reason: the mapping is
// deliberately CONSERVATIVE. A checklist row is a claim someone signs off, so
// only findings with an honest 1:1 equivalent are surfaced and everything else
// is ignored rather than approximated. "All CTA buttons work" is NOT mapped from
// the CTA-position finding, for instance — knowing where a button sits says
// nothing about whether it works.
//
// Rows already claimed by ITEM_MAP (SSL, page load, form submits, GA4, pixel,
// broken links) are deliberately left alone so two machine sources never fight
// over one row.

import type { LinkSpyVerdict } from "./catalog-map";

export type Finding = {
  id: string;
  status: "FAIL" | "WARN" | "PASS" | "INFO" | "SKIP";
  title: string;
  detail?: string;
};

/** The two engines report the same data under different keys: the capture run
 *  serialises `checks` with `name`, the sweep serialises `findings` with
 *  `title`. Normalising here keeps that difference out of the component and
 *  under test. Anything without a usable id is dropped rather than guessed. */
export function toFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const status = typeof o.status === "string" ? o.status.toUpperCase() : "";
    if (!id || !["FAIL", "WARN", "PASS", "INFO", "SKIP"].includes(status)) continue;
    out.push({
      id,
      status: status as Finding["status"],
      title: (typeof o.title === "string" && o.title)
        || (typeof o.name === "string" && o.name) || id,
      detail: typeof o.detail === "string" ? o.detail : undefined,
    });
  }
  return out;
}

export type Proposal = {
  itemName: string;
  verdict: LinkSpyVerdict;
  detail: string;
};

/** Findings that together decide whether Chrome renders the page correctly.
 *  The sweep IS Chrome, at eight widths, so it answers the dual Desktop/Mobile
 *  row directly — normally two manual passes. */
const CHROME_RENDER = ["overflow", "edge", "clipped", "overlap"];

/** Ambiguity never becomes a pass. A WARN means "look at the screenshots", and
 *  a checklist row that says PASSED because nobody looked is worse than one
 *  left blank. */
function verdictOf(findings: Finding[]): LinkSpyVerdict {
  if (!findings.length) return "couldnt_verify";
  if (findings.some((f) => f.status === "FAIL")) return "failing";
  if (findings.some((f) => f.status === "WARN" || f.status === "SKIP")) return "couldnt_verify";
  if (findings.every((f) => f.status === "PASS")) return "holding";
  return "couldnt_verify";
}

function summarise(findings: Finding[], fallback: string): string {
  const notable = findings.filter((f) => f.status === "FAIL" || f.status === "WARN");
  if (!notable.length) return fallback;
  return notable.map((f) => `${f.title}: ${f.detail ?? f.status}`).join("; ").slice(0, 400);
}

/** Proposals from a responsive sweep. */
export function proposalsFromSweep(findings: Finding[]): Proposal[] {
  const render = findings.filter((f) => CHROME_RENDER.includes(f.id));
  if (!render.length) return [];
  return [{
    itemName: "Browser Test — Chrome",
    verdict: verdictOf(render),
    detail: summarise(render, "Rendered correctly in Chrome at all eight widths, phone to desktop."),
  }];
}

/** Proposals from a Pagecheck capture run. */
export function proposalsFromPagecheck(findings: Finding[]): Proposal[] {
  const out: Proposal[] = [];
  const by = (id: string) => findings.filter((f) => f.id === id);

  const attribution = by("attribution");
  if (attribution.length) {
    out.push({
      itemName: "Hidden Fields Added",
      verdict: verdictOf(attribution),
      detail: summarise(attribution, "Every campaign parameter reached a hidden field."),
    });
  }

  const placeholder = by("placeholder");
  if (placeholder.length) {
    out.push({
      itemName: "No Dummy Copy / Video / Images",
      verdict: verdictOf(placeholder),
      detail: summarise(placeholder, "No lorem ipsum, TODO or sample contact details on the page."),
    });
  }
  return out;
}

/** Everything a run can propose, keyed by checklist item name — the shape the
 *  page detail already feeds to the checklist. Later sources win on collision,
 *  so callers pass the more specific run last. */
export function byItemName(proposals: Proposal[]): Record<string, Proposal> {
  const out: Record<string, Proposal> = {};
  for (const p of proposals) out[p.itemName] = p;
  return out;
}

/** Every checklist item name this module can propose against. Exported so a
 *  test can assert they all still exist in the template — a rename would
 *  otherwise silently stop proposing, which reads as "nothing to report". */
export const MAPPED_ITEM_NAMES = [
  "Browser Test — Chrome",
  "Hidden Fields Added",
  "No Dummy Copy / Video / Images",
] as const;
