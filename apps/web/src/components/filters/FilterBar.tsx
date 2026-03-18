"use client";

import type { ReactNode } from "react";
import { COLORS, TYPOGRAPHY } from "@/lib/design-tokens";

interface FilterBarProps {
  children: ReactNode;
  showClear?: boolean;
  onClear?: () => void;
}

export function FilterBar({ children, showClear, onClear }: FilterBarProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      {children}

      {showClear && onClear && (
        <button
          type="button"
          onClick={onClear}
          style={{
            marginLeft: "auto",
            padding: "0.25rem 0.5rem",
            fontSize: TYPOGRAPHY.size.xs,
            color: COLORS.primary,
            background: "none",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
