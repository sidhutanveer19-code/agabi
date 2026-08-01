"use client";

import { useState } from "react";
import { CanvasSidebar, CanvasSidebarTrigger, type CanvasSummary } from "@/features/workspace/sidebar/CanvasSidebar";
import { color, space, typography } from "@/config/tokens";

/** Dev-only harness for CanvasSidebar — mock data, no backend. Not linked anywhere. */
const MOCK: CanvasSummary[] = [
  { id: "c1", title: "Quadratic Equations", subject: "Mathematics", updatedAt: Date.now() - 1_000 },
  { id: "c2", title: "Projectile Motion", subject: "Physics", updatedAt: Date.now() - 60_000 },
  { id: "c3", title: "Acids and Bases", subject: "Chemistry", updatedAt: Date.now() - 3_600_000 },
  { id: "c4", title: "Causes of World War One — a long title that should ellipsize", subject: "History", updatedAt: Date.now() - 86_400_000 },
  { id: "c5", title: "Persuasive Essays", subject: "English", updatedAt: Date.now() - 172_800_000 },
];

export default function CanvasSidebarDevPage() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>("c1");
  const [empty, setEmpty] = useState(false);

  return (
    <main style={{ minHeight: "100vh", background: color.bg, color: color.ink, padding: space[8], fontFamily: typography.body.font }}>
      <CanvasSidebarTrigger onOpen={() => setOpen(true)} />
      <div style={{ display: "flex", flexDirection: "column", gap: space[4], maxWidth: 640 }}>
        <h1 style={{ ...typoLike("h3"), margin: 0 }}>CanvasSidebar — dev harness</h1>
        <p style={{ ...typoLike("body"), color: color.inkDim, margin: 0 }}>
          Click the menu button (top-left) or the button below. Active row is c1.
        </p>
        <div style={{ display: "flex", gap: space[3] }}>
          <button onClick={() => setOpen(true)} style={btn}>Open sidebar</button>
          <button onClick={() => setEmpty((e) => !e)} style={btn}>{empty ? "Use 5 canvases" : "Empty the list"}</button>
        </div>
        <p style={{ ...typoLike("caption"), color: color.muted3, margin: 0 }}>active: {activeId ?? "none"}</p>
      </div>

      <CanvasSidebar
        open={open}
        canvases={empty ? [] : MOCK}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setOpen(false); }}
        onNew={() => { setActiveId(null); setOpen(false); }}
        onClose={() => setOpen(false)}
      />
    </main>
  );
}

const typoLike = (r: "h3" | "body" | "caption") => ({
  fontSize: typography[r].size,
  fontWeight: typography[r].weight,
  fontFamily: typography[r].font,
  lineHeight: typography[r].lineHeight,
  letterSpacing: typography[r].tracking,
});

const btn: React.CSSProperties = {
  ...typoLike("body"),
  color: color.ink,
  background: color.surfaceHover,
  border: "none",
  borderRadius: 12,
  padding: `${space[2]}px ${space[4]}px`,
  cursor: "pointer",
};
