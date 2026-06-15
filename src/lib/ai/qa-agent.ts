import "server-only";
import { parse } from "node-html-parser";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, QA_MODEL } from "@/lib/ai/anthropic";
import { SEVERITIES, type CheckResult } from "@/lib/constants";

export type ProposedCheck = {
  name: string; // must match a QA_TEMPLATE item name
  result: CheckResult;
  valueDesktop?: string | null;
  note: string;
};

export type SuggestedIssue = { title: string; severity: string };

export type QaProposal = {
  ok: boolean;
  error?: string;
  aiUsed: boolean;
  finalUrl?: string;
  checks: ProposedCheck[];
  issues: SuggestedIssue[];
};

function formatBytes(bytes: number): string {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${Math.round(bytes / 1000)}KB`;
}

function has(html: string, ...needles: string[]): boolean {
  const h = html.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

/** Fetch the page and derive the checks we can verify deterministically. */
async function gatherSignals(url: string): Promise<{
  checks: ProposedCheck[];
  text: string;
  finalUrl: string;
  origin: string;
} | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "ApexureQA/1.0" },
    });
  } catch {
    clearTimeout(timer);
    return { error: "Could not reach the URL. Check it's live and public." };
  }
  clearTimeout(timer);

  const html = await res.text();
  const ms = Date.now() - started;
  const bytes = new TextEncoder().encode(html).length;
  const finalUrl = res.url || url;
  const origin = new URL(finalUrl).origin;
  const root = parse(html);

  root.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  const text = (root.querySelector("body")?.structuredText ?? root.text)
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 6000);

  const meta = (name: string, attr = "name") =>
    root.querySelector(`meta[${attr}="${name}"]`)?.getAttribute("content") ?? "";

  const title = root.querySelector("title")?.text?.trim() ?? "";
  const description = meta("description");
  const ogTitle = meta("og:title", "property") || meta("og:image", "property");
  const favicon = root.querySelector('link[rel~="icon"]');
  const h1 = root.querySelector("h1");
  const year = String(new Date().getFullYear());

  const pass = (cond: boolean): CheckResult => (cond ? "PASSED" : "FAILED");

  const checks: ProposedCheck[] = [
    {
      name: "SSL Certificate showing up correctly",
      result: pass(finalUrl.startsWith("https://") && res.ok),
      note: finalUrl.startsWith("https://") ? "HTTPS served OK." : "Not served over HTTPS.",
    },
    {
      name: "GTMetrix Page Load Time",
      result: "NA",
      valueDesktop: `${(ms / 1000).toFixed(2)}s`,
      note: "Server fetch time (rough).",
    },
    {
      name: "GTMetrix Page Size",
      result: "NA",
      valueDesktop: formatBytes(bytes),
      note: "HTML document size.",
    },
    {
      name: "Favicon Installed",
      result: pass(Boolean(favicon)),
      note: favicon ? "Favicon link found." : "No favicon link tag.",
    },
    {
      name: "SEO Title and description added",
      result: pass(Boolean(title) && Boolean(description)),
      note: `Title: ${title ? "yes" : "no"}, description: ${description ? "yes" : "no"}.`,
    },
    {
      name: "Social Graph Tags installed",
      result: pass(Boolean(ogTitle)),
      note: ogTitle ? "Open Graph tags present." : "No og: tags found.",
    },
    {
      name: "Header Tags",
      result: pass(Boolean(h1)),
      note: h1 ? "H1 present." : "No H1 tag.",
    },
    {
      name: "Google Analytics Installed",
      result: pass(has(html, "googletagmanager.com/gtag", "google-analytics.com", "gtag('config', 'g-")),
      note: "Looked for GA / gtag snippets.",
    },
    {
      name: "Google Adwords Installed",
      result: pass(has(html, "googleadservices.com", "aw-", "google_conversion")),
      note: "Looked for Google Ads conversion tags.",
    },
    {
      name: "Facebook Pixel Installed",
      result: pass(has(html, "connect.facebook.net", "fbq(")),
      note: "Looked for the Meta pixel.",
    },
    {
      name: "Copyright year up to date",
      result: pass(html.includes(year)),
      note: html.includes(year) ? `Found ${year}.` : `No ${year} in markup.`,
    },
  ];

  // Sitemap is a separate request.
  try {
    const sm = await fetch(`${origin}/sitemap.xml`, {
      method: "HEAD",
      signal: AbortSignal.timeout(6000),
    });
    checks.push({
      name: "Add URL to Sitemap",
      result: pass(sm.ok),
      note: sm.ok ? "sitemap.xml reachable." : "No sitemap.xml at root.",
    });
  } catch {
    checks.push({
      name: "Add URL to Sitemap",
      result: "FAILED",
      note: "Could not load sitemap.xml.",
    });
  }

  return { checks, text, finalUrl, origin };
}

const JudgmentSchema = z.object({
  checks: z.array(
    z.object({
      name: z.string(),
      result: z.enum(["PASSED", "FAILED", "NA"]),
      note: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(SEVERITIES),
    }),
  ),
});

/** Claude reviews the page text for the judgment-based checklist items. */
async function runJudgment(
  text: string,
  url: string,
): Promise<{ checks: ProposedCheck[]; issues: SuggestedIssue[] } | null> {
  const client = getAnthropic();
  if (!client) return null;

  const system = `You are a meticulous QA reviewer for a web agency (Apexure). You review live landing pages and websites against a checklist and flag issues by severity.

Severity definitions:
- CRITICAL_HIGH: broken cross-browser/responsive behaviour, broken buttons, wrong ad scripts, severe load problems.
- MEDIUM: form validation/handling, missing thank-you page, incorrect heading tags, broken navigation links, lead notifications not set up.
- LOW: spacing/alignment, inconsistent font size, image quality, spelling, missing hover states, missing meta tags.
- REPETITIVE: recurring basics — no favicon, no meta title/description, stale stats, leftover test data.

Assess ONLY these checklist items from the visible page text and return a result (PASSED/FAILED/NA) and a one-line note for each:
- "Spell Checked"
- "All CTA buttons work"
- "Privacy Page Added"
- "SEO Title and description added"

Also return a short list of concrete issues you notice (spelling/grammar mistakes, missing privacy/contact links, placeholder/dummy copy, inconsistent copy). Keep titles concise and specific. Return an empty array if the page looks clean.`;

  try {
    const res = await client.messages.parse({
      model: QA_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(JudgmentSchema) },
      system,
      messages: [
        {
          role: "user",
          content: `URL: ${url}\n\nVisible page text:\n"""\n${text}\n"""`,
        },
      ],
    });
    const out = res.parsed_output;
    if (!out) return null;
    return {
      checks: out.checks.map((c) => ({ ...c, result: c.result as CheckResult })),
      issues: out.issues,
    };
  } catch {
    return null;
  }
}

export async function runQaAgent(url: string): Promise<QaProposal> {
  const signals = await gatherSignals(url);
  if ("error" in signals) {
    return { ok: false, error: signals.error, aiUsed: false, checks: [], issues: [] };
  }

  const judgment = await runJudgment(signals.text, signals.finalUrl);

  // Deterministic checks win; Claude fills the judgment-only items.
  const byName = new Map<string, ProposedCheck>();
  for (const c of signals.checks) byName.set(c.name, c);
  if (judgment) {
    for (const c of judgment.checks) {
      if (!byName.has(c.name)) byName.set(c.name, c);
    }
  }

  return {
    ok: true,
    aiUsed: Boolean(judgment),
    finalUrl: signals.finalUrl,
    checks: [...byName.values()],
    issues: judgment?.issues ?? [],
  };
}
