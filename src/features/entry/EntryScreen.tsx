import { useEffect, useRef, type CSSProperties } from "react";
import type { Agabi } from "@/hooks/useAgabi";
import { useSpeech } from "@/hooks/useSpeech";
import { color, easing, font } from "@/config/tokens";

const anim = (delay: number): CSSProperties => ({
  animation: `v11in .8s ${easing.standard} ${delay}s both`,
});

const door: CSSProperties = {
  width: 266,
  padding: "22px 24px",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,.1)",
  background: "transparent",
  textAlign: "center",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

export default function EntryScreen({ a }: { a: Agabi }) {
  const { state } = a;
  const showEx = state.phase === "entry" && !state.goal;

  const speech = useSpeech(
    (text) => a.onGoal(text),
    () => a.setListening(false)
  );
  useEffect(() => {
    if (state.listening) speech.start();
    else speech.stop();
  }, [state.listening, speech]);

  // focus management: land on the input when the entry screen appears
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const micUsable = speech.supported && !speech.denied;
  const micHint = !speech.supported
    ? "voice isn't supported here"
    : speech.denied
    ? "microphone blocked — enable it"
    : a.mic.hint;

  return (
    <div className="ds-scroll" style={{ position: "absolute", inset: 0, zIndex: 3, overflowY: "auto" }}>
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 28px",
          boxSizing: "border-box",
        }}
      >
        <h1
          className="agabi-hero"
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 47,
            fontWeight: 400,
            lineHeight: 1.16,
            letterSpacing: "-.015em",
            color: color.inkBright,
            textAlign: "center",
            maxWidth: "17ch",
            ...anim(0),
          }}
        >
          What would you like to understand today?
        </h1>

        {/* writing surface */}
        <div style={{ position: "relative", width: "100%", maxWidth: 640, marginTop: 44, ...anim(0.12) }}>
          <div style={{ position: "relative", textAlign: "center" }}>
            <input
              ref={inputRef}
              className="v11in"
              aria-label="What would you like to understand today?"
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
                fontFamily: font.display,
                fontSize: 27,
                color: color.inkBright,
                caretColor: color.violet2,
                padding: "6px 4px",
              }}
            />
            {showEx && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  fontFamily: font.display,
                  fontSize: 27,
                  color: color.placeholder,
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
          <button
            type="button"
            onClick={() => {
              if (micUsable) a.toggleMic();
            }}
            disabled={!micUsable}
            aria-label={state.listening ? "Stop voice input" : "Start voice input"}
            aria-pressed={state.listening}
            className="v11mic ds-focus"
            style={{
              cursor: micUsable ? "pointer" : "not-allowed",
              opacity: micUsable ? 1 : 0.5,
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
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: -1,
                  borderRadius: "50%",
                  border: "1px solid rgba(56,189,248,.5)",
                  animation: "v11ring 1.6s ease-out infinite",
                }}
              />
            )}
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M6 11a6 6 0 0 0 12 0" />
              <path d="M12 17v4" />
            </svg>
          </button>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: a.mic.hintColor,
            }}
          >
            {micHint}
          </span>
        </div>

        {/* two doors */}
        <div
          className="agabi-doors"
          style={{
            marginTop: 52,
            display: "flex",
            gap: 26,
            flexWrap: "wrap",
            justifyContent: "center",
            ...anim(0.28),
          }}
        >
          <button type="button" onClick={a.learn} className="v11btn ds-focus" style={door}>
            <div style={{ fontSize: 17, color: color.ink, marginBottom: 6 }}>Learn a topic</div>
            <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.5 }}>
              I want to truly understand something.
            </div>
          </button>
          <button type="button" onClick={a.quick} className="v11btn ds-focus" style={door}>
            <div style={{ fontSize: 17, color: color.ink, marginBottom: 6 }}>Quick question</div>
            <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.5 }}>
              I only have one doubt.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
