"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";
import { KeyboardShortcutProvider } from "./keyboard-shortcut-provider";
import { DialogProvider } from "./dialog-provider";
import { ToastProvider } from "./toast-provider";

/** Single composition of every global provider, mounted once in the root layout. */
export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <KeyboardShortcutProvider>
          <TooltipProvider delayDuration={200}>
            <DialogProvider>
              {children}
              <ToastProvider />
            </DialogProvider>
          </TooltipProvider>
        </KeyboardShortcutProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

export { useDialog } from "./dialog-provider";
export { useKeyboardShortcut } from "./keyboard-shortcut-provider";
