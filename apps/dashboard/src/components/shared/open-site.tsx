import { ExternalLink } from "lucide-react";

/** Quick "open the live page in a new tab" affordance. Renders nothing without a URL. */
export function OpenSite({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open live site"
      aria-label="Open live site"
      className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-card-soft hover:text-info"
    >
      <ExternalLink className="size-4" />
    </a>
  );
}
