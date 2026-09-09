// WHAT A FINDING ACTUALLY MEANS.
//
// The tools write a measurement: "a:nth-of-type(1) is 101×15px". That is the
// evidence, and it is exact, but it does not tell you whether to care. This is
// the missing half — what was looked at, what it does to someone visiting the
// page, and what usually fixes it — written for whoever opens the report,
// including the client.
//
// One entry per rule the tools can emit. The tests read the rule list straight
// out of services/devicepreview/devicepreview.py, so a rule added there without
// an explanation here fails the suite rather than shipping a bare number.

export type Explanation = {
  /** What the check looked at. */
  what: string;
  /** What it does to a visitor. This is the part that decides whether to act. */
  why: string;
  /** The usual cause and the usual fix. Left out where there is no single one. */
  fix?: string;
};

/** The fourteen-device matrix (services/devicepreview). Keyed by rule. */
export const DEVICE_RULES: Record<string, Explanation> = {
  overflow: {
    what: "The whole page can be scrolled sideways at this size.",
    why: "A visitor swipes and finds a strip of empty page, or loses the end of a headline off the edge. On a phone it is the most visible layout fault there is.",
    fix: "One element is wider than the screen and the finding names it — usually a fixed pixel width, a wide table, or an image with no max-width.",
  },
  "element-wider": {
    what: "One element is wider than the screen, but the page itself does not scroll, so the part sticking out is simply cut off.",
    why: "Whatever is in that strip cannot be seen or reached at this size — and unlike sideways scrolling, nothing hints that it is missing.",
    fix: "Usually a fixed width or a wide image inside a container that hides its overflow.",
  },
  "tap-small": {
    what: "Something you tap is smaller than the 24-pixel minimum in the accessibility standard (WCAG 2.5.8).",
    why: "A fingertip is about 8mm across and covers what it presses. Small targets get missed, or the one next to it gets hit instead.",
    fix: "Padding on the link, or a minimum height on the row — the visible text can stay exactly as it is. Links inside a sentence are exempt and are reported as notes, not failures.",
  },
  "tap-close": {
    what: "Two things you can tap sit closer than 8 pixels apart, and at least one of them is small.",
    why: "When a target is small, the gap around it is what stops a near miss from becoming the wrong tap.",
    fix: "A few pixels of margin between them, or make the smaller one bigger.",
  },
  "clipped-text": {
    what: "Text is cut off by a box that hides whatever overflows it.",
    why: "The visitor sees half a sentence or a chopped heading. It often hits headlines that fit fine on a desktop and not at this width.",
    fix: "Let the box grow, or shorten the text at this breakpoint. Some clipping is deliberate, so compare with the screenshot before reporting it.",
  },
  "text-small": {
    what: "Body text is set under 12 pixels on a phone.",
    why: "It is hard to read at arm's length, so people zoom in — and once zoomed, they have to scroll sideways to read every line.",
    fix: "Raise the size at the mobile breakpoint. Captions, disclaimers and footer legal lines are the usual offenders.",
  },
  "fixed-chrome": {
    what: "Bars pinned to the top and bottom take up more than a quarter of the screen.",
    why: "A sticky header, a cookie bar and a promo strip together can leave a phone visitor reading the page through a letterbox.",
    fix: "Let one of them scroll away, or make them shorter on small screens.",
  },
  "viewport-meta": {
    what: "The page either has no viewport tag at all, or has one that blocks zooming.",
    why: "Without the tag a phone lays the page out at desktop width and shrinks the result, so everything is tiny. Blocking zoom removes the one thing a visitor with low vision can do about it, and fails WCAG 1.4.4.",
    fix: "The standard width=device-width, initial-scale=1 — with no user-scalable=no and no maximum-scale=1.",
  },
  webfont: {
    what: "A font the page asked for did not render, so the visitor saw the fallback instead.",
    why: "The page appears in a typeface it was not designed in: line lengths change, headings reflow, and the brand look is gone for that visit.",
    fix: "Check the font file loads at all. A face declared font-display: optional is allowed to be skipped on a slow load — that is the site's own setting working as intended, not a broken file, and it will not happen on every run.",
  },
  offscreen: {
    what: "An element sits entirely outside the screen and is not marked as hidden.",
    why: "Usually harmless — a menu or a carousel slide parked to one side. Occasionally it is real content that has been pushed out of view rather than hidden.",
    fix: "Nothing, if it is deliberate. If it is content, note that it is only positioned away, so screen readers still announce it.",
  },
  "image-size": {
    what: "The image file is either smaller than the space it fills on this screen's pixel density, or far larger than it needs to be.",
    why: "Too small looks soft on a phone, which reads as a cheap page. Too large spends the visitor's data and slows the load for nothing they can see.",
    fix: "Export at roughly two to three times the slot width for phones, and no more than that.",
  },
  cls: {
    what: "How much the page moved under the reader while it loaded — Cumulative Layout Shift, one of Google's Core Web Vitals.",
    why: "Movement means losing your place mid-sentence, or tapping a button that slides away. Good is 0.1 or under; above 0.25 is poor and counts against the page in search.",
    fix: "Usually images with no width and height, ads or embeds with no space reserved, or a font swapping to a different size. Only Chromium can measure it, so the iPhone, iPad and Firefox profiles report nothing rather than a fake zero.",
  },
};

/** The eight-width sweep (services/linkspy-api). Keyed by finding id. */
export const VIEWPORT_FINDINGS: Record<string, Explanation> = {
  overflow: DEVICE_RULES.overflow,
  edge: {
    what: "Something runs past the edge of the screen and is clipped there.",
    why: "Part of an image or a block of text is unreachable at these widths.",
    fix: "Some bleed is deliberate — a background running to the edge is fine, a button with its label cut in half is not. Check the screenshot.",
  },
  clipped: DEVICE_RULES["clipped-text"],
  overlap: {
    what: "Two elements sit on top of each other, and at least one of them carries text.",
    why: "Text over text is unreadable where they collide. It usually means one box grew taller than the room left for it at this width.",
    fix: "Confirm against the screenshot: a decorative overlap is fine, and this check cannot tell the two apart.",
  },
  cta: {
    what: "Where the main call to action sits at each width, and whether it is visible without scrolling.",
    why: "Not a fault — a measurement. On a landing page whose job is one action, a button that only appears after two screens of scrolling is worth knowing about.",
  },
  blocked: {
    what: "A bot challenge was served instead of the page at some widths.",
    why: "Those widths measured the challenge screen, not your page, so nothing they report describes the real site.",
    fix: "Re-run, more slowly, before trusting anything from those widths.",
  },
  "responsive-load": {
    what: "Some widths could not be measured at all.",
    why: "The page did not load in time, so there is no verdict for them. That is an absence of evidence, not a pass.",
  },
  redirect: {
    what: "The URL you asked for ended up somewhere else.",
    why: "Every other finding on this run describes the page it landed on, not the one you asked for.",
  },
  shots: {
    what: "The screenshots this run captured and stored.",
    why: "Not a problem. It is the list of what was kept, which is the deliverable the client sees.",
  },
};

export function explain(kind: "device" | "viewport", id: string): Explanation | null {
  const table = kind === "device" ? DEVICE_RULES : VIEWPORT_FINDINGS;
  return table[id] ?? null;
}
