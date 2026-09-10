import type { ReactNode } from "react";
import { cn } from "./cn";

export function Timeline({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-1.5">{children}</div>;
}

export function TimelineItem({ children, label, state = "upcoming" }: { children: ReactNode; label: ReactNode; state?: "done" | "current" | "upcoming" }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn(
        "grid size-8 place-items-center rounded-full border-2 text-xs font-bold",
        state === "done" && "border-success bg-success-soft text-success",
        state === "current" && "border-primary bg-primary-soft text-primary shadow-[0_0_10px_rgb(0_229_255_/_27%)]",
        state === "upcoming" && "border-surface-hover text-muted",
      )}>{children}</div>
      <div className="max-w-17.5 text-center text-[0.65rem] text-muted">{label}</div>
    </div>
  );
}
