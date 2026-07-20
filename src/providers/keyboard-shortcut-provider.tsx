"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type ShortcutHandler = (event: KeyboardEvent) => void;

interface ShortcutContextValue {
  register: (combo: string, handler: ShortcutHandler) => () => void;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

/** Normalize an event to a combo string, e.g. "mod+k", "shift+/". */
function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

/** Register a global keyboard shortcut for the lifetime of the calling component. */
export function useKeyboardShortcut(combo: string, handler: ShortcutHandler): void {
  const ctx = useContext(ShortcutContext);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!ctx) return;
    return ctx.register(combo, (e) => ref.current(e));
  }, [ctx, combo]);
}

export function KeyboardShortcutProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Map<string, Set<ShortcutHandler>>());

  const register = useCallback((combo: string, handler: ShortcutHandler) => {
    const key = combo.toLowerCase();
    const set = handlers.current.get(key) ?? new Set<ShortcutHandler>();
    set.add(handler);
    handlers.current.set(key, set);
    return () => {
      set.delete(handler);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const set = handlers.current.get(comboFromEvent(e));
      if (set) set.forEach((h) => h(e));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ register }), [register]);
  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}
