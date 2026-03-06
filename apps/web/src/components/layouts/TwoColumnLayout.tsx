"use client";

import { ReactNode } from "react";

interface TwoColumnLayoutProps {
  /** Header content: entity name, badges, actions */
  header: ReactNode;
  /** Primary content area (65% width by default) */
  main: ReactNode;
  /** Secondary content area - quick stats, linked records (35% width by default) */
  sidebar: ReactNode;
  /** Optional footer content - tabs for secondary views */
  footer?: ReactNode;
  /** Sidebar position - defaults to 'right' */
  sidebarPosition?: "left" | "right";
  /** Sidebar width - defaults to '35%' */
  sidebarWidth?: "30%" | "35%" | "40%";
  /** Make header sticky on scroll */
  stickyHeader?: boolean;
  /** Make sidebar sticky on scroll */
  stickySidebar?: boolean;
  /** Additional class for the container */
  className?: string;
}

/**
 * Two-column layout pattern for entity detail pages.
 *
 * Replaces tab-heavy layouts with main + sidebar pattern where:
 * - Main area shows primary content (details, forms, lists)
 * - Sidebar shows quick stats and linked records (always visible)
 *
 * @example
 * ```tsx
 * <TwoColumnLayout
 *   header={<EntityHeader title={person.display_name} />}
 *   main={<PersonDetails person={person} />}
 *   sidebar={<PersonStats stats={stats} />}
 *   footer={<Tabs value={tab} onChange={setTab}>...</Tabs>}
 * />
 * ```
 */
export function TwoColumnLayout({
  header,
  main,
  sidebar,
  footer,
  sidebarPosition = "right",
  sidebarWidth = "35%",
  stickyHeader = true,
  stickySidebar = true,
  className = "",
}: TwoColumnLayoutProps) {
  const mainWidth =
    sidebarWidth === "30%"
      ? "70%"
      : sidebarWidth === "40%"
        ? "60%"
        : "65%";

  const sidebarStyles = stickySidebar
    ? { position: "sticky" as const, top: stickyHeader ? "5rem" : "1rem", alignSelf: "flex-start" as const }
    : {};

  const sidebarBaseStyle = {
    width: sidebarWidth,
    background: "var(--section-bg)",
    overflowY: "auto" as const,
    padding: "1rem",
    ...sidebarStyles,
  };

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "var(--background)",
          borderBottom: "1px solid var(--border)",
          padding: "1rem 1.5rem",
          ...(stickyHeader ? { position: "sticky", top: 0, zIndex: 10 } : {}),
        }}
      >
        {header}
      </header>

      {/* Main content area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {sidebarPosition === "left" && (
          <aside style={{ ...sidebarBaseStyle, borderRight: "1px solid var(--border)" }}>
            {sidebar}
          </aside>
        )}

        <main style={{ width: mainWidth, overflowY: "auto", padding: "1.5rem" }}>
          {main}
        </main>

        {sidebarPosition === "right" && (
          <aside style={{ ...sidebarBaseStyle, borderLeft: "1px solid var(--border)" }}>
            {sidebar}
          </aside>
        )}
      </div>

      {/* Optional footer - usually tabs */}
      {footer && (
        <footer style={{
          background: "var(--background)",
          borderTop: "1px solid var(--border)",
          padding: "0.5rem 1.5rem",
        }}>
          {footer}
        </footer>
      )}
    </div>
  );
}

export default TwoColumnLayout;
