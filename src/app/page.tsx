"use client";

import { useAgabi } from "@/hooks/useAgabi";
import EntryScreen from "@/features/entry/EntryScreen";
import QuickScreen from "@/features/quick/QuickScreen";
import CanvasScreen from "@/features/canvas/CanvasScreen";

export default function Home() {
  const a = useAgabi();
  const { phase } = a.state;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#06070c",
        color: "#F3EEE6",
        fontFamily: "var(--font-sans, 'DM Sans', sans-serif)",
        overflow: "hidden",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* ambient purple glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(60% 50% at 50% 32%,rgba(124,58,237,.1),transparent 72%)",
          pointerEvents: "none",
          animation: "v11drift 16s ease-in-out infinite",
        }}
      />
      {/* vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(130% 120% at 50% 40%,transparent 50%,rgba(0,0,0,.55) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* faint brand — hidden on canvas, which has its own AGABI chrome */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 30,
          zIndex: 5,
          display: phase === "canvas" ? "none" : "flex",
          alignItems: "center",
          gap: 9,
          opacity: 0.5,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "linear-gradient(150deg,#7C3AED,#A78BFA)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            color: "#fff",
          }}
        >
          ✦
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 10,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: "#8b8579",
          }}
        >
          Agabi
        </span>
      </div>

      {phase === "entry" && <EntryScreen a={a} />}
      {phase === "quick" && <QuickScreen a={a} />}
      {phase === "canvas" && <CanvasScreen a={a} />}
    </div>
  );
}
