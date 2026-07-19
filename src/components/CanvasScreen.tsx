import { useEffect, useRef } from "react";
import TeachingBoard from "@/components/TeachingBoard";
import type { Agabi } from "@/lib/useAgabi";
import { useSpeech } from "@/lib/useSpeech";

export default function CanvasScreen({ a }: { a: Agabi }) {
  const { state } = a;

  const speech = useSpeech(
    (text) => a.onAsk(text),
    () => a.setVoice(false)
  );
  useEffect(() => {
    if (state.voice) speech.start();
    else speech.stop();
  }, [state.voice, speech]);

  // focus management: land on the "ask" input when the canvas appears
  const askRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    askRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        display: "flex",
        flexDirection: "column",
        animation: "v11paper 1s cubic-bezier(.16,1,.3,1) both",
      }}
    >
      {/* dotted paper */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,.028) 1px,transparent 1px)",
          backgroundSize: "28px 28px",
          pointerEvents: "none",
        }}
      />

      {/* chrome */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 26px 4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontWeight: 700, letterSpacing: ".18em", fontSize: 15, color: "#EDE8DF" }}>
            AGABI
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: a.status.dot,
                animation: "v11drift 1.8s ease-in-out infinite",
              }}
            />
            <span aria-live="polite" style={{ fontSize: 13, color: "#8b8579" }}>
              {a.status.text}
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={a.back}
          className="v11soft ds-focus"
          style={{
            cursor: "pointer",
            padding: "7px 12px",
            borderRadius: 9,
            color: "#8b8579",
            fontSize: 12.5,
            background: "transparent",
            border: "1px solid transparent",
            font: "inherit",
          }}
        >
          ← Leave
        </button>
      </div>

      {/* the board draws itself */}
      <TeachingBoard lesson={a.lesson} slots={a.slots} drawing={state.drawing} paused={state.paused} />

      {/* teaching bar */}
      <div style={{ position: "relative", zIndex: 3, padding: "8px 0 20px" }}>
        <div className="teachpill">
          <div className="askwrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7f7a6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z" />
            </svg>
            <input
              ref={askRef}
              aria-label="Ask, interrupt, or challenge anything"
              value={state.ask}
              onChange={(e) => a.onAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  a.askEnter();
                }
              }}
              placeholder="You can ask, interrupt, challenge anything… Agabi will adapt instantly."
            />
          </div>
          <div className="ctrls">
            <button type="button" aria-label={state.voice ? "Voice off" : "Voice on"} aria-pressed={state.voice} className={`ctrl ds-focus ${state.voice ? "on" : ""}`} onClick={a.toggleVoice}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M6 11a6 6 0 0 0 12 0" />
                <path d="M12 17v4" />
              </svg>
              <span className="tip">{state.voice ? "Voice off" : "Voice on"}</span>
            </button>
            <button type="button" aria-label={state.paused ? "Resume teaching" : "Pause teaching"} aria-pressed={state.paused} className={`ctrl ds-focus ${state.paused ? "on" : ""}`} onClick={a.togglePause}>
              {state.paused ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 4 L20 12 L7 20 Z" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M9 5 L9 19" />
                  <path d="M15 5 L15 19" />
                </svg>
              )}
              <span className="tip">{state.paused ? "Resume teaching" : "Pause teaching"}</span>
            </button>
            <button type="button" aria-label="Explain a different way" className="ctrl ds-focus" onClick={a.explainAgain}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v5h-5" />
              </svg>
              <span className="tip">Explain a different way</span>
            </button>
            <button type="button" aria-label="Make it simpler" className="ctrl ds-focus" onClick={a.simpler}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z" />
              </svg>
              <span className="tip">Make it simpler</span>
            </button>
            <button type="button" aria-label="Go deeper" className="ctrl ds-focus" onClick={a.deeper}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 L21 8 L12 13 L3 8 Z" />
                <path d="M3 13 L12 18 L21 13" />
              </svg>
              <span className="tip">Go deeper</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
