"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Lucide icon name (left side) */
  icon?: string;
  /** Show loading spinner and disable */
  loading?: boolean;
  /** Full width */
  fullWidth?: boolean;
  children?: ReactNode;
}

const SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: { height: "var(--control-height-sm)", padding: "0 0.625rem", fontSize: "0.8rem", gap: "0.375rem", borderRadius: "5px" },
  md: { height: "var(--control-height)", padding: "0 1rem", fontSize: "0.875rem", gap: "0.5rem", borderRadius: "6px" },
  lg: { height: "var(--control-height-lg)", padding: "0 1.25rem", fontSize: "1rem", gap: "0.5rem", borderRadius: "8px" },
};

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    border: "1px solid var(--card-border)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
  },
  danger: {
    background: "var(--danger-bg)",
    color: "var(--danger-text)",
    border: "1px solid var(--danger-border)",
  },
  outline: {
    background: "transparent",
    color: "var(--text-primary)",
    border: "1px solid var(--card-border)",
  },
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

/**
 * Shared Button component.
 *
 * Variants: primary, secondary, ghost, danger, outline
 * Sizes: sm, md, lg
 *
 * Usage:
 *   <Button variant="primary" icon="plus" onClick={handleClick}>Add</Button>
 *   <Button variant="danger" loading={deleting}>Delete</Button>
 *   <Button variant="ghost" size="sm" icon="pencil" />
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      icon,
      loading = false,
      fullWidth = false,
      disabled,
      children,
      style,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    const sizeStyle = SIZE_STYLES[size];
    const variantStyle = VARIANT_STYLES[variant];
    const disabledStyle: React.CSSProperties = isDisabled
      ? {
          color: "var(--muted)",
          background: "var(--bg-secondary)",
          borderColor: "var(--border-light, var(--border))",
          cursor: "not-allowed",
        }
      : {};

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 500,
          cursor: isDisabled ? "not-allowed" : "pointer",
          transition: "background 150ms ease, box-shadow 150ms ease",
          width: fullWidth ? "100%" : undefined,
          whiteSpace: "nowrap",
          lineHeight: 1.4,
          ...sizeStyle,
          ...variantStyle,
          ...disabledStyle,
          ...style,
        }}
        {...rest}
      >
        {loading ? (
          <span
            style={{
              display: "inline-block",
              width: ICON_SIZE[size],
              height: ICON_SIZE[size],
              border: "2px solid currentColor",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "btn-spin 0.6s linear infinite",
            }}
          />
        ) : icon ? (
          <Icon name={icon} size={ICON_SIZE[size]} />
        ) : null}
        {children}
      </button>
    );
  },
);
