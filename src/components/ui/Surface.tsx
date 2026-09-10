import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 rounded-lg border border-surface-hover bg-surface px-5 py-4 shadow-[0_14px_40px_var(--shadow-card)] max-[700px]:px-4", className)} {...props} />;
}

export function PanelTitle({ children, className, hint }: { children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className={cn("mb-3.5 text-[0.72rem] font-semibold tracking-[0.12em] text-muted uppercase", className)}>
      {children}
      {hint ? <span className="text-xs font-normal tracking-normal normal-case"> {hint}</span> : null}
    </div>
  );
}

export function TwoColumnGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 grid grid-cols-1 gap-4 min-[701px]:grid-cols-2", className)} {...props} />;
}
