import { ShieldCheck, CheckCircle2, XCircle, Clock, MinusCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SitePreview } from "@/components/shared/site-preview";
import { SEVERITIES, label, monthLabel, type Severity } from "@/lib/constants";

const VERDICT = {
  PASS: { text: "QA Passed", cls: "bg-success/12 text-success", Icon: CheckCircle2 },
  FAIL: { text: "QA Failed", cls: "bg-error/12 text-error", Icon: XCircle },
  IN_PROGRESS: { text: "In progress", cls: "bg-warning/15 text-warning", Icon: Clock },
} as const;

const SEV_DOT: Record<Severity, string> = {
  CRITICAL_HIGH: "bg-error",
  MEDIUM: "bg-warning",
  LOW: "bg-brand-blue",
  REPETITIVE: "bg-accent",
};

type CheckItem = {
  category: string;
  name: string;
  result: string | null;
  valueDesktop: string | null;
  valueMobile: string | null;
  isMeasurement: boolean;
  hasDualValue: boolean;
};

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
        {k}
      </span>
      <span className="text-sm text-text-primary">{v}</span>
    </div>
  );
}

function ResultCell({ item }: { item: CheckItem }) {
  // Measurement / dual-value checks show their recorded value(s).
  if (item.isMeasurement) {
    return (
      <span className="text-[12px] tabular-nums text-text-secondary">
        {item.valueDesktop || "—"}
      </span>
    );
  }
  if (item.hasDualValue && (item.valueDesktop || item.valueMobile)) {
    return (
      <span className="text-[12px] text-text-secondary">
        Desktop {item.valueDesktop || "—"} · Mobile {item.valueMobile || "—"}
      </span>
    );
  }
  if (item.result === "PASSED")
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
        <CheckCircle2 className="size-3.5" /> Passed
      </span>
    );
  if (item.result === "FAILED")
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-error">
        <XCircle className="size-3.5" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-text-muted">
      <MinusCircle className="size-3.5" /> N/A
    </span>
  );
}

export type CertPage = {
  id: string;
  name: string;
  url: string | null;
  deliveryMonth: string | null;
  delayDays: number;
  project: { name: string; type: string; platform: string; client: { name: string } };
  developer: { name: string } | null;
  tester: { name: string } | null;
  certificate: {
    status: string;
    completedAt: Date | null;
    items: CheckItem[];
  } | null;
  issues: { severity: string; status: string }[];
};

/** Read-only QA certificate, shared by the internal and public (client) views. */
export function CertificateDocument({ page }: { page: CertPage }) {
  const verdict = (page.certificate?.status as keyof typeof VERDICT) ?? "IN_PROGRESS";
  const v = VERDICT[verdict] ?? VERDICT.IN_PROGRESS;

  const items = page.certificate?.items ?? [];
  const passed = items.filter((i) => i.result === "PASSED").length;
  const failed = items.filter((i) => i.result === "FAILED").length;
  const na = items.length - passed - failed;
  const categories = [...new Set(items.map((i) => i.category))];

  const totalIssues = page.issues.length;
  const resolved = page.issues.filter((i) => i.status === "FIXED").length;
  const bySeverity = SEVERITIES.map((s) => ({
    s,
    n: page.issues.filter((i) => i.severity === s).length,
  })).filter((x) => x.n > 0);

  const ref = page.id.slice(-8).toUpperCase();
  const issued = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <article className="overflow-hidden rounded-2xl border border-border-soft bg-card shadow-sm print:border-0 print:shadow-none">
      <header className="flex items-center justify-between gap-4 border-b border-border-soft bg-card-soft/50 px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-primary text-text-on-dark">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">
              Quality Assurance Certificate
            </span>
            <span className="text-[12px] text-text-secondary">
              Apexure · Deliverables
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
            Reference
          </div>
          <div className="font-mono text-sm text-text-primary">{ref}</div>
        </div>
      </header>

      <div className="px-8 py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
              {page.name}
            </h1>
            <p className="text-sm text-text-secondary">
              {page.project.client.name} · {page.project.name}
            </p>
            {page.url && (
              <a
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 break-all text-[13px] text-info hover:underline"
              >
                {page.url}
              </a>
            )}
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ${v.cls}`}
          >
            <v.Icon className="size-4" />
            {v.text}
          </span>
        </div>

        {page.url && (
          <SitePreview
            url={page.url}
            name={page.name}
            aspect="aspect-[16/8]"
            className="mt-6"
          />
        )}

        <div className="my-7 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border-soft py-6 sm:grid-cols-3">
          <Field k="Platform" v={label(page.project.platform)} />
          <Field k="Type" v={label(page.project.type)} />
          <Field
            k="Delivery"
            v={page.deliveryMonth ? monthLabel(page.deliveryMonth) : "—"}
          />
          <Field
            k="Developer"
            v={
              page.developer ? (
                <span className="inline-flex items-center gap-2">
                  <Avatar name={page.developer.name} size="sm" />
                  {page.developer.name}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Field
            k="Tester"
            v={
              page.tester ? (
                <span className="inline-flex items-center gap-2">
                  <Avatar name={page.tester.name} size="sm" />
                  {page.tester.name}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Field
            k="Delay"
            v={`${page.delayDays} day${page.delayDays === 1 ? "" : "s"}`}
          />
        </div>

        {/* Full itemised checklist */}
        {items.length > 0 && (
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">
                QA checklist
              </h2>
              <span className="text-[12px] text-text-secondary">
                {items.length} checks
                {passed > 0 && <> · <span className="text-success">{passed} passed</span></>}
                {failed > 0 && <> · <span className="text-error">{failed} failed</span></>}
                {na > 0 && <> · {na} N/A</>}
              </span>
            </div>
            <div className="flex flex-col gap-4">
              {categories.map((cat) => (
                <div key={cat}>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                    {cat}
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-border-soft">
                    {items
                      .filter((i) => i.category === cat)
                      .map((it, idx) => (
                        <div
                          key={`${cat}-${idx}`}
                          className="flex items-center justify-between gap-4 border-t border-border-soft px-3.5 py-2 first:border-t-0"
                        >
                          <span className="text-[13px] text-text-primary">
                            {it.name}
                          </span>
                          <span className="shrink-0 text-right">
                            <ResultCell item={it} />
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Issues */}
        <section className="mt-7">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Issues</h2>
          <p className="text-[13px] text-text-secondary">
            {totalIssues === 0
              ? "No issues logged."
              : `${resolved} of ${totalIssues} issue${totalIssues === 1 ? "" : "s"} resolved.`}
          </p>
          {bySeverity.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {bySeverity.map(({ s, n }) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary"
                >
                  <span className={`size-2 rounded-full ${SEV_DOT[s]}`} />
                  {n} {label(s)}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="flex items-end justify-between gap-4 border-t border-border-soft px-8 py-6">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-text-secondary">
            {page.tester
              ? `Verified by ${page.tester.name}`
              : "Verified by the Apexure QA team"}
          </span>
          <span className="text-[12px] text-text-muted">
            {page.certificate?.completedAt
              ? `Signed off ${page.certificate.completedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
              : `Issued ${issued}`}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${v.cls}`}
        >
          <v.Icon className="size-3.5" />
          {v.text}
        </span>
      </footer>
    </article>
  );
}
