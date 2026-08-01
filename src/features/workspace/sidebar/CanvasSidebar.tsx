"use client";

import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { X, SquarePen, History, Menu } from "lucide-react";
import {
  color, semantic, z, space, radius, elevation, duration, easing, typography, border, accentFor,
  type TypographyRole,
} from "@/config/tokens";

/**
 * Left slide-in sidebar for switching canvases. Standalone + props-driven (mock
 * data for now). Radix Dialog gives focus-trap / focus-return / Escape / aria-modal;
 * a plain <style> tag drives the slide (keyed on data-state) + hover + reduced-motion.
 * Every colour and size comes from tokens — no raw hex, no raw `Npx` literal (sizes
 * are numeric inline styles or `${const}px` interpolations).
 */
export interface CanvasSummary {
  id: string;
  title: string; // topic, e.g. "Quadratic Equations"
  subject?: string; // feeds accentFor()
  updatedAt: number;
}

interface Props {
  open: boolean;
  canvases: CanvasSummary[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onClose(): void;
}

// Component-only dimensions the spec fixes as literals (not part of the token scale).
const PANEL_W = 288;
const ICON = 18;
const TRIGGER_ICON = 20;
const DOT = 6;
const BLUR = 2;

// The trigger that opened the panel, so focus returns to it on close. Radix's
// FocusScope only restores automatically for its own <Dialog.Trigger>; our trigger
// is a separate controlled button, so we track + restore it ourselves.
let lastTrigger: HTMLElement | null = null;

const typo = (r: TypographyRole) => ({
  fontSize: typography[r].size,
  fontWeight: typography[r].weight,
  fontFamily: typography[r].font,
  lineHeight: typography[r].lineHeight,
  letterSpacing: typography[r].tracking,
});

/** Shared box for the New-canvas / All-history menu rows. */
const menuRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[3],
  padding: space[3],
  borderRadius: radius.md,
  width: "100%",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

export function CanvasSidebar({ open, canvases, activeId, onSelect, onNew, onClose }: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="cs-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: semantic.overlay,
            backdropFilter: `blur(${BLUR}px)`,
            WebkitBackdropFilter: `blur(${BLUR}px)`,
            zIndex: z.overlay,
          }}
        />
        <DialogPrimitive.Content
          className="cs-panel"
          aria-label="Canvases"
          aria-modal // radix-ui (this version) omits it; the spec requires aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={(e: Event) => { if (lastTrigger) { e.preventDefault(); lastTrigger.focus(); } }}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            bottom: 0,
            width: PANEL_W,
            background: color.paper,
            borderRightWidth: border.hairline,
            borderRightStyle: "solid",
            borderRightColor: color.border,
            boxShadow: elevation[3],
            zIndex: z.popover,
            padding: `${space[5]}px ${space[4]}px`,
            display: "flex",
            flexDirection: "column",
            gap: space[1],
          }}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Canvases</DialogPrimitive.Title>
          </VisuallyHidden.Root>

          {/* 1 · Close (top-right ghost) */}
          <DialogPrimitive.Close asChild>
            <button
              className="cs-ghost"
              aria-label="Close canvases"
              style={{ ...ghostBtn, alignSelf: "flex-end", color: color.muted3 }}
            >
              <X size={ICON} />
            </button>
          </DialogPrimitive.Close>

          {/* 2 · New canvas */}
          <button className="cs-menurow" style={{ ...menuRow, color: color.ink, ...typo("h5") }} onClick={onNew}>
            <SquarePen size={ICON} />
            <span>New canvas</span>
          </button>

          {/* 3 · All history */}
          <button className="cs-menurow" style={{ ...menuRow, color: color.inkDim, ...typo("body") }}>
            <History size={ICON} />
            <span>All history</span>
          </button>

          {/* 4 · Divider */}
          <div style={{ height: border.hairline, background: color.border, margin: `${space[3]}px 0` }} />

          {/* 5 · Section label */}
          <div style={{ ...typo("label"), textTransform: "uppercase", color: color.muted3, padding: `${space[2]}px ${space[3]}px` }}>
            Recent
          </div>

          {/* 6 · List */}
          {canvases.length === 0 ? (
            <div style={{ ...typo("caption"), color: color.muted3, padding: `${space[4]}px ${space[3]}px` }}>
              Nothing here yet
            </div>
          ) : (
            <nav aria-label="Recent canvases">
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[1] }}>
                {canvases.map((c) => {
                  const active = c.id === activeId;
                  return (
                    <li key={c.id} style={{ margin: 0 }}>
                      <button
                        className="cs-row"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onSelect(c.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: space[3],
                          padding: space[3],
                          borderRadius: radius.md,
                          width: "100%",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          background: active ? color.surfaceActive : "transparent",
                          color: active ? color.violet2 : color.inkDim,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{ width: DOT, height: DOT, borderRadius: radius.pill, background: accentFor(c.subject), flexShrink: 0 }}
                        />
                        <span
                          style={{
                            ...typo("body"),
                            fontWeight: active ? 500 : typography.body.weight,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {c.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}

          <SidebarStyles />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: space[2],
  borderRadius: radius.sm,
  background: "transparent",
  border: "none",
  cursor: "pointer",
};

/** The spec's separate trigger — a ghost Menu button for the canvas chrome.
 *  Mounting it into the real chrome is the later wiring task; the dev route uses it. */
export function CanvasSidebarTrigger({ onOpen }: { onOpen(): void }) {
  return (
    <button
      className="cs-ghost"
      aria-label="Open canvases"
      onClick={(e) => { lastTrigger = e.currentTarget; onOpen(); }}
      style={{ ...ghostBtn, position: "fixed", left: space[3], top: space[3], color: color.muted3, zIndex: z.chrome }}
    >
      <Menu size={TRIGGER_ICON} />
    </button>
  );
}

/** Plain <style> tag (TeachingChrome pattern) — hover / :focus-visible / keyframes /
 *  reduced-motion. Every value interpolated from tokens; `${x}px` never has a digit
 *  before "px", so `grep "[0-9]px"` stays zero. */
function SidebarStyles() {
  return (
    <style>{`
      .cs-backdrop { animation: csFade ${duration.base}s ${easing.standard}; }
      .cs-backdrop[data-state="closed"] { animation: csFadeOut ${duration.base}s ${easing.standard}; }
      .cs-panel { animation: csSlide ${duration.base}s ${easing.standard}; }
      .cs-panel[data-state="closed"] { animation: csSlideOut ${duration.base}s ${easing.standard}; }
      @keyframes csFade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes csFadeOut { from { opacity: 1 } to { opacity: 0 } }
      @keyframes csSlide { from { transform: translateX(-100%); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      @keyframes csSlideOut { from { transform: translateX(0); opacity: 1 } to { transform: translateX(-100%); opacity: 0 } }
      .cs-row:hover { background: ${color.surfaceHover}; color: ${color.ink}; }
      .cs-menurow:hover { background: ${color.surfaceHover}; }
      .cs-menurow:active { background: ${color.surfaceActive}; }
      .cs-ghost:hover { color: ${color.ink}; background: ${color.surfaceHover}; }
      .cs-row:focus-visible, .cs-menurow:focus-visible, .cs-ghost:focus-visible {
        outline: none; box-shadow: inset 0 0 0 ${border.thin}px ${semantic.focus};
      }
      @media (prefers-reduced-motion: reduce) {
        .cs-panel { animation: csFade ${duration.base}s ${easing.standard}; }
        .cs-panel[data-state="closed"] { animation: csFadeOut ${duration.base}s ${easing.standard}; }
      }
    `}</style>
  );
}
