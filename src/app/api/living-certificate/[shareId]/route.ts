import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { livingCertificateFlagOn } from "@/lib/living-certificate/flag";
import { buildStory } from "@/lib/living-certificate/story-shape";
import { buildVerification } from "@/lib/living-certificate/verification-shape";
import { buildLiveHealth, siteHealthFrom } from "@/lib/living-certificate/health-shape";
import { getPageStatusReadOnly } from "@/lib/linkspy/status-readonly";

// LIVING CERTIFICATE — the composing endpoint. Dashboard → shell.
//
// The shell renders /live/{shareId} and holds NO service keys (all three repos
// are public), so composition happens here, where the token and the LinkSpy keys
// already live. The shell makes exactly one call: this one.
//
// ═══ AUTH IS THE TOKEN ITSELF ═══
// No session, no bearer key, no HMAC. `Page.shareId` is the capability, exactly
// as /c/{shareId} already treats it, so revocation is inherited: null the column
// and both surfaces die at once. There is no second token to remember to revoke.
//
// ═══ READ-ONLY ═══
// One findUnique, nothing else. Invariant 3 — this path must never write to any
// existing table. In particular it must NOT call getPageStatus(), which upserts
// LinkSpyStatus; an anonymous visitor must not be able to trigger a DB write.
//
// ═══ UNIFORM 404 ═══
// Flag off, unknown token, and not-enabled all answer identically, so the
// response never reveals which of the three was the case — a probe cannot use it
// to confirm that a given shareId exists.

export const dynamic = "force-dynamic";

// Client-facing and token-keyed: `private` keeps it out of any shared cache.
const CACHE_CONTROL = "private, max-age=60";

const NOT_FOUND = { error: "not_found" } as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  if (!livingCertificateFlagOn()) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const { shareId } = await params;
  if (!shareId) return NextResponse.json(NOT_FOUND, { status: 404 });

  let page;
  try {
    page = await db.page.findUnique({
      where: { shareId },
      select: {
        // `id` is the `qa_page_ref` LinkSpy's status endpoint is keyed on.
        id: true,
        name: true,
        livingCertificateEnabled: true,
        // Addressing keys for LinkSpy. `registrySiteId` gates Section 1 — no
        // site annotation means no live status to ask about.
        // `registryDeliverableId` is Section 2's key and is still unused.
        registrySiteId: true,
        registryDeliverableId: true,
        project: {
          select: {
            // The client's NAME only. `registryClientId` is deliberately not
            // selected: it is the address of the client-level presence feed,
            // which aggregates every site the client owns. A page-level share
            // token must not be able to reach that, so the key never enters
            // this path at all (F11).
            client: { select: { name: true } },
          },
        },
        certificate: {
          select: {
            completedAt: true,
            // Section 3. Only the verdict per item — never the item name, so a
            // client sees counts and not our internal checklist vocabulary.
            items: { select: { result: true } },
          },
        },
        // Section 3's freshness. `fetchedAt` ONLY — never `payload`, which is
        // LinkSpy's raw internal status. Reading this row is a read; the write
        // that maintains it belongs to the internal page, not to this path.
        linkspyStatus: { select: { fetchedAt: true } },
      },
    });
  } catch (e) {
    // The real error stays server-side; the caller sees an opaque code.
    console.error("[living-certificate] query failed", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  // Unknown token, or opted out → indistinguishable from the flag being off.
  if (!page || !page.livingCertificateEnabled) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  // One clock read, shared by every section, so the payload is internally
  // consistent — `as_of` and the day count can never disagree.
  const now = new Date();

  // ═══ SECTION 1 — PAGE-SCOPED ONLY (F11) ═══
  // Sourced from this page's own site via qa-bridge/status. The client-level
  // presence feed is NOT used and must never be: it aggregates every site the
  // client owns, and a page-level share token must not reveal an estate.
  //
  // Read-only (F3): getPageStatusReadOnly persists nothing. Unreachable LinkSpy
  // degrades to last-known-good, then to null — it never throws and never 500s.
  const served = page.registrySiteId ? await getPageStatusReadOnly(page.id) : null;
  const liveHealth = buildLiveHealth(served?.payload, {
    stale: served?.stale,
    asOf: served?.asOf ?? null,
  });

  const story = buildStory(
    {
      pageName: page.name,
      clientName: page.project.client.name,
      signedOffAt: page.certificate?.completedAt ?? null,
    },
    now,
    {
      // Derived from the same chips as the strip, so the header and the strip
      // can never disagree.
      siteHealth: siteHealthFrom(liveHealth),
      // ⚠ NO PAGE-SCOPED SOURCE EXISTS for these two. qa-bridge/status returns
      // verdicts, not a numeric uptime or an incident count — the uptime check's
      // figure lives inside a human sentence ("Reachable · 99.4% uptime"). The
      // only structured source was the client-level presence feed, which F11
      // rules out. They stay null and their clauses stay absent until LinkSpy
      // exposes a per-site figure. Null is not zero.
      siteUptimePct: null,
      siteIncidentsHandled: null,
    },
  );

  // null when nothing has been graded — see verification-shape.ts. The renderer
  // hides the section rather than claiming "0 checks holding".
  const verification = buildVerification(
    {
      items: page.certificate?.items ?? [],
      lastCheckedAt: page.linkspyStatus?.fetchedAt ?? null,
    },
    now,
  );

  return NextResponse.json(
    {
      as_of: now.toISOString(),
      story,
      verification, //  Section 3
      live_health: liveHealth, // Section 1 — derived chip states only, never the
      //                           raw LinkSpy payload (F10)
      // Present-and-null means "this section has no data yet"; the renderer
      // hides it. Filling it later is additive and never reshapes the response.
      timeline: null, // Section 2 — blocked on the LinkSpy endpoint merge
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
