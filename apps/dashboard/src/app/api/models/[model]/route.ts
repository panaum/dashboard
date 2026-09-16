import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { modelFile } from "@/lib/layout-checks/models-3d";

// The 3D handset models, for signed-in users only.
//
// They are deliberately not in public/, which anyone with the production URL
// can fetch without signing in. A model shows a manufacturer's industrial
// design, and that — not only the wordmarks stripped from it — is why they are
// internal (docs/decisions/ADR-004-3d-galaxy-s25-internal-only.md). Keeping
// our copies behind the login is not secrecy: the unmodified models are free
// downloads on Sketchfab. It is that our production app should not hand those
// designs to anyone who asks.
//
// The name in the address is matched against the registry and never joined
// into a path, so it cannot reach a file of its own choosing.
//
// `private`: a browser may keep it for a day; no shared cache may, since a
// cached copy would be served without the session check.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const { model } = await params;
  const file = modelFile(model);
  if (!file) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const body = await readFile(join(process.cwd(), "assets", "models", `${file}.glb`));
    return new Response(body, {
      headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "private, max-age=86400" },
    });
  } catch {
    // The component treats a failed load as "no 3D": the flat frame stays.
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
