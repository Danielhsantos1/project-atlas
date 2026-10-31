"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-fg-muted">
      {children}
    </label>
  );
}

export const inputClass =
  "h-8.5 w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 text-[13px] text-fg placeholder:text-fg-subtle transition-colors hover:border-ink-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, "cursor-pointer appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236c7584' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[10.5px] text-fg-muted">
      {children}
    </kbd>
  );
}
