"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormFooter, useOnOk } from "@/components/forms/form-parts";
import { saveMember, setAvatar } from "@/app/dashboard/team/actions";
import { DESIGNATIONS, designationFor } from "@/lib/designations";

type MemberInitial = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  slackUserId?: string | null;
  avatarUpdatedAt?: string | null;
};

/**
 * Square the photo in the browser: centre-crop to 256×256 and re-encode. A
 * phone photo arrives at several megabytes and would sit in the row forever;
 * this lands at a few KB, needs no image library on the server, and means the
 * size cap in the action is a backstop rather than something people hit.
 */
async function square(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.86));
  return blob ? new File([blob], "avatar.webp", { type: "image/webp" }) : file;
}

export function MemberForm({
  close,
  initial,
}: {
  close: () => void;
  initial?: MemberInitial;
}) {
  const [state, action, pending] = useActionState(saveMember, {});
  useOnOk(state, close);

  const current = initial ? designationFor(initial) : DESIGNATIONS[0].title;
  const stock = DESIGNATIONS.map((d) => d.title);
  const options = stock.includes(current) ? stock : [current, ...stock];

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {initial ? (
        <PhotoField member={initial} />
      ) : (
        <p className="rounded-md bg-card-soft px-3 py-2 text-xs text-text-secondary">
          Add the person first — their photo can be set from this dialog once they exist.
        </p>
      )}

      <Field label="Name" htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          placeholder="e.g. Samiya"
          autoFocus
          required
        />
      </Field>
      {/* One field where there were two. The designation is what shows under
          their name AND what decides the work they are offered — see
          src/lib/designations.ts. A title typed before this change is kept as
          an extra option so opening this dialog never relabels anyone. */}
      <Field
        label="Role"
        htmlFor="title"
        hint="Shown under their name, and what page and board assignment lists read. A manager appears in neither."
      >
        <Select id="title" name="title" defaultValue={current}>
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Slack member ID" htmlFor="slackUserId" hint="From their Slack profile → Copy member ID (starts with U). Lets a board @mention ping them.">
        <Input id="slackUserId" name="slackUserId" defaultValue={initial?.slackUserId ?? ""} placeholder="U0123ABCD" pattern="[UW][A-Z0-9]{5,}" />
      </Field>
      <FormFooter pending={pending} error={state.error} close={close} />
    </form>
  );
}

/** The photo sits outside the main form: it is a file, it saves on its own,
 *  and nesting a second <form> inside the first is invalid HTML. */
function PhotoField({ member }: { member: MemberInitial }) {
  const [version, setVersion] = useState(member.avatarUpdatedAt ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const src = preview ?? (version ? `/api/team-avatar?id=${member.id}&v=${encodeURIComponent(version)}` : null);

  const send = (file: File | null) => {
    const fd = new FormData();
    fd.set("id", member.id);
    if (file) fd.set("avatar", file);
    start(async () => {
      setError(null);
      const r = await setAvatar(fd);
      if (r.error) { setError(r.error); return; }
      setVersion(file ? new Date().toISOString() : null);
      if (!file) { setPreview(null); }
    });
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={member.name} src={src} size="lg" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-full border border-border-soft bg-card px-4 py-2 text-[13px] font-medium text-text-primary transition-colors hover:border-accent/50 hover:bg-accent/[0.06]">
            {src ? "Change photo" : "Upload photo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={pending}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const squared = await square(f);
                setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(squared); });
                send(squared);
              }}
            />
          </label>
          {src && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => send(null)}>
              Remove
            </Button>
          )}
        </div>
        <span className="text-xs text-text-muted">
          {pending ? "Saving…" : error ?? "Squared to 256px in your browser. Initials are used when there is no photo."}
        </span>
      </div>
    </div>
  );
}
