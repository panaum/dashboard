import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireApiAuth } from "@/lib/auth";

// The 3D Galaxy S25 model, for signed-in users only.
//
// It is deliberately not in public/, which anyone with the production URL can
// fetch without signing in. The model shows Samsung's industrial design, and
// that — not only the wordmark stripped from it — is why it is internal
// (docs/decisions/ADR-004-3d-galaxy-s25-internal-only.md). Keeping our copy
// behind the login is not secrecy: the unmodified model is a free download on
// Sketchfab. It is that our production app should not hand that design to
// anyone who asks.
//
// `private`: a browser may keep it for a day; no shared cache may, since a
// cached copy would be served without the session check.

const MODEL = join(process.cwd(), "assets", "models", "galaxy-s25.glb");

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const body = await readFile(MODEL);
    return new Response(body, {
      headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "private, max-age=86400" },
    });
  } catch {
    // The component treats a failed load as "no 3D": the flat frame stays.
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
