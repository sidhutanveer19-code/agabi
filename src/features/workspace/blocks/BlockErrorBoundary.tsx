"use client";

import { Component, type ReactNode } from "react";
import { color, font, radius } from "@/config/tokens";

interface Props {
  /** Identifies the failed block in the fallback + console. */
  label: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Per-block error boundary. A single misbehaving block must never blank the whole
 * workspace — it degrades to a small inline fallback while everything else keeps
 * rendering. (Section 13: never a blank broken workspace.)
 */
export class BlockErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface for debugging without crashing the tree.
    console.error(`[workspace] block "${this.props.label}" failed to render:`, error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
            borderRadius: radius.md,
            border: `1px solid ${color.danger}`,
            background: "rgba(241,109,109,0.08)",
            color: color.danger,
            fontFamily: font.mono,
            fontSize: 11,
            textAlign: "center",
          }}
        >
          Block failed to render
        </div>
      );
    }
    return this.props.children;
  }
}
