# ADR-004 — A 3D Galaxy S25 on the Devices tab: internal only, and on trial

**Status:** accepted, on trial. **Check on 2026-09-29.**
**Date:** 2026-09-15
**Related:** PRs #119, #120, #123, #124; `apps/dashboard/src/components/layout-checks/handset-3d.tsx`;
`apps/dashboard/src/lib/layout-checks/models-3d.ts` (which handsets have a model);
`services/devicepreview/LIMITATIONS.md` ("The 3D Galaxy S25"); ADR-003

---

## Context

The Devices tab draws each capture inside a flat CSS silhouette of the
handset. For one handset, the Galaxy S25, a 3D model the reader can turn was
wanted — **for feel, not for diagnosis**. The findings are read from the flat
frame: its pins, its scroll ruler, its highlight. The 3D view has none of those
and is not meant to.

A decorative widget on a working page has to earn its place, so it was built
under constraints that make it cheap to leave off and cheap to remove, and it
was accepted on a trial with a condition that takes it out.

## What it costs (measured in a production build)

| | |
|---|---|
| Page's initial JS with 3D **off** | 280 KB gzipped (279 KB before any of this) |
| Fetched only when 3D is **on** | component 4 KB, three.js 197 KB gzipped, model 429 KB |
| Rendering at rest | ~22–30 frames/s of drift while visible; **none** scrolled off screen or with reduced motion (and browsers pause it in a hidden tab) |
| Size on swap-in | ~790 px against the flat frame's 824 px, facing front |

The model is not the file Sketchfab serves: the SAMSUNG wordmark mesh and the
wallpaper were removed and it was simplified from 108,208 to 21,574 triangles
(3.54 MB → 429 KB) by `apps/dashboard/scripts/optimise-handset-model.mjs`.

## Decision

1. **Only devices with a model** (Galaxy S25, iPhone 16), behind a **3D** toggle in the stage bar,
   which appears for those devices alone. **Off by default**; the choice is
   remembered in each browser. The models are listed in `models-3d.ts`; each
   one is a handset whose design belongs to its maker, so every addition is
   another entry under the rule below, not a free one.
2. **The flat frame always comes first.** It renders immediately; the 3D view
   covers it only once the handset is drawn with the capture on its screen. If
   WebGL is missing, the context is lost, or any piece fails to load, the flat
   frame simply stays. While the model covers it, the frame is `inert`, so
   nothing hidden can take keyboard focus.
3. **Motion is small and optional.** Drag to turn, with limits and momentum;
   a few degrees of idle drift; a face-front control. With
   `prefers-reduced-motion`, there is no drift, no momentum and no easing.
4. **Internal only** — see below. That rule is not a setting.

## Internal only, and why

**The rule.** If this tool becomes client-facing in any form — a client login,
a client report or share link that shows the Devices tab, client material
containing a screenshot or recording of it, or a product — the 3D model comes
out first, before anything else about that change ships.

**Why it is the design, not only the name.** Removing the SAMSUNG wordmark did
not make the model a generic phone. What makes it recognisably a Galaxy S25 —
the flat-sided body and its proportions, three separate lenses stacked in the
top-left corner with no camera island, the centred punch-hole — is Samsung's
industrial design, and manufacturers protect that separately from their
trademarks, through registered designs, design patents and trade dress.

The model's CC BY 4.0 licence comes from the person who built the 3D file. It
licenses *their* work and nothing more: the licence says in terms that patent
and trademark rights are not licensed, and it could not grant rights in
Samsung's design, which were never the modeller's to give. Inside the company,
a model of a real handset used as a reference while checking pages is an
ordinary thing to have. In front of clients, or in a product, it would be our
work presenting Samsung's design and implying an association with Samsung that
does not exist. The wordmark was the visible part of that problem; the shape is
the rest of it.

This is the reasoning behind the rule, not legal advice. If the question ever
becomes live, it goes to someone qualified to answer it, and the model is out
of the product while they do.

### The iPhone 16 keeps Apple's logo (2026-09-16)

**What changed.** The Galaxy S25's SAMSUNG wordmark was stripped. The iPhone
16's Apple logo is **not** stripped, and stays on the model we ship. The two
models therefore differ, visibly, and anyone comparing them will notice — this
is why.

