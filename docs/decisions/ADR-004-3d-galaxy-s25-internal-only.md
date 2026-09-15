# ADR-004 — A 3D Galaxy S25 on the Devices tab: internal only, and on trial

**Status:** accepted, on trial. **Check on 2026-09-29.**
**Date:** 2026-09-15
**Related:** PR #119; `apps/dashboard/src/components/layout-checks/galaxy-s25-model.tsx`;
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
(3.54 MB → 429 KB) by `apps/dashboard/scripts/optimise-galaxy-s25-model.mjs`.

## Decision

1. **Galaxy S25 only**, behind a **3D** toggle in the stage bar. **Off by
   default**; the choice is remembered in each browser.
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

As things stand, nothing client-facing can show it: the client report and the
public QA certificates render neither the Devices panel nor the device frame.
The model file itself is served from `public/`, outside the login — a
deliberate choice (2026-09-15), noted here so it is not mistaken for an
oversight.

## What takes it out

- **Anyone turning 3D off to get work done.** Not trying it and switching back
  — turning it off because it was in the way: the page felt slower, the pins or
  the scroll ruler were needed, the drift was distracting, anything. One
  instance is enough. It comes out; it is not tuned until it survives.
- **The tool going client-facing in any form**, as above.

## The check

**On 2026-09-29** — two weeks from the merge on 2026-09-15; if the merge landed
later, the date moves with it — ask everyone who uses the Devices tab one
question: *"Did you ever turn 3D off to get work done?"* Any yes, and it comes
out.

There is no telemetry on the toggle, and there will not be: the choice lives in
each person's browser. The check is asking people, and it cannot be answered
by looking at data.

If every answer is no, change the status above to "accepted" and delete this
section's date; the client-facing rule stays regardless.

## How to take it out

It was built to come out cleanly. In `apps/dashboard`:

- Delete `src/components/layout-checks/galaxy-s25-model.tsx`,
  `src/lib/layout-checks/frame3d.ts`, `model-rotation.ts`, `model-fit.ts` and
  `screen-crop.ts` (each with its `.test.ts`), `src/types/three.d.ts`,
  `public/models/galaxy-s25.glb` and `scripts/optimise-galaxy-s25-model.mjs`.
- In `src/components/layout-checks/devices-panel.tsx`, remove the lazy import,
  the 3D state, the **3D** and **Face front** buttons, the model element and
  the `inert` wrapper around `DeviceFrame`.
- `npm uninstall three`.
- Remove "The 3D Galaxy S25" from `services/devicepreview/LIMITATIONS.md` and
  mark this ADR superseded.

The `layout-checks.frame3d` key left in people's browsers is harmless.
