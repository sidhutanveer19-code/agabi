import { useEffect, useRef } from "react";
import type { Agabi } from "@/lib/useAgabi";
import { composeQuickAnswer } from "@/lib/compose";

export default function QuickScreen({ a }: { a: Agabi }) {
  const { state } = a;
  const thinking = state.quickPhase === "thinking";

  // focus management: land on the question when the quick screen appears
  const headingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="ds-scroll" style={{ position: "absolute", inset: 0, zIndex: 4, overflowY: "auto" }}>
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 28px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ width: "100%", maxWidth: 600, animation: "v11in .6s cubic-bezier(.16,1,.3,1) both" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 26 }}>
            <span
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#8b8579",
              }}
            >
              Quick question
            </span>
            <button
              type="button"
              onClick={a.back}
              className="v11soft ds-focus"
              style={{
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: 9,
                color: "#8b8579",
                fontSize: 12.5,
                background: "transparent",
                border: "1px solid transparent",
                font: "inherit",
              }}
            >
              Close
            </button>
          </div>

          <div
            ref={headingRef}
            tabIndex={-1}
            className="ds-focus"
            style={{
              fontFamily: "var(--font-display, 'Fraunces', serif)",
              fontSize: 26,
              lineHeight: 1.3,
              color: "#F6F1E9",
              marginBottom: 22,
              outline: "none",
            }}
          >
            {state.goal}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: "rgba(56,189,248,.14)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                marginTop: 2,
              }}
            >
              <span style={{ color: "#38BDF8", fontSize: 12 }}>✦</span>
            </div>
            <div style={{ flex: 1 }} aria-live="polite" aria-busy={thinking}>
              {thinking ? (
                <div style={{ display: "flex", gap: 5, paddingTop: 8 }} aria-label="Thinking">
                  {[0, 0.2, 0.4].map((d, i) => (
                    <span
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#38BDF8",
                        animation: `v11dot 1.2s ease-in-out ${d}s infinite`,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ animation: "v11in .5s ease both" }}>
                  <div style={{ fontSize: 16, lineHeight: 1.65, color: "#D8D0C2" }}>
                    {composeQuickAnswer(state.goal)}
                  </div>
                  <div
                    style={{
                      marginTop: 22,
                      padding: "16px 18px",
                      border: "1px solid rgba(56,189,248,.28)",
                      background: "rgba(56,189,248,.06)",
                      borderRadius: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 14.5, color: "#B8E6FB" }}>
                      This deserves a full learning session.
                    </span>
                    <button
                      type="button"
                      onClick={a.escalate}
                      className="v11btn ds-focus"
                      style={{
                        cursor: "pointer",
                        padding: "10px 18px",
                        borderRadius: 11,
                        border: "1px solid rgba(56,189,248,.4)",
                        background: "rgba(56,189,248,.1)",
                        color: "#EAF6FB",
                        fontSize: 13.5,
                        whiteSpace: "nowrap",
                        font: "inherit",
                      }}
                    >
                      Open the canvas →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
