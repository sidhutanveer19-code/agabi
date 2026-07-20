"use client";

import { color, font, radius } from "@/config/tokens";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { TeachStatus } from "@/features/workspace/ai/types";
import type { TeachingError } from "@/features/workspace/ai/useTeaching";

const STATUS_META: Record<TeachStatus, { label: string; dot: string } | null> = {
  idle: null,
  thinking: { label: "Thinking", dot: color.violet2 },
  planning: { label: "Planning the lesson", dot: color.violet2 },
  generating: { label: "Teaching", dot: color.cyan },
  visualizing: { label: "Creating a visual", dot: color.green },
  finished: { label: "Done", dot: color.green },
  retrying: { label: "Retrying", dot: color.gold2 },
  cancelled: { label: "Stopped", dot: color.muted },
  error: { label: "Interrupted", dot: color.danger },
};

/**
 * Calm AI status pill. Shows what the teacher is doing (thinking / teaching /
 * creating a visual …) and, while streaming, a Stop control. Deliberately subtle
 * — never a loud spinner.
 */
export function StatusPill({
  status,
  streaming,
  onStop,
}: {
  status: TeachStatus;
  streaming: boolean;
  onStop: () => void;
}) {
  const reduced = useReducedMotion();
  const meta = STATUS_META[status];
  if (!meta || (status === "finished" && !streaming)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 12px 7px 11px",
        borderRadius: radius.pill,
        border: `1px solid ${color.border}`,
        background: "rgba(10,12,17,0.86)",
        backdropFilter: "blur(6px)",
        fontFamily: font.sans,
        fontSize: 12.5,
        color: color.inkSoft,
      }}
    >
      <style>{`@keyframes agabiPulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:1;transform:scale(1.5)}}`}</style>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: meta.dot,
          animation: streaming && !reduced ? "agabiPulse 1.1s ease-in-out infinite" : undefined,
          opacity: streaming ? 1 : 0.7,
        }}
      />
      {meta.label}
      {streaming && (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop teaching"
          style={{
            marginLeft: 4,
            border: `1px solid ${color.border}`,
            background: "transparent",
            color: color.muted3,
            borderRadius: radius.sm,
            fontSize: 11,
            padding: "2px 7px",
            cursor: "pointer",
            fontFamily: font.sans,
          }}
        >
          Stop
        </button>
      )}
    </div>
  );
}

/** Premium, student-friendly error card with recovery. */
export function TeachingErrorCard({
  error,
  onRetry,
  onDismiss,
}: {
  error: TeachingError;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 340,
        padding: 16,
        borderRadius: radius.lg,
        border: `1px solid ${color.danger}55`,
        background: "rgba(241,109,109,0.08)",
        backdropFilter: "blur(6px)",
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: color.inkBright }}>
        {error.recoverable ? "That didn't come through" : "Something went wrong"}
      </span>
      <span style={{ fontSize: 12.5, color: color.muted3, lineHeight: 1.5 }}>
        {error.message || "The lesson was interrupted. Nothing you've learned so far is lost."}
      </span>
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        {error.recoverable && (
          <button
            type="button"
            onClick={onRetry}
            style={{ padding: "6px 14px", borderRadius: radius.sm, border: "none", background: color.violet, color: "#fff", fontSize: 12.5, cursor: "pointer", fontFamily: font.sans }}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          style={{ padding: "6px 12px", borderRadius: radius.sm, border: `1px solid ${color.border}`, background: "transparent", color: color.muted3, fontSize: 12.5, cursor: "pointer", fontFamily: font.sans }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
