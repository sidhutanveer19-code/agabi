"use client";

import { z } from "zod";
import { List, ListOrdered, ListChecks } from "lucide-react";
import type { BlockDefinition, BlockRendererProps, BlockIcon } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { createId } from "@/features/workspace/utils/ids";
import { color, font } from "@/config/tokens";

export interface ListItem {
  id: string;
  text: string;
  checked?: boolean;
}
export interface ListData {
  items: ListItem[];
}

const schema = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string(), checked: z.boolean().optional() })),
}) as z.ZodType<ListData>;

type Variant = "bullet" | "numbered" | "checklist";

interface ListPreset {
  type: Variant;
  label: string;
  icon: BlockIcon;
}
const PRESETS: ListPreset[] = [
  { type: "bullet", label: "Bullet List", icon: List },
  { type: "numbered", label: "Numbered List", icon: ListOrdered },
  { type: "checklist", label: "Checklist", icon: ListChecks },
];

function ListBlock({ block, editing, onChange }: BlockRendererProps<ListData>) {
  const variant = block.type as Variant;
  const items = block.data?.items ?? [];

  const patch = (next: ListItem[]) => onChange?.({ items: next });
  const setText = (id: string, text: string) => patch(items.map((it) => (it.id === id ? { ...it, text } : it)));
  const toggle = (id: string) => patch(items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));
  const addAfter = (id: string) => {
    const idx = items.findIndex((it) => it.id === id);
    const next = [...items];
    next.splice(idx + 1, 0, { id: createId("li"), text: "", checked: variant === "checklist" ? false : undefined });
    patch(next);
  };
  const remove = (id: string) => patch(items.filter((it) => it.id !== id));

  return (
    <div style={{ width: "100%", height: "100%", padding: 8, overflow: "auto" }}>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          counterReset: "agabi-li",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {items.map((it, i) => (
          <li key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, color: color.inkSoft, fontFamily: font.sans, fontSize: 15, lineHeight: 1.6 }}>
            <span aria-hidden style={{ userSelect: "none", color: color.muted3, minWidth: 18, marginTop: 1 }}>
              {variant === "numbered" ? `${i + 1}.` : variant === "bullet" ? "•" : null}
            </span>
            {variant === "checklist" && (
              <input
                type="checkbox"
                checked={!!it.checked}
                disabled={!editing}
                onChange={() => toggle(it.id)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="toggle item"
                style={{ marginTop: 3, accentColor: color.violet2 }}
              />
            )}
            {editing ? (
              <input
                value={it.text}
                onChange={(e) => setText(it.id, e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addAfter(it.id); }
                  if (e.key === "Backspace" && it.text === "" && items.length > 1) { e.preventDefault(); remove(it.id); }
                }}
                placeholder="List item…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: it.checked ? color.muted : color.inkSoft,
                  textDecoration: it.checked ? "line-through" : "none",
                  font: "inherit",
                }}
              />
            ) : (
              <span style={{ flex: 1, color: it.checked ? color.muted : color.inkSoft, textDecoration: it.checked ? "line-through" : "none" }}>
                {it.text}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function registerListBlocks(): void {
  for (const p of PRESETS) {
    if (hasBlock(p.type)) continue;
    const def: BlockDefinition<ListData> = {
      type: p.type,
      label: p.label,
      category: "list",
      icon: p.icon,
      version: 1,
      component: ListBlock,
      schema,
      create: () => ({ items: [{ id: createId("li"), text: "", checked: p.type === "checklist" ? false : undefined }] }),
      defaultSize: { w: 460, h: 140 },
      interactive: true,
      resizable: true,
      keywords: [p.label.toLowerCase(), "list", "items"],
    };
    registerBlock(def);
  }
}
