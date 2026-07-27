"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { label } from "@/lib/constants";

const NEW = "__new__";

/**
 * Platform picker with an inline "Add new platform…" escape hatch. Platform is
 * an open string (no enum), so choosing "Add new…" reveals a text box and the
 * typed name is what gets saved. The submitted value is carried by a single
 * hidden input named `platform`; the visible controls are unnamed so they never
 * post a competing value.
 */
export function PlatformField({
  platforms,
  defaultValue = "WORDPRESS",
}: {
  platforms: string[];
  defaultValue?: string;
}) {
  // When editing a project whose platform has since dropped off the list, keep
  // it selectable so the form doesn't silently change it.
  const options = platforms.includes(defaultValue)
    ? platforms
    : [defaultValue, ...platforms];

  const [choice, setChoice] = useState(defaultValue);
  const [custom, setCustom] = useState("");

  const adding = choice === NEW;
  const platform = adding ? custom.trim() : choice;

  return (
    <Field label="Platform" htmlFor="platform-select">
      <input type="hidden" name="platform" value={platform} />
      <Select
        id="platform-select"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
      >
        {options.map((p) => (
          <option key={p} value={p}>
            {label(p)}
          </option>
        ))}
        <option value={NEW}>＋ Add new platform…</option>
      </Select>
      {adding && (
        <Input
          className="mt-2"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="New platform name, e.g. Astro"
          aria-label="New platform name"
          autoFocus
        />
      )}
    </Field>
  );
}
