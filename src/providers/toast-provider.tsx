"use client";

import { Toaster } from "@/components/ui/sonner";

/** Global toast surface (sonner). */
export function ToastProvider() {
  return <Toaster position="bottom-center" richColors closeButton />;
}
