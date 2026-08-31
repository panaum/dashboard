"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Live screenshot of a page's URL via Microlink (no infra / no API key for
 * light use). Falls back to a branded placeholder when there's no URL or the
 * screenshot fails to load.
 */
export function SitePreview({
  url,
  name,
  className,
  aspect = "aspect-[16/9]",
}: {
  url: string | null | undefined;
  name: string;
  className?: string;
  aspect?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(url) && !failed;

  const src = url
    ? `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`
    : "";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border-soft bg-gradient-to-br from-card-soft to-[#eceaf6]",
        aspect,
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Live preview of ${name}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover object-top"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-text-muted">
          <Globe className="size-6" strokeWidth={1.5} />
          <span className="text-[13px]">
            {url ? "Preview unavailable" : "Add a URL to see a live preview"}
          </span>
        </div>
      )}
    </div>
  );
}
