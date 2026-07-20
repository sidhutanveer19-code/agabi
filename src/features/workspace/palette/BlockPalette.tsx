"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Size } from "@/features/workspace/types";
import type { BlockCategory, BlockDefinition } from "@/features/workspace/blocks/types";
import { paletteBlockDefinitions } from "@/features/workspace/blocks/registry";
import { insertBlock } from "@/features/workspace/blocks/insertBlock";
import { color, font, radius, z as zTokens } from "@/config/tokens";

const CATEGORY_ORDER: BlockCategory[] = ["text", "list", "math", "media", "data", "structure", "diagram"];
const CATEGORY_LABEL: Record<BlockCategory, string> = {
  text: "Text", list: "Lists", math: "Math", media: "Media", data: "Data", structure: "Structure", diagram: "Diagram",
};

/**
 * DEV-ONLY block insert palette. A future AI drives the same `insertBlock` path;
 * this is the human authoring + verification surface. Never mounted in the
 * student build (its parent gates it on `DEV_MODE`).
 */
export function BlockPalette({ viewport }: { viewport: Size }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const defs = paletteBlockDefinitions();

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const match = (d: BlockDefinition) =>
      !query || `${d.label} ${(d.keywords ?? []).join(" ")}`.toLowerCase().includes(query);
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: defs.filter((d) => (d.category ?? "text") === cat && match(d)),
    })).filter((g) => g.items.length > 0);
  }, [defs, q]);

  return (
    <div style={{ position: "absolute", right: 18, bottom: 90, zIndex: zTokens.popover, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      {open && (
        <div style={{ width: 300, maxHeight: "60vh", display: "flex", flexDirection: "column", borderRadius: radius.lg, border: `1px solid ${color.border}`, background: "rgba(10,12,17,0.97)", boxShadow: "0 18px 50px rgba(0,0,0,.5)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, borderBottom: `1px solid ${color.border}` }}>
            <span style={{ fontFamily: font.mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: color.muted2 }}>Dev</span>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Insert block…"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: color.inkSoft, fontFamily: font.sans, fontSize: 13 }}
            />
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", color: color.muted3, cursor: "pointer" }}><X size={15} /></button>
          </div>
          <div style={{ overflow: "auto", padding: 8 }}>
            {groups.map((g) => (
              <div key={g.cat} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: font.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: color.muted2, padding: "4px 6px" }}>{CATEGORY_LABEL[g.cat]}</div>
                {g.items.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.type}
                      type="button"
                      onClick={() => insertBlock(d, viewport)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderRadius: radius.sm, border: "none", background: "transparent", color: color.inkSoft, fontFamily: font.sans, fontSize: 13, cursor: "pointer", textAlign: "left" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = color.surfaceHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {Icon ? <Icon size={15} /> : null}
                      {d.label}
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && <div style={{ padding: 12, color: color.muted, fontSize: 12 }}>No blocks match.</div>}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? "Close block palette" : "Insert block"}
        onClick={() => setOpen((o) => !o)}
        style={{ width: 44, height: 44, borderRadius: 999, border: `1px solid ${color.border}`, background: open ? color.violet : "rgba(10,12,17,0.9)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 8px 22px rgba(0,0,0,.45)" }}
      >
        <Plus size={20} style={{ transform: open ? "rotate(45deg)" : "none", transition: "transform .18s" }} />
      </button>
    </div>
  );
}
