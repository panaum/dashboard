"use client";

import * as React from "react";
import { Link2, X } from "lucide-react";
import { Field } from "@/components/ui/field";

type RClient = { id: string; name: string };
type RSite = { id: string; name: string | null; url: string | null };

// Optional "Link to LinkSpy site" field for the New Page form. On selection it
// writes hidden inputs the create action reads; if left untouched, it emits NO
// inputs, so page creation is byte-identical to today. Degrades to a disabled
// note when the registry isn't configured/reachable.
export function RegistryCreateField() {
  const [open, setOpen] = React.useState(false);
  const [clients, setClients] = React.useState<RClient[] | null>(null);
  const [sites, setSites] = React.useState<RSite[] | null>(null);
  const [client, setClient] = React.useState<RClient | null>(null);
  const [site, setSite] = React.useState<RSite | null>(null);
  const [q, setQ] = React.useState("");
  const [unavailable, setUnavailable] = React.useState(false);
  // null = probing; false = reachable; true = unavailable (disabled note).
  const [probeUnavailable, setProbeUnavailable] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    fetch(`/api/registry/clients?search=`, { cache: "no-store" })
      .then((x) => x.json())
      .then((r) => setProbeUnavailable(Boolean(r?.unavailable)))
      .catch(() => setProbeUnavailable(true));
  }, []);

  if (probeUnavailable) {
    return (
      <Field label="Link to LinkSpy site (optional)">
        <span className="text-xs text-text-muted">Registry unavailable — link later.</span>
      </Field>
    );
  }

  // Chosen: emit hidden inputs + a clear affordance.
  if (site) {
    return (
      <Field label="Link to LinkSpy site (optional)">
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-success"><Link2 className="size-3.5" /> {site.name || site.url || site.id}</span>
          <button type="button" onClick={() => { setSite(null); setClient(null); }} className="text-text-muted underline underline-offset-2">change</button>
        </div>
        <input type="hidden" name="registrySiteId" value={site.id} />
        <input type="hidden" name="registryClientId" value={client?.id ?? ""} />
      </Field>
    );
  }

  async function searchClients(term: string) {
    setUnavailable(false);
    const r = await fetch(`/api/registry/clients?search=${encodeURIComponent(term)}`, { cache: "no-store" }).then((x) => x.json());
    if (r?.unavailable) { setUnavailable(true); setClients([]); return; }
    setClients(r.clients ?? []);
  }
  async function loadSites(c: RClient) {
    setClient(c); setSites(null); setUnavailable(false);
    const r = await fetch(`/api/registry/clients/${encodeURIComponent(c.id)}/sites`, { cache: "no-store" }).then((x) => x.json());
    if (r?.unavailable) { setUnavailable(true); setSites([]); return; }
    setSites(r.sites ?? []);
  }

  return (
    <Field label="Link to LinkSpy site (optional)">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); searchClients(""); }}
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary">
          <Link2 className="size-3.5" /> Link to LinkSpy →
        </button>
      ) : (
        <div className="rounded-md border border-border-soft bg-card-soft p-2 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-text-secondary">{client ? `Sites · ${client.name}` : "Pick a client"}</span>
            <button type="button" onClick={() => { setOpen(false); setClient(null); setSites(null); }} className="text-text-muted"><X className="size-3.5" /></button>
          </div>
          {unavailable && <p className="mb-1 text-text-muted">Registry unavailable — link later.</p>}
          {!client ? (
            <>
              <input value={q} onChange={(e) => { setQ(e.target.value); searchClients(e.target.value); }}
                placeholder="Search clients…" className="mb-1.5 w-full rounded border border-border-soft bg-card px-2 py-1" />
              <div className="flex max-h-36 flex-col overflow-y-auto">
                {(clients ?? []).map((c) => (
                  <button type="button" key={c.id} onClick={() => loadSites(c)} className="rounded px-2 py-1 text-left hover:bg-card">{c.name}</button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex max-h-36 flex-col overflow-y-auto">
              <button type="button" onClick={() => { setClient(null); setSites(null); }} className="mb-1 text-text-muted underline underline-offset-2">← clients</button>
              {(sites ?? []).map((s) => (
                <button type="button" key={s.id} onClick={() => setSite(s)} className="rounded px-2 py-1 text-left hover:bg-card">
                  {s.name || s.url || s.id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
