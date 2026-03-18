"use client";

import { COLORS } from "@/lib/design-tokens";

export function FilterDivider() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "1px",
        height: "1.2rem",
        backgroundColor: COLORS.border,
        flexShrink: 0,
      }}
    />
  );
}
