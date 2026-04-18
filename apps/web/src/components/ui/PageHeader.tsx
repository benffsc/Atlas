"use client";

import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-side actions (buttons, etc.) */
  actions?: ReactNode;
}

/**
 * Consistent page heading across all list/detail pages.
 * FFS-1282 / Dom Design: standardized page title + optional subtitle.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "1rem",
      gap: "1rem",
    }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{
            margin: "0.25rem 0 0",
            fontSize: "0.85rem",
            color: "var(--text-muted, #6b7280)",
            lineHeight: 1.4,
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
