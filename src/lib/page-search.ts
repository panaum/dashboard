import type { Prisma } from "@prisma/client";

export type PageSearchParams = {
  q?: string;
  platform?: string;
  status?: string;
  developerId?: string;
  testerId?: string;
  month?: string;
};

/** Shared Page filter used by the search page and its CSV export. */
export function buildPageWhere(sp: PageSearchParams): Prisma.PageWhereInput {
  const q = sp.q?.trim() ?? "";
  return {
    // `insensitive` matters on Postgres, where LIKE is case-sensitive by default
    // (SQLite's was not — so search silently regressed after the Postgres move).
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { project: { name: { contains: q, mode: "insensitive" } } },
            { project: { client: { name: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.developerId ? { developerId: sp.developerId } : {}),
    ...(sp.testerId ? { testerId: sp.testerId } : {}),
    ...(sp.month ? { deliveryMonth: sp.month } : {}),
    ...(sp.platform ? { project: { platform: sp.platform } } : {}),
  };
}

export function hasAnyFilter(sp: PageSearchParams): boolean {
  return Boolean(
    sp.q || sp.platform || sp.status || sp.developerId || sp.testerId || sp.month,
  );
}
