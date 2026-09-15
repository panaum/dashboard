# ADR-003 — devicepreview stops at the honest label; no macOS capture routing

**Status:** accepted — **first reopening condition met 2026-09-15; decision under review** (see Update)
**Date:** 2026-09-15
**Related:** `services/devicepreview/LIMITATIONS.md`, PRs #106 #107 #110,
`.github/workflows/q3-webkit-linux-vs-macos.yml`

---

## Context

The device frames in the Dashboard are per-handset silhouettes — a Dynamic
Island for the iPhone 16 family, a punch-hole for a Galaxy. The captures inside
them come from a Linux container, where WebKit cannot draw Apple's system face.

An accurate bezel around a substituted-font capture is worse than a generic
rectangle around the same pixels: the frame lends the capture credibility it
has not earned. The governing rule is therefore **the frame may never claim
more than the capture delivers.**

The proposal was to route Apple profiles to a macOS host so the pixels match
the frame. Two questions had to be answered with evidence first: *does it
actually look different*, and *does it matter for the work we do*.

## What we measured

**It looks different, on a page that asks for an Apple font stack.** Same
fixture, same code, WebKit both sides, iPhone 16:

| | differing pixels | strong | page height |
|---|---|---|---|
| Apple stack (fixture) | **14.25%** | 12.53% | identical |
| No Apple stack (wbiwarm.com) | 2.30% | 1.28% | identical |

And it is not only rasterisation. Measuring text bands rather than eyeballing
them: the top third aligns within a pixel or two, then **every remaining band
is displaced by ~24 CSS px — one whole line — and at one point by 56.** Line
ends on body copy run ~10 CSS px further on the substituted face; headings
break at different words.

**Identical page height is not evidence of stable layout.** It came out equal
because two effects cancelled, and Linux produced one more text band than
macOS. Anyone citing the height figure without this sentence will draw the
wrong conclusion from it.

**It does not matter for the work we do.** 29 pages — every page the Dashboard
monitors plus every client page reachable from those domains — read the way the
tool reads them, by computed `font-family` on the elements it samples:

| the page asks for | pages |
|---|---|
| `-apple-system` and friends | **0 of 29** |
| `system-ui`, behind a webfont | 8 of 29 |
| neither | 21 of 29 |

Not one page asks for Apple's system face. The eight naming `system-ui` all
place it second or third, behind a webfont expected to load (`Inter` on
apexure.com, `GeistSans` on the Dashboard itself); it draws only if that
webfont does not.

> **Superseded by the portfolio census in the Update below.** This sample was
> not the portfolio: it included breezioac.com and the Dashboard, which the
> Sites page does not monitor, and it missed four properties that it does. It
> was also counted by a script that judged `body` alone, counted a redirected
> page twice, and would have measured a bot wall as the page.

## Decision

1. **Do not build macOS capture routing.** The difference is real and the
   fixture proves it, but the exposure on current client work rounds to zero,
   and the cost is an asynchronous second capture path.
2. **Keep the honest label instead**, which is already shipped: the frame names
   the machine that rendered the capture, and font authenticity is *measured in
   the page* rather than declared by whichever backend ran (#106, #107).
3. **Record `system-ui` as provenance, not as a finding** (#110). It is the
   same platform-dependent face under a standards name, but it is not a page
   defect, it cannot be judged, and on real pages it never draws.

## Why `system-ui` gets no verdict

`-apple-system` can be judged: on Linux it falls back to the default face, so
it measures identically to a family that cannot exist, and that is what
"substituted" means. `system-ui` cannot: it resolves to *something* on every
platform, so the same test cannot tell SF Pro from whatever fontconfig picked.
The obvious reference — `"SF Pro Text"` by name — is **not addressable on
macOS**; measured there it is identical to the impossible-family control, so
there is nothing to compare against. Reporting the dependency is honest;
reporting a verdict would be a guess.

## What would reopen this

- A client site whose body text sets `-apple-system` or `system-ui` **first**,
  ahead of any webfont. **Met on 2026-09-15 by dev.apexure.org/LisaMarie.** Re-run the census: `services/devicepreview/scripts/font-stack-census.py`.
- The census sample being materially incomplete. It covered the Layout checks
  list plus crawled client domains; the LinkSpy portfolio could not be read
  (`LINKSPY_API_URL` / `LINKSPY_API_KEY` are absent from the local env). If that
  portfolio is much larger, re-run before relying on the figure.
- Someone wanting real-device pixels rather than authentic fonts, which is a
  different question with a different answer (BrowserStack, declined on cost —
  see LIMITATIONS.md).

## Consequences

- `--backend macos` remains available from the CLI and unused by the service.
- The Q3 workflow is throwaway and may be deleted; this ADR carries its numbers.
- Nobody needs to re-derive this. The measurement is reproducible: the fixture
  is `services/devicepreview/fixtures/apple-font-page.html`.

## Update — 2026-09-15: the portfolio census

The Sites page was read directly for the monitored properties: apexure.com,
dev.apexure.org/LisaMarie, shopping-protection.com, fautons.com, wbiwarm.com
and elitepractice.clickfunnels.com. **Six were named; the page reports eight.
Two are unidentified and not in this count.**

Each was crawled 14 links deep inside its own path, and every sampled element
(`body h1 h2 h3 p a button`) judged on its own `font-family` stack:

| property | pages | name a platform face | **exposed** |
|---|---|---|---|
| apexure.com | 15 | 15 | 0 |
| fautons.com | 15 | 15 | 0 |
| wbiwarm.com | 15 | 0 | 0 |
| shopping-protection.com | 10 | 0 | 0 |
| **dev.apexure.org/LisaMarie** | 4 | 4 | **4** |
| elitepractice.clickfunnels.com | — | — | *unmeasurable* |
| **total** | **59** | **34** | **4** |

**One property in six is exposed, and only partly.** On LisaMarie the body
text, links and button labels lead with `-apple-system`; the headings and
paragraphs are set in Poppins, a webfont. So the substituted face shows in the
navigation, the buttons and any text sitting directly in the body — not in the
display type. It still matters: a button sized to its label changes width when
the face does, which is the fixture's measured failure in miniature.

apexure.com and fautons.com name a platform face on every page, but only behind
a webfont (`Inter, system-ui, sans-serif`; `Goga, Verdana, system-ui,
sans-serif`) — zero exposed even judged element by element.

elitepractice.clickfunnels.com serves Cloudflare's "Sorry, you have been
blocked" page to a headless browser, so no automated census can see it. Its own
stylesheet sets `-apple-system` on every heading; measured naively it would have
counted as exposed.

**What the honest label already does for the exposed property.** devicepreview
detects the request there (`appleSystemFontRequested=True`), so every Linux
capture of LisaMarie carries *"Linux capture — Apple fonts substituted"* on its
frame. The mitigation this ADR chose is working on exactly the case that
reopened it.

**What is open.** Whether one partly exposed property justifies a macOS capture
path, or whether the label plus an on-demand authentic capture for that site
(the Q3 workflow takes a URL and runs WebKit on a free macOS runner) is enough.
That is a decision for the team, not a conclusion of this update. Until it is taken, the decision stands as recorded.

