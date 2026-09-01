// CONSENT, IN PLAIN LANGUAGE — turns the raw observation ledger (repeated
// sessions, bare hostnames, millisecond offsets) into something a non-technical
// reader can act on: which outside companies this page contacts, and what each
// kind of company does.
//
// Pure. No I/O, no React.

import type { ConsentRequest, ConsentSession } from "./intent-consent-view";

/** Recognisable names for the third parties we see most. Anything unlisted
 *  falls back to a tidied hostname — never a raw "cdn.x.js" string. */
const KNOWN: Array<[RegExp, string]> = [
  [/facebook|fbcdn/, "Facebook"],
  [/doubleclick|googleads|googlesyndication/, "Google Ads"],
  [/google-analytics|googletagmanager|gtag/, "Google Analytics"],
  [/hs-|hubspot|hsforms|hsadspixel|hubapi/, "HubSpot"],
  [/crazyegg/, "Crazy Egg"],
  [/hotjar/, "Hotjar"],
  [/clarity\.ms/, "Microsoft Clarity"],
  [/linkedin|licdn/, "LinkedIn"],
  [/tiktok/, "TikTok"],
  [/fonts\.googleapis|fonts\.gstatic/, "Google Fonts"],
  [/gstatic|(^|\.)google\.[a-z.]+$/, "Google"],
  [/fonts\.bunny/, "Bunny Fonts"],
  [/jsdelivr|unpkg|cdnjs/, "Code library (CDN)"],
  [/polyfill/, "Browser polyfill service"],
  [/convertbox/, "ConvertBox"],
  [/eocampaign|emailoctopus/, "EmailOctopus"],
  [/leadinfo/, "Leadinfo"],
  [/heapanalytics/, "Heap Analytics"],
  [/ahrefs/, "Ahrefs"],
  [/leadgenapp/, "LeadGen App"],
  [/youtube|ytimg/, "YouTube"],
  [/vimeo/, "Vimeo"],
  [/cloudflare/, "Cloudflare"],
  [/recaptcha|gstatic\.com\/recaptcha/, "Google reCAPTCHA"],
];

export function friendlyName(host: string | null | undefined): string {
  const h = (host ?? "").toLowerCase();
  if (!h) return "Unknown service";
  for (const [re, name] of KNOWN) if (re.test(h)) return name;
  // Fallback: name the registrable domain, not the first label — "scripts.
  // forms.cliqforms.com" is Cliqforms, not "Forms". Walk in from the right,
  // stepping over public-suffix parts like ".com.sg".
  const parts = h.split(".").filter(Boolean);
  const SUFFIXY = new Set(["com", "co", "net", "org", "gov", "edu", "ac", "io", "app", "page", "dev"]);
  let i = parts.length - 2;
  while (i > 0 && SUFFIXY.has(parts[i])) i--;
  const core = (parts[i] ?? parts[0] ?? h).replace(/[-_]/g, " ");
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : h;
}

export type PlainGroupKey = "advertising" | "analytics" | "functional" | "essential" | "other";

export const GROUP_COPY: Record<
  PlainGroupKey,
  { title: string; blurb: string; tone: "error" | "warning" | "neutral" }
> = {
  advertising: {
    title: "Advertising & tracking",
    blurb: "These can follow visitors around the web to show them ads later.",
    tone: "error",
  },
  analytics: {
    title: "Measurement",
    blurb: "These count visits and measure how people use the page.",
    tone: "warning",
  },
  functional: {
    title: "Page features",
    blurb: "Forms, chat and booking tools visitors actually use.",
    tone: "neutral",
  },
  essential: {
    title: "Needed to display the page",
    blurb: "Fonts, code libraries and hosting — the page can't render without them.",
    tone: "neutral",
  },
  other: {
    title: "Other services",
    blurb: "Contacted by the page; we couldn't classify what they do.",
    tone: "neutral",
  },
};

