import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Inbox } from "lucide-react";
import { cn } from "@/utils/cn";

interface StateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "muted" | "danger" | "success";
}

const TONE = {
  muted: "text-muted-foreground",
  danger: "text-destructive",
  success: "text-success",
} as const;

/** Generic centered state block used by empty / error / success variants. */
function StateBlock({ title, description, icon, action, className, tone = "muted" }: StateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card/40 p-8 text-center",
        className
      )}
    >
      {icon && <div className={cn("[&_svg]:size-8", TONE[tone])}>{icon}</div>}
      <div className="text-base font-medium text-foreground">{title}</div>
      {description && (
        <p className="max-w-[42ch] text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function EmptyState(props: Omit<StateProps, "tone" | "icon"> & { icon?: ReactNode }) {
  return <StateBlock tone="muted" icon={props.icon ?? <Inbox />} {...props} />;
}

export function ErrorState(props: Omit<StateProps, "tone" | "icon"> & { icon?: ReactNode }) {
  return <StateBlock tone="danger" icon={props.icon ?? <AlertTriangle />} {...props} />;
}

export function SuccessState(props: Omit<StateProps, "tone" | "icon"> & { icon?: ReactNode }) {
  return <StateBlock tone="success" icon={props.icon ?? <CheckCircle2 />} {...props} />;
}
