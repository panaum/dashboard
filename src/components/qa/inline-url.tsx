"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, Check, Pencil } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { setPageUrl } from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";

type Path = { clientId: string; projectId: string; pageId: string };

export function InlineUrl({
  pageId,
  url,
  path,
}: {
  pageId: string;
  url: string | null;
  path: Path;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(url ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    await setPageUrl({ pageId, url: value, path });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <Link2 className="size-3.5 text-text-muted" />
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-info hover:underline"
          >
            {url}
          </a>
        ) : (
          <span className="text-text-muted">No URL set</span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="rounded p-1 text-text-secondary hover:bg-card-soft hover:text-text-primary"
          aria-label="Edit URL"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://…"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="h-8 w-72 py-1 text-[13px]"
      />
      <Button size="sm" onClick={save} disabled={saving}>
        <Check /> {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
