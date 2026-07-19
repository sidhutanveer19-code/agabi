import type { CSSProperties } from "react";
import type { Agabi } from "@/lib/useAgabi";

const EASE = "cubic-bezier(.16,1,.3,1)";
const anim = (delay: number): CSSProperties => ({
  animation: `v11in .8s ${EASE} ${delay}s both`,
});

const door: CSSProperties = {
  cursor: "pointer",
  width: 266,
  padding: "22px 24px",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,.1)",
  background: "transparent",
  textAlign: "center",
};

export default function EntryScreen({ a }: { a: Agabi }) {
  const { state } = a;
  const showEx = state.phase === "entry" && !state.goal;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 28px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display, 'Fraunces', serif)",
          fontSize: 47,
          lineHeight: 1.16,
          letterSpacing: "-.015em",
          color: "#F6F1E9",
          textAlign: "center",
          maxWidth: "17ch",
          ...anim(0),
        }}
      >
        What would you like to understand today?
      </div>

      {/* writing surface */}
      <div style={{ position: "relative", width: "100%", maxWidth: 640, marginTop: 44, ...anim(0.12) }}>
        <div style={{ position: "relative", textAlign: "center" }}>
          <input
            className="v11in"
            value={state.goal}
            onChange={(e) => a.onGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                a.onKeyEnter();
              }
            }}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              textAlign: "center",
              fontFamily: "var(--font-display, 'Fraunces', serif)",
              fontSize: 27,
              color: "#F6F1E9",
              caretColor: "#A78BFA",
              padding: "6px 4px",
            }}
          />
          {showEx && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                fontFamily: "var(--font-display, 'Fraunces', serif)",
                fontSize: 27,
                color: "#6b6659",
                opacity: state.exOp,
                transition: "opacity .42s ease",
              }}
            >
              {a.example}
            </div>
          )}
        </div>
        <div
          style={{
            height: 1,
            marginTop: 8,
            background: "linear-gradient(90deg,transparent,rgba(167,139,250,.5),transparent)",
          }}
        />
      </div>

      {/* mic — voice as an equal citizen */}
      <div
        style={{
          marginTop: 28,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
          ...anim(0.2),
        }}
      >
        <div
          onClick={a.toggleMic}
          className="v11mic"
          style={{
            cursor: "pointer",
            position: "relative",
            width: 50,
            height: 50,
            borderRadius: "50%",
            border: `1px solid ${a.mic.border}`,
            background: a.mic.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: a.mic.color,
          }}
        >
          {state.listening && (
            <span
              style={{
                position: "absolute",
                inset: -1,
                borderRadius: "50%",
                border: "1px solid rgba(56,189,248,.5)",
                animation: "v11ring 1.6s ease-out infinite",
              }}
            />
          )}
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M6 11a6 6 0 0 0 12 0" />
            <path d="M12 17v4" />
          </svg>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 9.5,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: a.mic.hintColor,
          }}
        >
          {a.mic.hint}
        </span>
      </div>

      {/* two doors */}
      <div
        style={{
          marginTop: 52,
          display: "flex",
          gap: 26,
          flexWrap: "wrap",
          justifyContent: "center",
          ...anim(0.28),
        }}
      >
        <div onClick={a.learn} className="v11btn" style={door}>
          <div style={{ fontSize: 17, color: "#F3EEE6", marginBottom: 6 }}>Learn a topic</div>
          <div style={{ fontSize: 13, color: "#8b8579", lineHeight: 1.5 }}>
            I want to truly understand something.
          </div>
        </div>
        <div onClick={a.quick} className="v11btn" style={door}>
          <div style={{ fontSize: 17, color: "#F3EEE6", marginBottom: 6 }}>Quick question</div>
          <div style={{ fontSize: 13, color: "#8b8579", lineHeight: 1.5 }}>
            I only have one doubt.
          </div>
        </div>
      </div>
    </div>
  );
}
