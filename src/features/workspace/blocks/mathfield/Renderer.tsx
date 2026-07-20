"use client";

import { useEffect, useRef } from "react";
import { MathfieldElement } from "mathlive";
import "mathlive/fonts.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

export interface MathfieldData {
  latex: string;
}

/**
 * MathLive equation editor (lazy-loaded). The heavy `MathfieldElement` custom
 * element is created imperatively (avoids the `<math-field>` JSX intrinsic and
 * its TS typing pain). Editable in dev; read-only in present. All state lives in
 * `data.latex`, persisted through `onChange`.
 */
export default function MathfieldRenderer({ block, editing, onChange }: BlockRendererProps<MathfieldData>) {
  const data = block.data ?? { latex: "" };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mfRef = useRef<MathfieldElement | null>(null);

  // Latest callbacks/props held in refs so the mount effect runs exactly once.
  const onChangeRef = useRef(onChange);
  const latexRef = useRef(data.latex);
  useEffect(() => {
    onChangeRef.current = onChange;
    latexRef.current = data.latex;
  });

  // Create the MathfieldElement once, on mount. Cleaned up on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mf = new MathfieldElement();
    mf.value = latexRef.current;
    // Chrome: no menu, no sound, calm virtual-keyboard behaviour (present-safe).
    mf.menuItems = [];
    MathfieldElement.soundsDirectory = null;
    mf.style.width = "100%";
    mf.style.border = "none";
    mf.style.background = "transparent";
    mf.style.fontSize = "20px";

    const handleInput = () => {
      const next = mf.value;
      latexRef.current = next;
      onChangeRef.current?.({ latex: next });
    };
    mf.addEventListener("input", handleInput);

    host.appendChild(mf);
    mfRef.current = mf;

    return () => {
      mf.removeEventListener("input", handleInput);
      mf.remove();
      mfRef.current = null;
    };
  }, []);

  // Toggle editability when the mode flips.
  useEffect(() => {
    const mf = mfRef.current;
    if (mf) mf.readOnly = !editing;
  }, [editing]);

  // Adopt external latex changes without clobbering the caret while typing.
  useEffect(() => {
    const mf = mfRef.current;
    if (mf && mf.value !== data.latex) mf.value = data.latex;
  }, [data.latex]);

  return (
    <div
      role="math"
      aria-label={data.latex ? `Equation: ${data.latex}` : "Math equation editor"}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        padding: `${space[3]}px ${space[4]}px`,
        borderRadius: radius.lg,
        border: `1px solid ${color.border}`,
        background: color.paper,
        color: color.ink,
        fontFamily: font.sans,
        overflow: "auto",
        // Theme MathLive's CSS custom properties to the dark Agabi palette.
        // @ts-expect-error — MathLive design tokens are valid CSS custom props.
        "--primary": color.violet2,
        "--caret-color": color.violet2,
        "--selection-background-color": "rgba(167,139,250,0.28)",
        "--contains-highlight-background-color": "rgba(167,139,250,0.14)",
        "--text-font-family": font.sans,
        "--smart-fence-color": color.muted3,
      }}
      ref={hostRef}
    />
  );
}
