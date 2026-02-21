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

  const paddingClass = padding === "sm" ? "p-3" : "p-4";
  const headerPaddingClass = padding === "sm" ? "px-3 py-2" : "px-4 py-3";

  const handleToggle = () => {
    if (collapsible) {
      setIsCollapsed(!isCollapsed);
    }
  };

  return (
    <div className={`bg-white rounded-lg border shadow-sm ${className}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between ${headerPaddingClass} ${
          !isCollapsed ? "border-b" : ""
        } ${collapsible ? "cursor-pointer hover:bg-gray-50" : ""}`}
        onClick={collapsible ? handleToggle : undefined}
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
        <div className="flex items-center gap-2">
          {collapsible && (
            <span className="text-gray-400 text-xs">
              {isCollapsed ? "▶" : "▼"}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && !isCollapsed && (
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className={paddingClass}>
          {isEmpty && emptyState ? emptyState : children}
        </div>
      )}
    </div>
  );
}

export default Section;
