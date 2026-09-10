import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type BadgeTone = "success" | "danger" | "neutral" | "primary" | "accent" | "warning";
const tones: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-muted/10 text-muted",
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/10 text-accent",
  warning: "bg-warning/10 text-warning",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tracking-[0.08em] uppercase", tones[tone], className)} {...props} />;
}
