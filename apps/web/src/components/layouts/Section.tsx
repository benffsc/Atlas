"use client";

import { ReactNode, useState } from "react";

interface SectionProps {
  /** Section title */
  title: string;
  /** Optional subtitle or description */
  subtitle?: string;
  /** Action buttons to show in header (edit, add, etc.) */
  actions?: ReactNode;
  /** Section content */
  children: ReactNode;
  /** Allow section to be collapsed */
  collapsible?: boolean;
  /** Start collapsed (only applies if collapsible=true) */
  defaultCollapsed?: boolean;
  /** Content to show when section is empty */
  emptyState?: ReactNode;
  /** Whether the section has content (used with emptyState) */
  isEmpty?: boolean;
  /** Additional class for the container */
  className?: string;
  /** Padding size - 'sm' for compact, 'md' for normal */
  padding?: "sm" | "md";
}

/**
 * Standardized content grouping component.
 *
 * @example
 * ```tsx
 * <Section
 *   title="Contact Information"
 *   actions={<Button onClick={onEdit}>Edit</Button>}
 * >
 *   <ContactInfo person={person} />
 * </Section>
 *
 * <Section
 *   title="Related Cats"
 *   collapsible
 *   defaultCollapsed
 *   isEmpty={cats.length === 0}
 *   emptyState={<p>No cats linked</p>}
 * >
 *   <CatList cats={cats} />
 * </Section>
 * ```
 */
export function Section({
  title,
  subtitle,
  actions,
  children,
  collapsible = false,
  defaultCollapsed = false,
  emptyState,
  isEmpty = false,
  className = "",
  padding = "md",
}: SectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [headerHovered, setHeaderHovered] = useState(false);

  const pad = padding === "sm" ? "0.75rem" : "1rem";
  const headerPad = padding === "sm" ? "0.5rem 0.75rem" : "0.75rem 1rem";

  const handleToggle = () => {
    if (collapsible) {
      setIsCollapsed(!isCollapsed);
    }
  };

  return (
    <div
      className={className}
      style={{
        background: "var(--background)",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: headerPad,
          borderBottom: !isCollapsed ? "1px solid var(--border)" : "none",
          cursor: collapsible ? "pointer" : undefined,
          background: collapsible && headerHovered ? "var(--section-bg)" : "transparent",
          borderRadius: isCollapsed ? "8px" : "8px 8px 0 0",
          transition: "background 0.15s",
        }}
        onClick={collapsible ? handleToggle : undefined}
        onMouseOver={collapsible ? () => setHeaderHovered(true) : undefined}
        onMouseOut={collapsible ? () => setHeaderHovered(false) : undefined}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleToggle();
                }
              }
            : undefined
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {collapsible && (
            <span style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
              {isCollapsed ? "\u25B6" : "\u25BC"}
            </span>
          )}
          <div>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
              {title}
            </h3>
            {subtitle && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.125rem", margin: 0 }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && !isCollapsed && (
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div style={{ padding: pad }}>
          {isEmpty && emptyState ? emptyState : children}
        </div>
      )}
    </div>
  );
}

export default Section;
