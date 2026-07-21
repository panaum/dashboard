import type { Prisma } from "@prisma/client";

export type PageSearchParams = {
  platform?: string;
  status?: string;
  developerId?: string;
  testerId?: string;
  month?: string;
};

/** Shared Page filter used by the search page and its CSV export. */
export function buildPageWhere(sp: PageSearchParams): Prisma.PageWhereInput {
  return {
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.developerId ? { developerId: sp.developerId } : {}),
    ...(sp.testerId ? { testerId: sp.testerId } : {}),
    ...(sp.month ? { deliveryMonth: sp.month } : {}),
    ...(sp.platform ? { project: { platform: sp.platform } } : {}),
  };
}

export function hasAnyFilter(sp: PageSearchParams): boolean {
  return Boolean(
    sp.platform || sp.status || sp.developerId || sp.testerId || sp.month,
  );
}