**Why.** Three iPhone 16 models were checked against the same gate. Only one
has a real Dynamic Island cut into its screen rather than painted or missing,
and that model's logo fills a logo-shaped hole in the back panel: the back
glass mesh has boundary loops in the outline of the apple and its leaf.
Removing the logo meshes does not leave a clean back — it leaves a **recessed
black Apple logo**, more conspicuous than the tinted one it replaced. Filling
the hole means editing geometry by hand, which would break the rule that
`assets/models/*.glb` can be regenerated from the download by
`scripts/optimise-handset-model.mjs` alone. The alternatives were a model with
no island (a full-bleed screen is not an iPhone 16, and would be less
recognisable than the flat frame it replaces) or recolouring the logo to the
body colour, which leaves its shape in the geometry anyway.

So the wordmark stayed stripped because it was free to strip — a separate mesh
on an unbroken back — and the logo stays because removing it costs more than it
buys. Neither is the point of the rule.

**What does not change.** This is internal tooling, and the rule above stands
exactly as written: if the tool becomes client-facing in any form, the 3D view
comes out entirely — now with one more reason, since one of its models carries
a manufacturer's trademark as well as its design. A stripped wordmark never
made the S25 lawful to show a client; it only made it tidier. The protection
was always "this never leaves the login", and that is unchanged.

As things stand, nothing client-facing can show it: the client report and the
public QA certificates render neither the Devices panel nor the device frame.

**The file is behind the login too.** The model lives in
`apps/dashboard/assets/models/`, outside `public/`, and reaches the page only
through `/api/models/<file>`, which checks the team session as the capture
routes do, answers 401 without one, and serves only files named in the registry. It is marked `private`, so no shared
cache can serve it past that check.

It was first committed to `public/`, where anyone with the production URL could
fetch it without signing in. That was consistent while the concern was the
wordmark, which had been stripped; it stopped being consistent once this record
said the concern is the design itself. It was moved in #120, the day #119
merged. Gating our copy is not about secrecy — the unmodified model is a free
download on Sketchfab — it is that our production app should not hand
Samsung's design to anyone who asks for it. **Do not move it back to
`public/`**, for convenience or caching.

## What takes it out

- **Anyone turning 3D off to get work done.** Not trying it and switching back
  — turning it off because it was in the way: the page felt slower, the pins or
  the scroll ruler were needed, the drift was distracting, anything. One
  instance is enough. It comes out; it is not tuned until it survives.
- **The tool going client-facing in any form**, as above.

## The check

**On 2026-09-29** — two weeks from the merge of #119 (2026-09-15, 18:25 UTC) —
ask everyone who uses the Devices tab one question: *"Did you ever turn 3D off to get work done?"* Any yes, and it comes
out.

There is no telemetry on the toggle, and there will not be: the choice lives in
each person's browser. The check is asking people, and it cannot be answered
by looking at data.

If every answer is no, change the status above to "accepted" and delete this
section's date; the client-facing rule stays regardless.

## How to take it out

It was built to come out cleanly. In `apps/dashboard`:

- Delete `src/components/layout-checks/handset-3d.tsx`,
  `src/lib/layout-checks/frame3d.ts`, `models-3d.ts`, `model-rotation.ts`,
  `model-fit.ts` and `screen-crop.ts` (each with its `.test.ts`),
  `src/types/three.d.ts`, every file in `assets/models/`,
  `scripts/optimise-handset-model.mjs`, `src/app/api/models/[model]/route.ts`
  (and its line in `src/app/api/api-auth.isolation.test.ts`), and the
  `outputFileTracingIncludes` entry in `next.config.ts`.
- In `src/components/layout-checks/devices-panel.tsx`, remove the lazy import,
  the 3D state, the **3D** and **Face front** buttons, the model element and
  the `inert` wrapper around `DeviceFrame`.
- `npm uninstall three`.
- Remove "The 3D Galaxy S25" from `services/devicepreview/LIMITATIONS.md` and
  mark this ADR superseded.

The `layout-checks.frame3d` key left in people's browsers is harmless.
