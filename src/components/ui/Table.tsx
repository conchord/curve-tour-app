import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

export function TableScroll({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-w-full overflow-x-auto", className)} {...props} />;
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse border border-surface-hover bg-surface", className)} {...props} />;
}

export function TableHeadCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-surface-hover bg-surface-low px-3.5 py-2 text-left text-[0.68rem] font-semibold tracking-[0.08em] text-muted uppercase", className)} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-surface-hover px-3.5 py-2.5 align-middle", className)} {...props} />;
}

type TableRowTone = "default" | "advance" | "eliminate" | "lucky" | "tie";
const rowTones: Record<TableRowTone, string> = {
  default: "[&:last-child>td]:border-b-0",
  advance: "[&:last-child>td]:border-b-0 [&>td]:bg-success/3 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-success",
  eliminate: "[&:last-child>td]:border-b-0 [&>td]:bg-danger/3 [&>td]:opacity-70 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-danger",
  lucky: "[&:last-child>td]:border-b-0 [&>td]:bg-accent/4 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-accent",
  tie: "[&:last-child>td]:border-b-0 [&>td]:bg-danger/8 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-danger",
};

export function TableRow({ className, tone = "default", ...props }: HTMLAttributes<HTMLTableRowElement> & { tone?: TableRowTone }) {
  return <tr className={cn(rowTones[tone], className)} {...props} />;
}
