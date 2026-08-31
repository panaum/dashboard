"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "./icons";

export function UserMenu({ name, email, image }: { name: string; email: string; image: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium text-text-primary">{name || email}</div>
        <div className="text-xs text-text-muted">{email}</div>
      </div>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-9 rounded-full border border-line" />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-full border border-line bg-ink-800 text-sm font-semibold text-text-secondary">
          {(name || email || "?").charAt(0).toUpperCase()}
        </div>
      )}
      <button
        onClick={() => signOut({ callbackUrl: "/auth/signin" })}
        aria-label="Sign out"
        title="Sign out"
        className="flex size-9 items-center justify-center rounded-full border border-line text-text-muted transition-colors hover:border-red-500/40 hover:text-red-300"
      >
        <LogOut />
      </button>
    </div>
  );
}
