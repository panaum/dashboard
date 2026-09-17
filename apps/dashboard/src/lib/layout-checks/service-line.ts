// What the preview service is actually running, in one line.
//
// Captures come from a service deployed on its own, from the same repository
// as this page but on its own schedule. "Is the deployed service running the
// code I merged?" has cost three sessions of guessing, and /health answers it:
// this puts the answer in the Device health panel, where the question is
// already being asked, instead of in a terminal.
//
// Pure, so the wording is tested without a network.

export type ServiceHealth = {
  commit?: string | null;
  branch?: string | null;
  devices?: { count?: number; digest?: string; error?: string } | null;
  unavailable?: boolean;
};

/** Short enough to read, long enough to be the commit. */
function short(sha: string): string {
  return sha.trim().slice(0, 7);
}

/**
 * @param health      what /health said, or null while it is being asked
 * @param appCommit   the commit this page was built from, where the host says
 */
export function serviceLine(health: ServiceHealth | null | undefined, appCommit?: string | null): string | null {
  if (!health) return null;
  if (health.unavailable) return "The preview service did not answer. Captures already stored are unaffected.";
  const parts: string[] = [];
  const sha = typeof health.commit === "string" && health.commit.trim() ? short(health.commit) : null;
  if (sha) {
    const mine = typeof appCommit === "string" && appCommit.trim() ? short(appCommit) : null;
    // Both deploy from main, so equal shas mean the service has the change
    // that was merged with the page. Different ones are ordinary — the two
    // deploy separately — but they are the thing worth seeing.
    parts.push(mine === null ? `running ${sha}`
      : mine === sha ? `running ${sha}, the same build as this page`
      : `running ${sha}; this page is on ${mine}`);
  } else {
    parts.push("running an unknown build — it reports no commit");
  }
  const count = health.devices?.count;
  if (typeof count === "number" && count > 0) parts.push(`${count} device profiles loaded`);
  else if (health.devices?.error) parts.push("its device list could not be read");
  return `Preview service: ${parts.join(" · ")}.`;
}
