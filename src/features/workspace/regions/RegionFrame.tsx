"use client";

import { memo } from "react";
import { color, font, radius } from "@/config/tokens";
import type { BlockInstance, Region } from "@/features/workspace/types";
import { BlockFrame } from "@/features/workspace/blocks/BlockFrame";

interface RegionFrameProps {
  region: Region;
  /** Already virtualized to the visible subset. */
  blocks: BlockInstance[];
  selected: boolean;
  selectedBlockId: string | null;
  onSelectRegion: () => void;
  onSelectBlock: (blockId: string) => void;
}

const HEADER_H = 40;

/** Region = one explanation. Renders its chrome + hosted blocks. Memoized. */
export const RegionFrame = memo(function RegionFrame({
  region,
  blocks,
  selected,
  selectedBlockId,
  onSelectRegion,
  onSelectBlock,
}: RegionFrameProps) {
  const accent = region.accent ?? color.violet2;
  return (
    <section
      aria-label={`Explanation: ${region.title}`}
      style={{
        position: "absolute",
        left: region.position.x,
        top: region.position.y,
        width: region.size.w,
        height: region.size.h,
        borderRadius: radius.xl,
        border: `1px solid ${selected ? accent : color.border}`,
        background: "rgba(10,12,17,0.55)",
      }}
    >
      <button
        type="button"
        onClick={onSelectRegion}
        onFocus={onSelectRegion}
        className="ds-focus"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          borderBottom: `1px solid ${color.border}`,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flex: "none" }} />
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 13,
            fontWeight: 600,
            color: color.inkSoft,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {region.title}
        </span>
      </button>

      {/* block layer — blocks positioned relative to region origin */}
      {blocks.map((b) => (
        <BlockFrame
          key={b.id}
          block={b}
          selected={selectedBlockId === b.id}
          onSelect={() => onSelectBlock(b.id)}
        />
      ))}
    </section>
  );
});
