"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, X, Check, Loader2 } from "lucide-react";
import {
  linkPageToRegistry,
  unlinkPageFromRegistry,
} from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/registry-actions";

type Path = { clientId: string; projectId: string; pageId: string };
type RClient = { id: string; name: string };
type RSite = { id: string; name: string | null; url: string | null };

// The "Registry" line on a page: linked state (+ Unlink), or a quiet
// "Link to LinkSpy" affordance that opens a client→site search. Degrades to a
// disabled note when the registry isn't configured/reachable — page never blocks.
export function RegistryLink({
  path,
  linkedSiteId,
  configured,
}: {
  path: Path;
  linkedSiteId: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [clients, setClients] = React.useState<RClient[] | null>(null);
  const [sites, setSites] = React.useState<RSite[] | null>(null);
  const [picked, setPicked] = React.useState<RClient | null>(null);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (!configured) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title="LinkSpy registry connection not configured">
        <Link2 className="size-3.5" /> Registry unavailable — link later
      </span>
    );
  }

  async function searchClients(term: string) {
    setErr(null);
    const r = await fetch(`/api/registry/clients?search=${encodeURIComponent(term)}`, { cache: "no-store" }).then((x) => x.json());
    if (r?.unavailable) { setErr("Registry unavailable — link later."); setClients([]); return; }
    setClients(r.clients ?? []);
  }

  async function loadSites(c: RClient) {
    setPicked(c); setSites(null); setErr(null);
    const r = await fetch(`/api/registry/clients/${encodeURIComponent(c.id)}/sites`, { cache: "no-store" }).then((x) => x.json());
    if (r?.unavailable) { setErr("Registry unavailable — link later."); setSites([]); return; }
    setSites(r.sites ?? []);
  }

  async function doLink(site: RSite) {
    setBusy(true); setErr(null);
    const res = await linkPageToRegistry({
      path, siteId: site.id, registryClientId: picked?.id ?? null,
      name: site.name || site.url || "page", url: site.url,
    });
    setBusy(false);
    if ("error" in res) { setErr(res.error); return; }
    setOpen(false); setClients(null); setSites(null); setPicked(null);
    router.refresh();
  }

  async function doUnlink() {
    setBusy(true);
    await unlinkPageFromRegistry({ path });
    setBusy(false);
    router.refresh();
  }

  if (linkedSiteId) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-success">
          <Check className="size-3.5" /> Linked to LinkSpy
        </span>
        <span className="font-mono text-text-muted">{linkedSiteId.slice(0, 8)}…</span>
        <button onClick={doUnlink} disabled={busy} className="text-text-muted underline underline-offset-2 hover:text-text-secondary">
          {busy ? "…" : "Unlink"}
        </button>
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); searchClients(""); }}
        className="inline-flex items-center gap-1.5 text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary"
      >
        <Link2 className="size-3.5" /> Link to LinkSpy →
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border-soft bg-card p-2.5 text-xs" style={{ minWidth: 260, maxWidth: 340 }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-text-primary">
          {picked ? `Sites · ${picked.name}` : "Pick a LinkSpy site"}
        </span>
        <button onClick={() => { setOpen(false); setPicked(null); setSites(null); }} className="text-text-muted"><X className="size-3.5" /></button>
      </div>

      {err && <p className="mb-2 text-error">{err}</p>}

      {!picked ? (
        <>
          <input
            value={q} onChange={(e) => { setQ(e.target.value); searchClients(e.target.value); }}
            placeholder="Search clients…" autoFocus
            className="mb-2 w-full rounded border border-border-soft bg-card-soft px-2 py-1"
          />
          <div className="flex max-h-44 flex-col overflow-y-auto">
            {clients === null ? (
              <span className="text-text-muted"><Loader2 className="inline size-3 animate-spin" /> loading…</span>
            ) : clients.length === 0 ? (
              <span className="text-text-muted">No clients.</span>
            ) : clients.map((c) => (
              <button key={c.id} onClick={() => loadSites(c)} className="rounded px-2 py-1 text-left hover:bg-card-soft">{c.name}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button onClick={() => { setPicked(null); setSites(null); }} className="mb-2 text-text-muted underline underline-offset-2">← clients</button>
          <div className="flex max-h-44 flex-col overflow-y-auto">
            {sites === null ? (
              <span className="text-text-muted"><Loader2 className="inline size-3 animate-spin" /> loading…</span>
            ) : sites.length === 0 ? (
              <span className="text-text-muted">No sites for this client.</span>
            ) : sites.map((s) => (
              <button key={s.id} disabled={busy} onClick={() => doLink(s)} className="rounded px-2 py-1 text-left hover:bg-card-soft">
                {s.name || s.url || s.id}
                {s.url && <span className="ml-1 text-text-muted">{s.url.replace(/^https?:\/\//, "")}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
