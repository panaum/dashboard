"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/field";
import { label } from "@/lib/constants";

const OTHER = "OTHER";

/**
 * Platform picker. Platform is an open string (no enum): choosing "Other" turns
 * this same control into a text box — in place, not a second field — so you can
 * name a platform that isn't listed. Leaving it blank just saves the generic
 * "Other". A typed platform is picked up by listPlatforms() and becomes a normal
 * option next time. The submitted value rides a single hidden input named
 * `platform`; the visible controls are unnamed so they never post a rival value.
 */
export function PlatformField({
  platforms,
  defaultValue = "WORDPRESS",
}: {
  platforms: string[];
  defaultValue?: string;
}) {
  // Keep an out-of-list platform selectable when editing an old project.
  const options = platforms.includes(defaultValue)
    ? platforms
    : [defaultValue, ...platforms];

  const [choice, setChoice] = useState(defaultValue);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");

  // Blank while adding falls back to the generic "Other".
  const platform = adding ? custom.trim() || OTHER : choice;

  return (
    <Field label="Platform" htmlFor="platform-select">
      <input type="hidden" name="platform" value={platform} />
      {adding ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Type a platform, e.g. Squarespace"
            aria-label="New platform name"
          />
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setCustom("");
            }}
            className="shrink-0 rounded-md p-2 text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
            aria-label="Back to the platform list"
            title="Back to the platform list"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <Select
          id="platform-select"
          value={choice}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              // "Other" is the add-a-new-platform door — reveal the box in place.
              setChoice(OTHER);
              setAdding(true);
            } else {
              setChoice(v);
            }
          }}
        >
          {options.map((p) => (
            <option key={p} value={p}>
              {p === OTHER ? "Other / add new…" : label(p)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
