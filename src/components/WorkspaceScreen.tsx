"use client";

import { useEffect, useMemo, useState } from "react";
import { color } from "@/design-system/tokens";
import { WorkspaceCanvas } from "@/workspace/canvas/WorkspaceCanvas";
import { useWorkspace } from "@/workspace/document/store";
import { useWorkspaceQuery } from "@/hooks/useWorkspaceQuery";
import { getServices, type Depth } from "@/services";
import { useSpeech } from "@/lib/useSpeech";
import type { BlockInstance } from "@/workspace/blocks";

export default function WorkspaceScreen({
  goal,
  onLeave,
}: {
  goal: string;
  onLeave: () => void;
}) {
  const [depth, setDepth] = useState<Depth>("normal");
  const [ask, setAsk] = useState("");
  const [voice, setVoice] = useState(false);

  const query = useWorkspaceQuery(goal, depth);
  const setDoc = useWorkspace((s) => s.setDoc);
  const appendBlocks = useWorkspace((s) => s.appendBlocks);
  const doc = useWorkspace((s) => s.doc);

  // load composed doc into the canvas + persist
  useEffect(() => {
    if (query.data) {
      setDoc(query.data);
      void getServices().persistence.save(query.data);
    }
  }, [query.data, setDoc]);

  const speech = useSpeech(
    (t) => setAsk(t),
    () => setVoice(false)
  );
  useEffect(() => {
    if (voice) speech.start();
    else speech.stop();
  }, [voice, speech]);

  const status = useMemo(() => {
    if (query.isFetching) return { text: "Composing your lesson…", dot: color.violet2 };
    if (voice) return { text: "Listening — interrupt anytime", dot: color.green };
    return { text: `Teaching · ${query.data?.subject ?? ""}`, dot: color.green };
  }, [query.isFetching, query.data?.subject, voice]);

  const askSubmit = () => {
    const text = ask.trim();
    if (!text || !doc) return;
    const lastY = doc.blocks.reduce((m, b) => Math.max(m, b.layout.y + b.layout.h), 40);
    const note: BlockInstance = {
      id: `ask-${doc.blocks.length}`,
      type: "callout",
      layout: { x: 80, y: lastY + 40, w: 560, h: 100 },
      data: { tone: "idea", title: "You asked", body: text },
    };
    appendBlocks([note]);
    setAsk("");
  };

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
      {/* chrome */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 26px 8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontWeight: 700, letterSpacing: ".18em", fontSize: 15, color: color.inkSoft }}>
            AGABI
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: status.dot,
                animation: "v11drift 1.8s ease-in-out infinite",
              }}
            />
            <span style={{ fontSize: 13, color: color.muted }}>{status.text}</span>
          </span>
        </div>
        <div
          onClick={onLeave}
          className="v11soft"
          style={{ cursor: "pointer", padding: "7px 12px", borderRadius: 9, color: color.muted, fontSize: 12.5 }}
        >
          ← Leave
        </div>
      </div>

      {/* infinite block canvas */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
        <WorkspaceCanvas />
      </div>

      {/* teaching bar */}
      <div style={{ position: "relative", zIndex: 3, padding: "8px 0 20px" }}>
        <div className="teachpill">
          <div className="askwrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7f7a6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z" />
            </svg>
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  askSubmit();
                }
              }}
              placeholder="Ask, interrupt, or challenge anything… Agabi adds it to the canvas."
            />
          </div>
          <div className="ctrls">
            <button className={`ctrl ${voice ? "on" : ""}`} onClick={() => setVoice((v) => !v)} aria-label="Voice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M6 11a6 6 0 0 0 12 0" />
                <path d="M12 17v4" />
              </svg>
              <span className="tip">{voice ? "Voice off" : "Voice on"}</span>
            </button>
            <button className="ctrl" onClick={() => setDepth("normal")} aria-label="Explain again">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v5h-5" />
              </svg>
              <span className="tip">Explain again</span>
            </button>
            <button className={`ctrl ${depth === "simpler" ? "on" : ""}`} onClick={() => setDepth("simpler")} aria-label="Simpler">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z" />
              </svg>
              <span className="tip">Make it simpler</span>
            </button>
            <button className={`ctrl ${depth === "deeper" ? "on" : ""}`} onClick={() => setDepth("deeper")} aria-label="Deeper">
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
