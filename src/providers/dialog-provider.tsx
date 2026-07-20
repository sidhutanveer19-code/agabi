"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}

interface DialogState {
  open: boolean;
  options: ConfirmOptions;
  resolve?: (value: boolean) => void;
}

/** Imperative confirm-dialog service over the shadcn Dialog primitive. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({ open: false, options: { title: "" } });

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ open: true, options, resolve })),
    []
  );

  const settle = useCallback((value: boolean) => {
    setState((s) => {
      s.resolve?.(value);
      return { ...s, open: false };
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(open: boolean) => !open && settle(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{state.options.title}</DialogTitle>
            {state.options.description && (
              <DialogDescription>{state.options.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => settle(false)}>
              {state.options.cancelText ?? "Cancel"}
            </Button>
            <Button
              variant={state.options.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {state.options.confirmText ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogContext.Provider>
  );
}
