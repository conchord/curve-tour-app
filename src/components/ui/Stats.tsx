import type { ReactNode } from "react";
import { cn } from "./cn";

export function StatStrip({ items }: { items: Array<{ label: ReactNode; value: ReactNode; valueClassName?: string }> }) {
  return (
    <div className="mb-4.5 flex flex-wrap gap-7 rounded-lg border border-surface-hover bg-surface px-4.5 py-3 shadow-[0_10px_30px_var(--shadow-card)]">
      {items.map((item, index) => (
        <div className="flex flex-col gap-0.5" key={index}>
          <span className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted uppercase">{item.label}</span>
          <strong className={cn("text-xl font-bold", item.valueClassName)}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
