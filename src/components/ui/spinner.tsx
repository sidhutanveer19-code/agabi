import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

/** Indeterminate loading spinner. */
export function Spinner({
  className,
  size = 18,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      width={size}
      height={size}
      className={cn("animate-spin text-primary", className)}
      {...props}
    />
  );
}
