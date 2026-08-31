import "server-only";
import { db } from "@/lib/db";
import { PLATFORMS } from "@/lib/constants";

/**
 * Platform options offered in forms and filters: the built-in list plus any
 * custom platform already saved on a project (so a typed-in platform becomes a
 * reusable choice next time), de-duplicated. "Other" is always kept last.
 *
 * Platform is stored as a plain string on Project.platform — there is no enum
 * and no catalog table — so "adding a platform" is just using it once.
 */
export async function listPlatforms(): Promise<string[]> {
  const base = PLATFORMS.filter((p) => p !== "OTHER");
  const known = new Set<string>(PLATFORMS);
  let custom: string[] = [];
  try {
    const rows = await db.project.findMany({
      distinct: ["platform"],
      select: { platform: true },
    });
    custom = rows
      .map((r) => r.platform)
      .filter((p): p is string => Boolean(p) && !known.has(p))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    custom = []; // DB unreachable → fall back to the built-in list only
  }
  return [...base, ...custom, "OTHER"];
}
