import { Badge } from "@/components/ui/badge";
import { label, STATUS_TONE, CERT_TONE, type Status, type CertStatus } from "@/lib/constants";

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{label(status)}</Badge>;
}

export function CertBadge({ status }: { status: CertStatus }) {
  return <Badge tone={CERT_TONE[status]}>{label(status)}</Badge>;
}
