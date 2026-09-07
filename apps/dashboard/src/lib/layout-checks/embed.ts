// Can we show the real page inside the frame, and is it fair to?
//
// A live page in an iframe is the honest answer to "show me the page, not a
// picture of it" — but two things decide whether it is allowed:
//
//  1. The site. X-Frame-Options or a CSP frame-ancestors directive refuses
//     embedding outright, and the browser shows an error where the page
//     should be. Measured: WordPress and custom client sites framed fine;
//     ClickFunnels refuses with X-Frame-Options SAMEORIGIN.
//  2. The client's analytics. A framed page is a real visit and will be
//     counted, so every live preview carries the same QA parameters the
//     eight-width sweep uses (responsive_engine.py TEST_PARAMS), which is
//     what makes those visits identifiable and excludable.

/** Mirrors TEST_PARAMS in services/linkspy-api/responsive_engine.py. */
export const QA_PARAMS: Record<string, string> = {
  utm_source: "qa", utm_medium: "qa", utm_campaign: "qa", utm_term: "qa",
  utm_content: "qa", gclid: "QA_TEST_GCLID", fbclid: "QA_TEST_FBCLID",
};

/** The URL to load in the frame: the page, tagged as QA traffic. */
export function qaUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const [k, v] of Object.entries(QA_PARAMS)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return raw;
  }
}

export type EmbedVerdict = { embeddable: boolean; reason: string };

/**
 * Read a response's framing headers the way a browser would.
 * `origin` is where the Dashboard is served from, since SAMEORIGIN and an
 * explicit frame-ancestors list are both relative to that.
 */
export function embedDecision(
  headers: { xFrameOptions?: string | null; contentSecurityPolicy?: string | null },
  pageUrl: string,
  origin: string,
): EmbedVerdict {
  const csp = (headers.contentSecurityPolicy ?? "").toLowerCase();
  const fa = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-ancestors"));
  if (fa) {
    const list = fa.replace("frame-ancestors", "").trim();
    if (!list || list === "'none'") {
      return { embeddable: false, reason: "The site's security policy refuses to be embedded anywhere." };
    }
    const allowed = list.split(/\s+/).some((src) => {
      if (src === "*") return true;
      if (src === "'self'") return sameHost(pageUrl, origin);
      return hostMatches(src, origin);
    });
    if (!allowed) {
      return { embeddable: false, reason: "The site's security policy only allows embedding on its own domain." };
    }
  }

  const xfo = (headers.xFrameOptions ?? "").trim().toLowerCase();
  if (xfo.startsWith("deny")) {
    return { embeddable: false, reason: "The site sends X-Frame-Options: DENY, so no page may embed it." };
  }
  if (xfo.startsWith("sameorigin") && !sameHost(pageUrl, origin)) {
    return { embeddable: false, reason: "The site sends X-Frame-Options: SAMEORIGIN — it can only be framed by itself." };
  }
  if (xfo.startsWith("allow-from")) {
    const target = xfo.slice("allow-from".length).trim();
    if (target && !hostMatches(target, origin)) {
      return { embeddable: false, reason: "The site only allows one other domain to embed it, and it is not this one." };
    }
  }
  return { embeddable: true, reason: "" };
}

function host(raw: string): string | null {
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function sameHost(a: string, b: string): boolean {
  const ha = host(a), hb = host(b);
  return Boolean(ha && hb && ha === hb);
}

function hostMatches(source: string, origin: string): boolean {
  const clean = source.replace(/^'+|'+$/g, "");
  const ho = host(origin);
  if (!ho) return false;
  if (clean.startsWith("*.")) return ho.endsWith(clean.slice(1).toLowerCase());
  const hs = host(clean);
  return Boolean(hs && hs === ho);
}

/** What the frame says under a live page. It is never a device. */
export const LIVE_CAVEAT =
  "Your browser at this size, not the device — real breakpoints, but desktop rendering and no touch.";
