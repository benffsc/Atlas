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
    ? { position: "sticky" as const, top: stickyHeader ? "5rem" : "1rem", alignSelf: "flex-start" }
    : {};

  return (
    <div className={`flex flex-col min-h-screen ${className}`}>
      {/* Header */}
      <header
        className={`bg-white border-b px-6 py-4 ${stickyHeader ? "sticky top-0 z-10" : ""}`}
      >
        {header}
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {sidebarPosition === "left" && (
          <aside
            className="border-r bg-gray-50 overflow-y-auto p-4"
            style={{ width: sidebarWidth, ...sidebarStyles }}
          >
            {sidebar}
          </aside>
        )}

        <main
          className="overflow-y-auto p-6"
          style={{ width: mainWidth }}
        >
          {main}
        </main>

        {sidebarPosition === "right" && (
          <aside
            className="border-l bg-gray-50 overflow-y-auto p-4"
            style={{ width: sidebarWidth, ...sidebarStyles }}
          >
            {sidebar}
          </aside>
        )}
      </div>

      {/* Optional footer - usually tabs */}
      {footer && (
        <footer className="bg-white border-t px-6 py-2">
          {footer}
        </footer>
      )}
    </div>
  );
}

export default TwoColumnLayout;
