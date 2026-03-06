"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";

export interface StatItem {
  /** Label for the stat */
  label: string;
  /** Value to display */
  value: string | number | ReactNode;
  /** Optional icon (emoji or component) */
  icon?: string | ReactNode;
  /** Optional link to navigate to */
  href?: string;
  /** Optional subtitle/description */
  subtitle?: string;
}

interface StatSection {
  /** Section title */
  title: string;
  /** Section content - can be stats or custom ReactNode */
  content: ReactNode;
}

interface StatsSidebarProps {
  /** Primary stats to display */
  stats?: StatItem[];
  /** Additional sections */
  sections?: StatSection[];
  /** Additional class */
  className?: string;
}

/**
 * Quick stats display for sidebar pattern.
 *
 * Shows key metrics and linked record summaries.
 *
 * @example
 * ```tsx
 * <StatsSidebar
 *   stats={[
 *     { label: "Total Cats", value: 12, icon: "🐱" },
 *     { label: "TNR'd", value: 8, icon: "✂️" },
 *     { label: "Coverage", value: "67%", icon: "📊" },
 *   ]}
 *   sections={[
 *     { title: "Recent Activity", content: <ActivityList /> },
 *     { title: "Nearby", content: <NearbyPlaces /> },
 *   ]}
 * />
 * ```
 */
export function StatsSidebar({
  stats = [],
  sections = [],
  className = "",
}: StatsSidebarProps) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Primary stats grid */}
      {stats.length > 0 && (
        <div style={{
          background: "var(--background)",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          padding: "1rem",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {stats.map((stat, index) => (
              <StatItemDisplay key={index} stat={stat} />
            ))}
          </div>
        </div>
      )}

      {/* Additional sections */}
      {sections.map((section, index) => (
        <div key={index} style={{
          background: "var(--background)",
          borderRadius: "8px",
          border: "1px solid var(--border)",
        }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
            <h4 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
              {section.title}
            </h4>
          </div>
          <div style={{ padding: "1rem" }}>{section.content}</div>
        </div>
      ))}
    </div>
  );
}

function StatItemDisplay({ stat }: { stat: StatItem }) {
  const content = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
      {stat.icon && (
        <span style={{ fontSize: "1.125rem", flexShrink: 0 }}>
          {typeof stat.icon === "string" ? (
            <span role="img">{stat.icon}</span>
          ) : (
            stat.icon
          )}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {stat.value}
        </div>
        <div style={{
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {stat.label}
        </div>
        {stat.subtitle && (
          <div style={{
            fontSize: "0.75rem",
            color: "var(--text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {stat.subtitle}
          </div>
        )}
      </div>
    </div>
  );

  if (stat.href) {
    return (
      <HoverLink href={stat.href}>
        {content}
      </HoverLink>
    );
  }

  return <div style={{ padding: "0.5rem", margin: "-0.5rem" }}>{content}</div>;
}

function HoverLink({ href, children }: { href: string; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "0.5rem",
        margin: "-0.5rem",
        borderRadius: "8px",
        background: hovered ? "var(--section-bg)" : "transparent",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s",
      }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      {children}
    </Link>
  );
}

/**
 * Compact stat row for inline display
 */
export function StatRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href?: string;
}) {
  const content = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.25rem 0" }}>
      <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-primary)" }}>{value}</span>
    </div>
  );

  if (href) {
    return (
      <StatRowLink href={href}>{content}</StatRowLink>
    );
  }

  return content;
}

function StatRowLink({ href, children }: { href: string; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      style={{
        display: "block",
        margin: "0 -0.5rem",
        padding: "0 0.5rem",
        borderRadius: "4px",
        background: hovered ? "var(--section-bg)" : "transparent",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s",
      }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      {children}
    </Link>
  );
}

export default StatsSidebar;
