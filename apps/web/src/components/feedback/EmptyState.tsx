"use client";

/**
 * EmptyState - Empty content placeholder component
 *
 * Displays a message when a list/table/section has no content.
 * Supports custom icons, titles, descriptions, and CTA buttons.
 */

import { CSSProperties, ReactNode } from "react";
import { COLORS, SPACING, TYPOGRAPHY } from "@/lib/design-tokens";

export type EmptyStateVariant = "default" | "error" | "search" | "filtered";

interface EmptyStateProps {
  /** Main title text */
  title: string;
  /** Optional description text */
  description?: string;
  /** Custom icon element (defaults to box icon for each variant) */
  icon?: ReactNode;
  /** Visual variant */
  variant?: EmptyStateVariant;
  /** Call-to-action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Additional CSS styles */
  style?: CSSProperties;
  /** Additional CSS class */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: SPACING.xl,
};

const sizeStyles: Record<"sm" | "md" | "lg", { icon: number; title: string; desc: string; padding: string }> = {
  sm: { icon: 32, title: TYPOGRAPHY.size.sm, desc: TYPOGRAPHY.size.xs, padding: SPACING.md },
  md: { icon: 48, title: TYPOGRAPHY.size.lg, desc: TYPOGRAPHY.size.sm, padding: SPACING.xl },
  lg: { icon: 64, title: TYPOGRAPHY.size.xl, desc: TYPOGRAPHY.size.base, padding: SPACING["2xl"] },
};

const variantColors: Record<EmptyStateVariant, { icon: string; text: string }> = {
  default: { icon: COLORS.gray300, text: COLORS.gray500 },
  error: { icon: COLORS.errorLight, text: COLORS.errorDark },
  search: { icon: COLORS.primaryLight, text: COLORS.gray500 },
  filtered: { icon: COLORS.warningLight, text: COLORS.gray500 },
};

// Default SVG icons for each variant
function DefaultIcon({ variant, size }: { variant: EmptyStateVariant; size: number }) {
  const color = variantColors[variant].icon;

  if (variant === "error") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4m0 4h.01" />
      </svg>
    );
  }

  if (variant === "search") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    );
  }

  if (variant === "filtered") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
        <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
      </svg>
    );
  }

  // Default: inbox/box icon
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  variant = "default",
  action,
  style,
  className,
  size = "md",
}: EmptyStateProps) {
  const sizeConfig = sizeStyles[size];
  const colors = variantColors[variant];

  return (
    <div
      className={className}
      style={{
        ...containerStyle,
        padding: sizeConfig.padding,
        ...style,
      }}
    >
      <div style={{ marginBottom: SPACING.md }}>
        {icon ?? <DefaultIcon variant={variant} size={sizeConfig.icon} />}
      </div>

      <h3
        style={{
          margin: 0,
          marginBottom: description || action ? SPACING.xs : 0,
          fontSize: sizeConfig.title,
          fontWeight: 500,
          color: colors.text,
        }}
      >
        {title}
      </h3>

      {description && (
        <p
          style={{
            margin: 0,
            marginBottom: action ? SPACING.md : 0,
            fontSize: sizeConfig.desc,
            color: COLORS.gray400,
            maxWidth: "320px",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: `${SPACING.sm} ${SPACING.md}`,
            fontSize: TYPOGRAPHY.size.sm,
            fontWeight: 500,
            color: "white",
            backgroundColor: COLORS.primary,
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            transition: "background-color 150ms ease",
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = COLORS.primaryDark)}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = COLORS.primary)}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// Pre-configured empty state variants
export function EmptySearchResults({
  query,
  onClear,
}: {
  query?: string;
  onClear?: () => void;
}) {
  return (
    <EmptyState
      variant="search"
      title="No results found"
      description={query ? `No matches for "${query}"` : "Try adjusting your search"}
      action={onClear ? { label: "Clear search", onClick: onClear } : undefined}
    />
  );
}

export function EmptyFilteredResults({
  onClearFilters,
}: {
  onClearFilters?: () => void;
}) {
  return (
    <EmptyState
      variant="filtered"
      title="No matching items"
      description="Try adjusting or clearing your filters"
      action={onClearFilters ? { label: "Clear filters", onClick: onClearFilters } : undefined}
    />
  );
}

export function EmptyList({
  entityName,
  onAdd,
}: {
  entityName: string;
  onAdd?: () => void;
}) {
  return (
    <EmptyState
      variant="default"
      title={`No ${entityName} yet`}
      description={`There are no ${entityName} to display`}
      action={onAdd ? { label: `Add ${entityName}`, onClick: onAdd } : undefined}
    />
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      variant="error"
      title={title}
      description={description ?? "An error occurred while loading this content"}
      action={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
    />
  );
}
