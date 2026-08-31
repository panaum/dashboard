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

/**
 * Filter for the Team performance panel. Deliberately different from
 * `buildPageWhere` in two ways:
 *
 *  - the developer filter is dropped, so narrowing to one person keeps the
 *    whole team on the chart (that developer is highlighted instead);
 *  - with no explicit month chosen it scopes to a rolling window of recent
 *    delivery months instead of all time. Pass `months: null` for all time.
 *
 * Everything else (platform, status, tester, an explicit month) comes straight
 * from the shared parser above — one filter definition, not two.
 */
export function buildTeamPanelWhere(
  sp: PageSearchParams,
  months: string[] | null,
): Prisma.PageWhereInput {
  const { platform, status, testerId, month } = sp; // developerId deliberately dropped
  return {
    ...buildPageWhere({ platform, status, testerId, month }),
    ...(sp.month || months === null ? {} : { deliveryMonth: { in: months } }),
  };
}
