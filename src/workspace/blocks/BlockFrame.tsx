"use client";

import type { ReactNode } from "react";
import { radius, z } from "@/design-system/tokens";

export interface BlockFrameProps {
  x: number;
  y: number;
  w: number;
  h?: number;
  selected?: boolean;
  label: string;
  onSelect?: () => void;
  children: ReactNode;
}

/**
 * Positions a block in canvas coordinate space and handles selection + a11y.
 * Blocks are absolutely placed; the canvas applies the pan/zoom transform above.
 */
export function BlockFrame({ x, y, w, h, selected, label, onSelect, children }: BlockFrameProps) {
  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      className="ds-focus"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        minHeight: h,
        zIndex: selected ? z.blockSelected : z.block,
        borderRadius: radius.lg,
        outline: selected ? "2px solid rgba(167,139,250,.5)" : undefined,
        outlineOffset: 4,
      }}
    >
      {children}
    </div>
  );
}