// The collector's vocabulary is wider than these four buckets — it emits
// "advertising-adtech" and "functional" too — so match by prefix rather than
// equality. Getting this wrong once filed Facebook and Google Ads under
// "Other services", which is exactly the wrong answer to give a reader.
function groupKey(cls: string | null | undefined): PlainGroupKey {
  const c = (cls ?? "").toLowerCase();
  if (c.startsWith("advertis") || c.includes("adtech")) return "advertising";
  if (c.startsWith("analytic") || c.startsWith("measure")) return "analytics";
  if (c.startsWith("function")) return "functional";
  if (c.startsWith("essential") || c.startsWith("necessary")) return "essential";
  return "other";
}

export type PlainGroup = { key: PlainGroupKey; companies: string[] };

export type PlainPage = {
  pageUrl: string;
  /** How many observation runs we have for this page. */
  checks: number;
  lastChecked: string | null;
  /** Regimes the page was checked under, e.g. ["US", "UK"]. */
  regimes: string[];
  /** True when a cookie/consent banner was detected on any run. */
  bannerSeen: boolean;
  groups: PlainGroup[];
  /** Distinct companies seen across every run for this page. */
  totalCompanies: number;
  /** Requests the ledger recorded but did not send us (the per-run cap). */
  notShown: number;
};

const ORDER: PlainGroupKey[] = ["advertising", "analytics", "functional", "other", "essential"];

/** Collapse the raw session list into one entry per page, with distinct
 *  companies grouped by what they do. Repeated sessions of the same page are
 *  merged — five near-identical rows told the reader nothing. */
export function plainConsent(sessions: ConsentSession[]): PlainPage[] {
  const pages = new Map<string, {
    checks: number; last: string | null; regimes: Set<string>; banner: boolean;
    byGroup: Map<PlainGroupKey, Set<string>>; seen: number; capped: number;
  }>();

  for (const s of sessions) {
    const url = s.page_url || "(unknown page)";
    const p = pages.get(url) ?? {
      checks: 0, last: null, regimes: new Set<string>(), banner: false,
      byGroup: new Map<PlainGroupKey, Set<string>>(), seen: 0, capped: 0,
    };
    p.checks++;
    if (s.created_at && (!p.last || s.created_at > p.last)) p.last = s.created_at;
    if (s.regime) p.regimes.add(s.regime);
    if (s.cmp && typeof s.cmp === "object" && Object.keys(s.cmp as object).length > 0) p.banner = true;
    if (typeof s.cmp === "string" && s.cmp.trim()) p.banner = true;

    const reqs: ConsentRequest[] = s.requests ?? [];
    for (const r of reqs) {
      const key = groupKey(r.class);
      const set = p.byGroup.get(key) ?? p.byGroup.set(key, new Set()).get(key)!;
      set.add(friendlyName(r.host));
    }
    p.seen += reqs.length;
    pages.set(url, p);
  }

  return [...pages.entries()].map(([pageUrl, p]) => {
    const groups: PlainGroup[] = ORDER.filter((k) => (p.byGroup.get(k)?.size ?? 0) > 0).map((k) => ({
      key: k,
      companies: [...(p.byGroup.get(k) ?? [])].sort(),
    }));
    return {
      pageUrl,
      checks: p.checks,
      lastChecked: p.last,
      regimes: [...p.regimes].sort(),
      bannerSeen: p.banner,
      groups,
      totalCompanies: groups.reduce((n, g) => n + g.companies.length, 0),
      notShown: p.capped,
    };
  });
}

/** Plain-language sentence for the regimes a page was checked under. */
export function regimeSentence(regimes: string[]): string {
  if (!regimes.length) return "";
  const names = regimes.map((r) =>
    r === "US" ? "US privacy rules" : r === "UK" ? "UK/EU privacy rules" : r,
  );
  if (names.length === 1) return `Checked under ${names[0]}.`;
  return `Checked under ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}
