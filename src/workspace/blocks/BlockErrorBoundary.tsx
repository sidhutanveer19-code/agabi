"use client";

import { Component, type ReactNode } from "react";
import { color, radius } from "@/design-system/tokens";

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  err: boolean;
}

/** A block that throws renders a quiet fallback — the workspace never blanks. */
export class BlockErrorBoundary extends Component<Props, State> {
  state: State = { err: false };

  static getDerivedStateFromError(): State {
    return { err: true };
  }

  render() {
    if (this.state.err) {
      return (
        <div
          role="alert"
          style={{
            padding: 16,
            border: `1px solid ${color.border}`,
            borderRadius: radius.md,
            background: color.surface,
            color: color.muted,
            fontSize: 13,
          }}
        >
          This {this.props.label ?? "block"} couldn&apos;t render.
        </div>
      );
    }
    return this.props.children;
  }
}
