"use client";

import { resolveIcon } from "@/lib/icon-map";

interface IconProps {
  /** Lucide icon name (e.g. "cat", "map-pin") OR emoji fallback */
  name?: string;
  /** Size in pixels (default 18) */
  size?: number;
  /** CSS color */
  color?: string;
  /** Additional className */
  className?: string;
  /** aria-label for accessibility */
  "aria-label"?: string;
}

/**
 * Renders a Lucide icon by name with emoji fallback.
 *
 * If `name` maps to a Lucide icon in icon-map.ts, renders the SVG.
 * Otherwise, renders the raw string (emoji or text).
 *
 * Usage:
 *   <Icon name="cat" size={20} />
 *   <Icon name="🐱" />  // fallback to emoji
 */
export function Icon({ name, size = 18, color, className, "aria-label": ariaLabel }: IconProps) {
  if (!name) return null;

  const LucideIcon = resolveIcon(name);

  if (LucideIcon) {
    return (
      <LucideIcon
        size={size}
        color={color}
        className={className}
        aria-label={ariaLabel || name}
        aria-hidden={!ariaLabel}
        strokeWidth={1.75}
      />
    );
  }

  // Emoji/text fallback
  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
      className={className}
      style={{ fontSize: size * 0.9, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size }}
    >
      {name}
    </span>
  );
}
