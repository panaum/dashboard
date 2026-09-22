// Grouping a person's pages by client, because a QA with 145 of them has a
// list nobody reads. The client is the unit people actually think in — "how
// did Savvio go" — and the page under it is the detail.

export type GroupablePage = {
  project: { clientId: string; client: { name: string } };
  issues: { severity: string }[];
};

export type ClientGroup<P extends GroupablePage> = {
  clientId: string;
  client: string;
  pages: P[];
  issues: number;
};

/**
 * Newest-first inside a client is the caller's business — whatever order the
 * pages arrive in is preserved. The groups themselves come back biggest first,
 * so the clients somebody actually spent their time on are at the top, with
 * ties broken by name so the order never jitters between renders.
 */
export function groupByClient<P extends GroupablePage>(pages: P[]): ClientGroup<P>[] {
  const byClient = new Map<string, ClientGroup<P>>();
  for (const pg of pages) {
    const id = pg.project.clientId;
    const group = byClient.get(id) ?? {
      clientId: id,
      client: pg.project.client.name,
      pages: [],
      issues: 0,
    };
    group.pages.push(pg);
    group.issues += pg.issues.length;
    byClient.set(id, group);
  }
  return [...byClient.values()].sort(
    (a, b) => b.pages.length - a.pages.length || a.client.localeCompare(b.client),
  );
}

/** "12 pages · 47 issues", or "1 page · no issues". The summary line has to
 *  read as a sentence at every count, because it is the only thing visible
 *  until somebody opens the group. */
export function groupSummary(pages: number, issues: number): string {
  const p = `${pages} page${pages === 1 ? "" : "s"}`;
  const i = issues === 0 ? "no issues" : `${issues} issue${issues === 1 ? "" : "s"}`;
  return `${p} · ${i}`;
}
