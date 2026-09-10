import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export const controlClassName = "w-full rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlClassName, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(controlClassName, "min-h-28 resize-y leading-7", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(controlClassName, className)} {...props} />;
});

export function Field({ children, className, htmlFor, label }: { children: ReactNode; className?: string; htmlFor?: string; label: ReactNode }) {
  return (
    <div className={cn("mb-3", className)}>
      <label className="mb-1 block text-[0.72rem] font-semibold tracking-[0.08em] text-muted uppercase" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function FieldDisplay({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(controlClassName, className)} {...props} />;
}

export function ScoreInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input className={cn("w-22.5 px-2 py-1 text-center text-lg font-bold", className)} type="number" {...props} />;
}
