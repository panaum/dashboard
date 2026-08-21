import { redirect } from "next/navigation";

/**
 * /dashboard/search was merged into /dashboard/insights — one filter bar now
 * drives the analysis and the matching-pages list together. This stub keeps
 * old links, bookmarks and the ⌘K entry working by forwarding the query as-is;
 * every filter name is unchanged on the other side.
 */
export default async function SearchRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) q.set(k, v);
  }
  const s = q.toString();
  redirect(`/dashboard/insights${s ? `?${s}` : ""}`);
}
