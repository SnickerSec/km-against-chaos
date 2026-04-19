"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "success" | "vote" | "secondary";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:   "bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-400 disabled:shadow-none text-white hover-glow-purple",
  success:   "bg-green-700  hover:bg-green-800  disabled:bg-gray-700 disabled:text-gray-400 disabled:shadow-none text-white hover-glow-green",
  vote:      "bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 disabled:text-gray-400 disabled:shadow-none text-white hover-glow-yellow",
  secondary: "bg-gray-700   hover:bg-gray-600   disabled:bg-gray-800 disabled:text-gray-400 text-gray-200",
};

const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs font-medium rounded",
  md: "px-4 py-2 text-sm font-medium rounded-lg",
  lg: "px-8 py-3 text-lg font-semibold rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", fullWidth, className = "", children, ...rest },
  ref,
) {
  const width = fullWidth ? "w-full block" : "";
  const base = "inline-flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed";
  return (
    <button ref={ref} className={`${base} ${VARIANT[variant]} ${SIZE[size]} ${width} ${className}`} {...rest}>
      {children}
    </button>
  );
});

export default Button;
