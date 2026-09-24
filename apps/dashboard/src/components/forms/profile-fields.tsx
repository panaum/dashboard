"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Field, Input } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { setAvatar } from "@/app/dashboard/team/actions";

// The fields a person edits about themselves — photo, name, nickname. ONE
// implementation, rendered in three places: the admin's member dialog on the
// Team page, /dashboard/personalization, and the personalisation step of onboarding.
// Same inputs, same schema (profileSchema), same storage (the TeamMember row;
// the photo through the same setAvatar action).

export type ProfileMember = {
  id: string;
  name: string;
  nickname?: string | null;
  avatarUpdatedAt?: string | null;
};

/** Name and nickname inputs, named for profileSchema. They sit inside the
 *  caller's <form>, which decides which action they post to. */
export function ProfileFields({ member, autoFocus }: { member?: ProfileMember; autoFocus?: boolean }) {
  // Unique per copy: the profile page and the onboarding dialog can both be
  // on screen, and a shared id sent the dialog's labels (and typing, for
  // anyone clicking a label) to the fields behind it.
  const uid = useId();
  return (
    <>
      <Field label="Name" htmlFor={`${uid}-name`}>
        <Input id={`${uid}-name`} name="name" defaultValue={member?.name} placeholder="e.g. Samiya" autoFocus={autoFocus} required maxLength={80} />
      </Field>
      <Field label="Nickname" htmlFor={`${uid}-nickname`} hint="Optional — what people call you day to day.">
        <Input id={`${uid}-nickname`} name="nickname" defaultValue={member?.nickname ?? ""} placeholder="e.g. Sam" maxLength={40} />
      </Field>
    </>
  );
}

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

/** The photo sits outside the main form: it is a file, it saves on its own,
 *  and nesting a second <form> inside the first is invalid HTML. */
export function PhotoField({ member, demo }: { member: ProfileMember; /** Preview the pick locally, upload nothing. */ demo?: boolean }) {
  const [version, setVersion] = useState(member.avatarUpdatedAt ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const src = preview ?? (version ? `/api/team-avatar?id=${member.id}&v=${encodeURIComponent(version)}` : null);

  const send = (file: File | null) => {
    if (demo) { if (!file) setPreview(null); return; }
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
