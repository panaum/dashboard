// Pure shaping for the findings rail: one short line per finding, worst
// first, capped at five. The audit's messages are full sentences written
// for a report; the rail needs four or five words and the selector beneath.
// Numbers are taken from the message templates devicepreview emits (tested
// against real examples), never re-measured here.

export type Box = { x: number; y: number; width: number; height: number };

export type RawFinding = {
  severity: string;
  rule: string;
  message: string;
  selector?: string | null;
  box?: Box | null;
  scope?: string;
};

export type RailFinding = {
  id: string;
  severity: "error" | "warn" | "info";
  rule: string;
  label: string;
  /** The tool's own sentence, with the numbers. The label is the short form. */
  message?: string;
  selector: string | null;
  box: Box | null;
  /** About the whole page (viewport meta, layout shift, fonts): nothing to draw. */
  pageLevel: boolean;
};

export const RAIL_CAP = 5;

const num = (m: RegExpMatchArray | null, i = 1) => (m ? m[i] : null);

export function shortLabel(f: RawFinding): string {
  const m = f.message;
  // "12 more small tap target(s) not listed — 6 under the 24px AA minimum, …":
  // the count is the label; the breakdown stays in the full message.
  const more = m.match(/^(\d+) more .*? not listed/);
  if (more) return `${more[1]} more not listed`;
  switch (f.rule) {
    case "overflow": {
      const doc = num(m.match(/scrolls sideways by (\d+)px/));
      if (doc) return `Horizontal overflow — ${doc}px`;
      const el = num(m.match(/extends (\d+)px past the viewport/));
      return el ? `Extends ${el}px past viewport` : "Horizontal overflow";
    }
    case "element-wider": {
      const n = num(m.match(/(\d+)px past the right edge/));
      return n ? `Cut off at edge — ${n}px` : "Cut off at the edge";
    }
    case "tap-small": {
      const d = m.match(/is (\d+)×(\d+)px/);
      return d ? `Tap target ${d[1]} × ${d[2]}` : "Small tap target";
    }
    case "tap-close": {
      if (/are touching/.test(m)) return "Tap targets touching";
      const g = num(m.match(/are ([\d.]+)px apart/));
      return g ? `Tap targets ${g}px apart` : "Tap targets too close";
    }
    case "clipped-text": {
      const below = num(m.match(/hides (\d+)px of text below/));
      if (below) return `Text clipped — ${below}px hidden`;
      const right = num(m.match(/hides (\d+)px of text past/));
      return right ? `Text clipped — ${right}px past edge` : "Text clipped";
    }
    case "text-small": {
      const s = num(m.match(/set at ([\d.]+)px/));
      return s ? `Text ${s}px on a phone` : "Text too small";
    }
    case "fixed-chrome": {
      const p = num(m.match(/take (\d+)% of the viewport/));
      return p ? `Fixed bars take ${p}% of screen` : "Fixed bars too tall";
    }
    case "viewport-meta":
      return /No <meta/.test(m) ? "No viewport meta" : "Zoom blocked by viewport meta";
    case "offscreen":
      return "Content parked off screen";
    case "image-size": {
      const s = m.match(/served at (\d+)px for a (\d+)px slot/);
      if (/look soft/.test(m)) return s ? `Soft image — ${s[1]}px for ${s[2]}px` : "Image will look soft";
      return s ? `Oversized image — ${s[1]}px for ${s[2]}px` : "Oversized image";
    }
    case "cls": {
      const v = num(m.match(/layout shift ([\d.]+)/i));
      return v ? `Layout shift ${v}` : "Layout shift";
    }
    case "webfont": {
      if (/Apple's system font/.test(m)) return "Apple system font substituted";
      const failed = num(m.match(/^Webfont failed to load: (\S+)/));
      if (failed) return `Webfont failed — ${failed}`;
      if (/^Declared webfont source/.test(m)) return "Dead webfont source";
      const fam = num(m.match(/^(.+?) (was skipped|is not being drawn|is used by the page)/));
      if (fam && /skipped/.test(m)) return `Webfont skipped — ${fam}`;
      if (fam && /never loaded/.test(m)) return `Webfont never loaded — ${fam}`;
      return fam ? `Webfont not drawn — ${fam}` : "Webfont problem";
    }
    default: {
      const words = m.split(/\s+/).slice(0, 4).join(" ");
      return `${f.rule.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())}: ${words}`;
    }
  }
}

const RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };

/** Worst first; within a severity, top of the page first; page-level last. */
export function railItems(findings: RawFinding[]): RailFinding[] {
  return findings
    .map((f, i) => ({
      id: `${i}`,
      severity: (f.severity === "error" || f.severity === "warn" ? f.severity : "info") as RailFinding["severity"],
      rule: f.rule,
      label: shortLabel(f),
      message: f.message,
      selector: f.scope === "page" ? null : (f.selector ?? null),
      box: f.scope === "page" ? null : (f.box && f.box.width > 0 && f.box.height > 0 ? f.box : null),
      pageLevel: f.scope === "page",
      _i: i,
    }))
    .sort((a, b) =>
      (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9)
      || Number(a.pageLevel) - Number(b.pageLevel)
      || (a.box?.y ?? Infinity) - (b.box?.y ?? Infinity)
      || a._i - b._i)
    .map(({ id, severity, rule, label, message, selector, box, pageLevel }) =>
      ({ id, severity, rule, label, message, selector, box, pageLevel }));
}

/** The five worst, or all of them once expanded, plus how many are folded
 *  away. A selected row is always shown: a link, a pin or a map mark can name
 *  a finding past the cap, and selecting a row nobody can see is worse than
 *  showing one extra. It keeps its place in the order rather than jumping to
 *  the top, so the numbering still reads down the list. */
export function railSlice<T>(
  items: T[], expanded: boolean, cap = RAIL_CAP, selected = -1,
): { shown: T[]; hidden: number } {
  if (expanded || items.length <= cap) return { shown: items, hidden: 0 };
  if (selected < cap || selected >= items.length) return { shown: items.slice(0, cap), hidden: items.length - cap };
  return { shown: [...items.slice(0, cap), items[selected]], hidden: items.length - cap - 1 };
}
