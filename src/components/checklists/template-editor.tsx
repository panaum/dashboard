"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Ruler, MonitorSmartphone, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  addTemplateItem,
  deleteTemplateItem,
  updateTemplate,
} from "@/app/dashboard/checklists/actions";
import { PLATFORMS, label } from "@/lib/constants";

type Item = {
  id: string;
  category: string;
  name: string;
  hasDualValue: boolean;
  isMeasurement: boolean;
};

export function TemplateEditor({
  template,
  items,
}: {
  template: { id: string; name: string; platform: string | null; isDefault: boolean };
  items: Item[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(template.name);
  const [platform, setPlatform] = useState(template.platform ?? "");
  const [isDefault, setIsDefault] = useState(template.isDefault);

  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [dual, setDual] = useState(false);
  const [measurement, setMeasurement] = useState(false);

  const categories = [...new Set(items.map((i) => i.category))];

  const grouped = categories.map((c) => ({
    category: c,
    items: items.filter((i) => i.category === c),
  }));

  function saveSettings() {
    startTransition(async () => {
      await updateTemplate({ id: template.id, name, platform: platform || null, isDefault });
      router.refresh();
    });
  }

  function addItem() {
    if (!newName.trim()) return;
    startTransition(async () => {
      await addTemplateItem({
        templateId: template.id,
        category: newCategory || categories[0] || "General",
        name: newName,
        hasDualValue: dual,
        isMeasurement: measurement,
      });
      setNewName("");
      setDual(false);
      setMeasurement(false);
      router.refresh();
    });
  }

  function removeItem(id: string) {
    startTransition(async () => {
      await deleteTemplateItem({ id, templateId: template.id });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Settings */}
      <Card className="flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-secondary">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-secondary">
              Applies to platform
            </span>
            <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">Any platform (default)</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="size-4 accent-brand-primary"
            />
            Use as the default checklist for new pages
          </label>
          <Button size="sm" onClick={saveSettings} disabled={pending}>
            <Check /> Save
          </Button>
        </div>
      </Card>

      {/* Items */}
      <div className="flex flex-col gap-5">
        {grouped.map((group) => (
          <div key={group.category}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
              {group.category}
            </h3>
            <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
              {group.items.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center gap-3 border-t border-border-soft px-4 py-2.5 first:border-t-0"
                >
                  <span className="flex-1 text-sm text-text-primary">{it.name}</span>
                  {it.isMeasurement && (
                    <Badge tone="info" className="gap-1">
                      <Ruler className="size-3" /> Measurement
                    </Badge>
                  )}
                  {it.hasDualValue && (
                    <Badge tone="brand" className="gap-1">
                      <MonitorSmartphone className="size-3" /> Desktop + Mobile
                    </Badge>
                  )}
                  <button
                    onClick={() => removeItem(it.id)}
                    disabled={pending}
                    aria-label="Delete item"
                    className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {group.items.length === 0 && (
                <p className="px-4 py-3 text-[13px] text-text-muted">No items.</p>
              )}
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <p className="text-sm text-text-secondary">
            No checks yet — add the first one below.
          </p>
        )}
      </div>

      {/* Add item */}
      <Card className="flex flex-col gap-3 p-5">
        <span className="text-sm font-semibold text-text-primary">Add a check</span>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 220 }}>
            <span className="text-[13px] font-medium text-text-secondary">Check name</span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Mobile menu works"
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-secondary">Section</span>
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder={categories[0] ?? "General"}
              list="template-categories"
              className="w-44"
            />
            <datalist id="template-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <Button size="sm" onClick={addItem} disabled={pending || !newName.trim()}>
            <Plus /> Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-4 text-[13px] text-text-secondary">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={measurement}
              onChange={(e) => setMeasurement(e.target.checked)}
              className="size-4 accent-brand-primary"
            />
            Measurement (free-text value)
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={dual}
              onChange={(e) => setDual(e.target.checked)}
              className="size-4 accent-brand-primary"
            />
            Desktop + Mobile result
          </label>
        </div>
      </Card>
    </div>
  );
}
