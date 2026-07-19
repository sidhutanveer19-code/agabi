"use client";

/**
 * App-level error boundary (Next App Router). A render crash in any screen
 * shows this recoverable fallback instead of a white screen.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        background: "#06070c",
        color: "#f3eee6",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 28,
        textAlign: "center",
        fontFamily: "var(--font-sans, sans-serif)",
      }}
    >
      <div style={{ fontFamily: "var(--font-display, serif)", fontSize: 28, color: "#f6f1e9" }}>
        Something interrupted the lesson.
      </div>
      <div style={{ color: "#8b8579", fontSize: 14, maxWidth: "44ch", lineHeight: 1.6 }}>
        Agabi hit an unexpected error. Your place is saved — try again.
      </div>
      <button
        type="button"
        onClick={reset}
        className="ds-focus"
        style={{
          marginTop: 6,
          padding: "10px 20px",
          borderRadius: 12,
          border: "1px solid rgba(167,139,250,.4)",
          background: "rgba(167,139,250,.14)",
          color: "#f6f1e9",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
