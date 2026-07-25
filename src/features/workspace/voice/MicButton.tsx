"use client";

import { color, radius, font } from "@/config/tokens";
import { useVoice } from "@/features/workspace/voice/useVoice";

/**
 * The small mic on/off button on the canvas — the whole voice UI. On = talk to Agabi and hear it back
 * (barge-in stops it instantly when you speak). Hidden entirely if the browser has no speech support.
 */
export function MicButton({ ask, cancel }: { ask: (t: string) => void; cancel: () => void }) {
  const { supported, active, toggle } = useVoice({ ask, cancel });
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={active ? "Turn voice off" : "Turn voice on"}
      aria-pressed={active}
      title={active ? "Voice on — talk to Agabi (speak again to interrupt)" : "Talk to Agabi"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        borderRadius: radius.pill,
        border: `1px solid ${active ? color.violet : color.border}`,
        background: active ? color.violet : "rgba(10,12,17,0.86)",
        color: active ? "#fff" : color.inkSoft,
        cursor: "pointer",
        fontFamily: font.sans,
        backdropFilter: "blur(6px)",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      <style>{`@keyframes agabiMic{0%,100%{opacity:.55}50%{opacity:1}}`}</style>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: active ? "agabiMic 1.1s ease-in-out infinite" : undefined }}>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );
}
