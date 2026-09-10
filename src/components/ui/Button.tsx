import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "warning" | "accent" | "ghost";
type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-surface-hover bg-surface-low text-foreground hover:border-primary/50 hover:bg-surface-hover",
  success: "bg-success text-on-primary hover:brightness-110",
  danger: "bg-danger text-white hover:brightness-110",
  warning: "bg-warning text-on-primary hover:brightness-110",
  accent: "bg-accent text-on-primary hover:brightness-110",
  ghost: "bg-transparent text-muted hover:bg-surface-low hover:text-foreground",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 py-1 text-xs",
  md: "min-h-10 px-4 py-2 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, size = "md", type = "button", variant = "secondary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[5px] font-semibold tracking-[0.02em] transition duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-35",
        variants[variant],
        sizes[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function ButtonRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-3.5 flex flex-wrap gap-2.5", className)} {...props} />;
}
