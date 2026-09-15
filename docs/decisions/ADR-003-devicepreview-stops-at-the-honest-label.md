# ADR-003 — devicepreview stops at the honest label; no macOS capture routing

**Status:** accepted. Reopened on 2026-09-15 when the portfolio census found an
exposed property; reviewed the same day, and **confirmed**.
**Date:** 2026-09-15
**Related:** `services/devicepreview/LIMITATIONS.md`; PRs #106, #107, #110, #112,
#115; `.github/workflows/q3-webkit-linux-vs-macos.yml`

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

### It looks different, on a page that asks for an Apple font stack

Same fixture, same code, WebKit on both platforms, iPhone 16:

| | differing pixels | strong | page height |
|---|---|---|---|
| Apple stack (fixture) | **14.25%** | 12.53% | identical |
| No Apple stack (wbiwarm.com) | 2.30% | 1.28% | identical |

It is not only rasterisation. Measuring text bands rather than eyeballing them,
the top third aligns within a pixel or two, then **every remaining band is
displaced by ~24 CSS px — one whole line — and at one point by 56.** Line ends
on body copy run ~10 CSS px further on the substituted face; headings break at
different words.

**Identical page height is not evidence of stable layout.** It came out equal
because two effects cancelled, and Linux produced one more text band than
macOS. Anyone citing the height figure without this sentence will draw the
wrong conclusion from it.

### Where it applies: the portfolio

The monitored properties were read from the Dashboard's Sites page, each
crawled 14 links deep inside its own path, with every sampled element
(`body h1 h2 h3 p a button`) judged on its own `font-family` stack. A page is
**exposed** when some element's stack puts the platform face *first*, so its
typography follows the machine that captured it.

| property | pages | name a platform face | **exposed** |
|---|---|---|---|
| apexure.com | 15 | 15 | 0 |
| fautons.com | 15 | 15 | 0 |
| wbiwarm.com | 15 | 0 | 0 |
| shopping-protection.com | 10 | 0 | 0 |
| **dev.apexure.org/LisaMarie** | 4 | 4 | **4** |
| elitepractice.clickfunnels.com | — | — | *unmeasurable* |
| **total** | **59** | **34** | **4** |

- **apexure.com and fautons.com** name `system-ui` on every page, but only
  behind a webfont that loads (`Inter, system-ui, sans-serif`; `Goga, Verdana,
  system-ui, sans-serif`). None exposed, even judged element by element.
- **dev.apexure.org/LisaMarie is exposed, partly.** Body text, links and button
  labels lead with `-apple-system`; headings and paragraphs are set in Poppins,
  a webfont.
- **elitepractice.clickfunnels.com cannot be measured.** Its root and its
  monitored page, `/dr-dania-alkhani`, serve Cloudflare's "you have been
  blocked" page to a headless browser — and that block page's *own* stylesheet
  sets `-apple-system` on its headings, which a naive count would have scored
  as exposed. The monitored page was already a ClickFunnels 404 stub on
  2026-09-09, the last time it could be read. Captures from 5 and 7 September, while it was live, show it
  requested Apple's system font alongside the Inter webfont; whether that face
  led the stack is not recoverable from what was stored. **So it is
  unmeasurable, not clean**: it is counted neither as exposed nor as clean, and
  it is outside the totals below the table.
- **Coverage.** The Sites page lists eight entries: apexure.com twice, and
  dev.apexure.org/LisaMarie twice — its home page and, as "lisa marie contact",
  `/LisaMarie/contact/`. All eight are covered. The contact page is one of
  LisaMarie's four exposed pages, confirmed by measuring it directly as well as
  in the crawl.

The census is reproducible: `services/devicepreview/scripts/font-stack-census.py`.

An earlier sample of 29 pages reported zero exposed. It was not the portfolio —
it included two sites the Sites page does not monitor and missed four it
does — and it was counted by a script that judged `body` alone, counted a
redirected page twice, and would have measured a bot wall as the page. Both
were corrected in #112.

## Decision

1. **Do not build macOS capture routing.**
2. **Keep the honest label.** The frame names the machine that rendered the
   capture, and font authenticity is *measured in the page* rather than
   declared by whichever backend ran (#106, #107).
3. **Record `system-ui` as provenance, not as a finding** (#110, and #115 for
   the spellings engines hand back quoted).
4. **Escalate on demand.** For a page whose text leads with a platform face,
   run `.github/workflows/q3-webkit-linux-vs-macos.yml` ("Apple fonts: macOS vs
   Linux capture") with the page's URL. It captures the page in WebKit on a
   macOS runner and on a Linux one with the container's fonts, and writes the
   difference into the run summary with side-by-side images. It is free on a
   public repo, and its artifacts are kept for 90 days. This replaces routing
   for the pages that need an authentic rendering.

## LisaMarie is exposed, and the decision stands

The census met this ADR's own reopening condition: a monitored site whose text
leads with an Apple system font. It does not change the decision, for four
reasons.

- **It is one property in six, and partly.** The substituted face shows in
  navigation, button labels and loose body text — not in the headings or
  paragraphs, which carry the design. It is a real difference (a button sized
  to its label changes width with the face) but a bounded one.
- **The frame already says so.** devicepreview measures the request there, so
  every Linux capture of LisaMarie is labelled *"Linux capture — Apple fonts
  substituted"*. Nobody reading that capture is misled, which was the whole
  point of the rule.
- **An authentic check exists when it is needed.** When LisaMarie's typography
  has to be signed off — before it leaves `dev.apexure.org`, for instance — run
  the escalation workflow against it. That is a manual step for the one site
  that needs it, at no cost.
- **Routing is a permanent cost for an occasional need.** It means an
  asynchronous second capture path — dispatch, wait, ingest, authenticate —
  maintained for every run, to serve a single partly exposed property.

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

- **Exposure spreading**: a second property exposed, or LisaMarie's headings
  and paragraphs moving onto the platform face.
- **The escalation path becoming routine** — run for most sign-offs rather than
  the occasional one. At that point routing pays for itself.
- **The census proving incomplete**: elitepractice becoming measurable and
  turning out exposed, or a property added to the Sites page.
- **Someone wanting real-device pixels** rather than authentic fonts: a
  different question with a different answer (BrowserStack, declined on cost —
  see LIMITATIONS.md).

## Consequences

- `--backend macos` remains available from the CLI and unused by the service.
- The workflow is kept as the escalation path. It was written as a throwaway
  to produce this ADR's numbers; it is not one any more.
- The measurement is reproducible: the fixture is
  `services/devicepreview/fixtures/apple-font-page.html`, and the census script
  re-counts the portfolio.
