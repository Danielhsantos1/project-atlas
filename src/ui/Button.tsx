"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover shadow-[0_0_0_1px_rgb(47_128_255/0.6),0_6px_20px_-6px_rgb(47_128_255/0.6)]",
  secondary: "bg-ink-750 text-fg border border-ink-600 hover:bg-ink-700 hover:border-ink-500",
  ghost: "text-fg-muted hover:text-fg hover:bg-ink-750",
  danger: "bg-danger/90 text-white hover:bg-danger",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8.5 px-3.5 text-[13px]",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
}

/** Botão de ícone com rótulo acessível e dica (atalho incluído). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35",
        active ? "bg-accent-soft text-accent ring-1 ring-accent-line" : "text-fg-muted hover:bg-ink-700 hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
