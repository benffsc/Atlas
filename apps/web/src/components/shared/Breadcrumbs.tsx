"use client";

import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Simple breadcrumb component with separator arrows.
 */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", flexWrap: "wrap" }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {i > 0 && <span style={{ color: "var(--text-muted, #9ca3af)" }}>&rsaquo;</span>}
          {item.href ? (
            <Link
              href={item.href}
              style={{
                color: "var(--primary, #3b82f6)",
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          ) : (
            <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export type { BreadcrumbItem };
