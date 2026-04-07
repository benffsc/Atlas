"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useNavItems } from "@/hooks/useNavItems";
import { Icon } from "@/components/ui/Icon";

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  /** Optional badge count (e.g., pending items) */
  badge?: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

interface SidebarLayoutProps {
  children: React.ReactNode;
  sections: NavSection[];
  title?: string;
  backLink?: { label: string; href: string };
  /** Allow sidebar to be collapsed to icon-only mode */
  collapsible?: boolean;
  /** Enable collapsible section headers (click to expand/collapse) */
  collapsibleSections?: boolean;
  /** localStorage key for persisting collapsed sections state */
  sidebarKey?: string;
  /** Section titles to collapse by default */
  defaultCollapsed?: string[];
  /** Strip the default padding around <main> — used by full-bleed pages like the map */
  noMainPadding?: boolean;
}

export function SidebarLayout({ children, sections, title, backLink, collapsible = true, collapsibleSections = false, sidebarKey, defaultCollapsed = [], noMainPadding = false }: SidebarLayoutProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  // Collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(defaultCollapsed);
    if (!sidebarKey) return new Set(defaultCollapsed);
    try {
      const stored = localStorage.getItem(`sidebar-sections-${sidebarKey}`);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        // Merge stored with defaults (stored takes priority on subsequent visits)
        return new Set(parsed);
      }
    } catch { /* ignore */ }
    return new Set(defaultCollapsed);
  });

  const toggleSection = (sectionTitle: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionTitle)) {
        next.delete(sectionTitle);
      } else {
        next.add(sectionTitle);
      }
      if (sidebarKey) {
        try { localStorage.setItem(`sidebar-sections-${sidebarKey}`, JSON.stringify([...next])); } catch { /* ignore */ }
      }
      return next;
    });
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* ignore */ }
  };

  // Check if this is a print route - these should have no sidebar
  const isPrintRoute = pathname?.includes("/print") || pathname?.includes("/trapper-sheet");

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === pathname) return true;
    // Handle nested routes
    if (href !== "/" && pathname?.startsWith(href + "/")) return true;
    return false;
  };

  // Print routes get no sidebar, just the content
  if (isPrintRoute) {
    return <>{children}</>;
  }

  const isCollapsed = collapsible && collapsed && !isMobile;

  const sidebarContent = (
    <>
      {/* Collapse toggle */}
      {collapsible && !isMobile && (
        <div style={{ display: "flex", justifyContent: isCollapsed ? "center" : "flex-end", padding: "0.25rem 0.5rem", marginBottom: "0.25rem" }}>
          <button
            onClick={toggleCollapsed}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", color: "var(--text-muted)", padding: "4px 6px", borderRadius: "4px" }}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? "\u276F" : "\u276E"}
          </button>
        </div>
      )}

      {backLink && !isCollapsed && (
        <div style={{ padding: "0 1rem", marginBottom: "0.75rem" }}>
          <Link
            href={backLink.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
            }}
          >
            <span style={{ fontSize: "1rem" }}>{"\u2190"}</span> {backLink.label}
          </Link>
        </div>
      )}

      {title && !isCollapsed && (
        <div style={{ padding: "0 1rem", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>{title}</h2>
        </div>
      )}

      {sections.map((section, idx) => {
        const isSectionCollapsed = collapsibleSections && collapsedSections.has(section.title);

        return (
          <div key={idx} style={{ marginBottom: "1.5rem" }}>
            {!isCollapsed && (
              collapsibleSections ? (
                <button
                  onClick={() => toggleSection(section.title)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    width: "100%",
                    padding: "0.15rem 1rem",
                    marginBottom: isSectionCollapsed ? "0" : "0.5rem",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-muted)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  aria-expanded={!isSectionCollapsed}
                >
                  <Icon name={isSectionCollapsed ? "chevron-right" : "chevron-down"} size={12} />
                  {section.title}
                </button>
              ) : (
                <div
                  style={{
                    padding: "0 1rem",
                    marginBottom: "0.5rem",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-muted)",
                  }}
                >
                  {section.title}
                </div>
              )
            )}
            {!isSectionCollapsed && (
              <nav>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: isCollapsed ? "0" : "0.5rem",
                      justifyContent: isCollapsed ? "center" : "flex-start",
                      padding: isCollapsed ? "0.5rem" : "0.5rem 1rem",
                      fontSize: "0.875rem",
                      color: isActive(item.href) ? "var(--primary)" : "var(--text-primary)",
                      background: isActive(item.href) ? "var(--info-bg)" : "transparent",
                      borderLeft: isActive(item.href) ? "3px solid var(--primary)" : "3px solid transparent",
                      textDecoration: "none",
                      position: "relative",
                    }}
                  >
                    {item.icon && <Icon name={item.icon} size={isCollapsed ? 20 : 18} />}
                    {!isCollapsed && item.label}
                    {item.badge != null && item.badge > 0 && (
                      <span style={{
                        marginLeft: isCollapsed ? "0" : "auto",
                        position: isCollapsed ? "absolute" : "static",
                        top: isCollapsed ? "2px" : undefined,
                        right: isCollapsed ? "4px" : undefined,
                        minWidth: "18px",
                        height: "18px",
                        lineHeight: "18px",
                        textAlign: "center",
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        color: "#fff",
                        background: "var(--primary)",
                        borderRadius: "9px",
                        padding: "0 4px",
                      }}>
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        );
      })}
    </>
  );

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 56px)", margin: "0 -1rem" }}>
      {/* Mobile Menu Toggle */}
      {isMobile && (
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{
            position: "fixed",
            bottom: "1rem",
            right: "1rem",
            zIndex: 1001,
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "var(--primary, #3b82f6)",
            color: "#fff",
            border: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.25rem",
          }}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? "×" : "☰"}
        </button>
      )}

      {/* Mobile Overlay */}
      {isMobile && mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 999,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: isMobile ? "280px" : isCollapsed ? "var(--sidebar-collapsed-width, 52px)" : "var(--sidebar-width, 180px)",
          flexShrink: 0,
          borderRight: "1px solid var(--card-border)",
          background: "var(--background)",
          padding: "1rem 0",
          position: isMobile ? "fixed" : "sticky",
          top: isMobile ? 0 : "56px",
          left: isMobile ? (mobileMenuOpen ? 0 : "-280px") : undefined,
          height: isMobile ? "100dvh" : "calc(100vh - 56px)",
          overflowY: "auto",
          zIndex: isMobile ? 1000 : undefined,
          transition: isMobile ? "left 0.3s ease-in-out" : "width 0.2s ease-in-out",
          boxShadow: isMobile && mobileMenuOpen ? "2px 0 8px rgba(0,0,0,0.15)" : isMobile ? undefined : "1px 0 4px rgba(0,0,0,0.04)",
        }}
      >
        {/* Mobile close button */}
        {isMobile && (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 1rem", marginBottom: "0.5rem" }}>
            <button
              onClick={() => setMobileMenuOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "1.5rem",
                cursor: "pointer",
                color: "var(--text-muted)",
              }}
              aria-label="Close menu"
            >
              ×
            </button>
          </div>
        )}

        {sidebarContent}
      </aside>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          padding: noMainPadding ? 0 : (isMobile ? "1rem" : "1rem 1.25rem"),
          minWidth: 0,
          marginLeft: isMobile ? 0 : undefined,
        }}
      >
        {children}
      </main>
    </div>
  );
}

// Hardcoded fallback for admin sidebar (used when DB fetch fails or on first load)
const ADMIN_SIDEBAR_FALLBACK: NavSection[] = [
  {
    title: "Dashboard",
    items: [
      { label: "Overview", href: "/admin", icon: "layout-dashboard" },
      { label: "Clinic Days", href: "/admin/clinic-days", icon: "hospital" },
    ],
  },
  {
    title: "Data",
    items: [
      { label: "Data Hub", href: "/admin/data", icon: "bar-chart" },
      { label: "ClinicHQ Upload", href: "/admin/ingest", icon: "upload" },
      { label: "Data Health", href: "/admin/data-health", icon: "activity" },
    ],
  },
  {
    title: "Beacon",
    items: [
      { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "cat" },
      { label: "Mortality", href: "/admin/beacon/mortality", icon: "clipboard-list" },
      { label: "Reproduction", href: "/admin/beacon/reproduction", icon: "baby" },
      { label: "Seasonal Analysis", href: "/admin/beacon/seasonal", icon: "calendar-days" },
      { label: "Forecasts", href: "/admin/beacon/forecasts", icon: "trending-up" },
    ],
  },
  {
    title: "Email",
    items: [
      { label: "Email Hub", href: "/admin/email", icon: "mail" },
      { label: "Templates", href: "/admin/email-templates", icon: "file-text" },
      { label: "Batches", href: "/admin/email-batches", icon: "send" },
    ],
  },
  {
    title: "Tippy",
    items: [
      { label: "Corrections", href: "/admin/tippy-corrections", icon: "pencil" },
      { label: "Knowledge Base", href: "/admin/knowledge-base", icon: "book-open" },
      { label: "Conversations", href: "/admin/tippy-conversations", icon: "message-square" },
      { label: "Feedback", href: "/admin/tippy-feedback", icon: "help-circle" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "All Settings", href: "/admin/settings", icon: "settings" },
      { label: "Kiosk Config", href: "/admin/kiosk", icon: "tablet" },
    ],
  },
  {
    title: "Developer",
    items: [
      { label: "Claude Code", href: "/admin/claude-code", icon: "code-2" },
      { label: "Linear", href: "/admin/linear", icon: "square-kanban" },
      { label: "Test Mode", href: "/admin/test-mode", icon: "flask-conical" },
    ],
  },
];

// Pre-configured sidebar for Admin pages — reads from DB with hardcoded fallback
export function AdminSidebar({ children }: { children: React.ReactNode }) {
  const { sections } = useNavItems("admin", ADMIN_SIDEBAR_FALLBACK);

  return (
    <SidebarLayout
      sections={sections}
      title="Admin"
      backLink={{ label: "Home", href: "/" }}
      collapsibleSections
      sidebarKey="admin"
      defaultCollapsed={["Developer"]}
    >
      {children}
    </SidebarLayout>
  );
}

// Main sidebar sections — exported so AppShell hamburger drawer can reuse them
export const mainSidebarSections: NavSection[] = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard", href: "/", icon: "home" },
      { label: "Map", href: "/map", icon: "map" },
      { label: "Intake Queue", href: "/intake/queue", icon: "inbox" },
      { label: "Requests", href: "/requests", icon: "clipboard-list" },
      { label: "Clinic Days", href: "/admin/clinic-days", icon: "hospital" },
      { label: "Trappers", href: "/trappers", icon: "snail" },
      { label: "Equipment", href: "/equipment", icon: "wrench" },
    ],
  },
  {
    title: "Records",
    items: [
      { label: "Cats", href: "/cats", icon: "cat" },
      { label: "People", href: "/people", icon: "users" },
      { label: "Places", href: "/places", icon: "map-pin" },
      { label: "Search", href: "/search", icon: "search" },
    ],
  },
  {
    title: "Beacon",
    items: [
      { label: "Beacon Dashboard", href: "/beacon", icon: "radio" },
      { label: "Compare", href: "/beacon/compare", icon: "bar-chart" },
      { label: "Scenarios", href: "/beacon/scenarios", icon: "sparkles" },
      { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "calendar-days" },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Admin Panel", href: "/admin", icon: "settings" },
    ],
  },
];

// Main app sidebar for all pages — reads from DB with hardcoded fallback
export function MainSidebar({ children }: { children: React.ReactNode }) {
  const { sections } = useNavItems("main", mainSidebarSections);

  return (
    <SidebarLayout sections={sections} title="Home">
      {children}
    </SidebarLayout>
  );
}

// Beacon sidebar sections — used by /beacon/* layout
export const beaconSidebarSections: NavSection[] = [
  {
    title: "Beacon",
    items: [
      { label: "Dashboard", href: "/beacon", icon: "radio" },
      { label: "Map", href: "/beacon/map", icon: "map" },
      { label: "Compare Locations", href: "/beacon/compare", icon: "bar-chart" },
      { label: "Scenarios", href: "/beacon/scenarios", icon: "sparkles" },
    ],
  },
  {
    title: "Data",
    items: [
      { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "calendar-days" },
      { label: "Seasonal Analysis", href: "/admin/beacon/seasonal", icon: "thermometer" },
    ],
  },
  {
    title: "Atlas",
    items: [
      { label: "Operations", href: "/", icon: "home" },
      { label: "Admin", href: "/admin", icon: "settings" },
    ],
  },
];

// Pre-configured sidebar for Beacon pages
export function BeaconSidebar({ children }: { children: React.ReactNode }) {
  const { sections } = useNavItems("beacon", beaconSidebarSections);
  const pathname = usePathname();
  // Full-bleed pages strip the <main> padding so the map can fill the viewport.
  const noMainPadding = pathname === "/beacon/map";

  return (
    <SidebarLayout
      sections={sections}
      title="Beacon"
      backLink={{ label: "Home", href: "/" }}
      noMainPadding={noMainPadding}
    >
      {children}
    </SidebarLayout>
  );
}

/**
 * Requests section sidebar.
 *
 * Status/assignment/priority filters moved to page-level StatusSegmentedControl
 * and filter chips (FFS-166). Sidebar now has Quick Actions + Related only.
 */
export function RequestsSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Quick Actions",
      items: [
        { label: "New Request", href: "/requests/new", icon: "plus" },
        { label: "Print TNR Call Sheet", href: "/requests/print?blank=true", icon: "printer" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "All Requests", href: "/requests", icon: "clipboard-list" },
        { label: "Intake Queue", href: "/intake/queue", icon: "inbox" },
        { label: "Trappers", href: "/trappers", icon: "snail" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Requests" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}

// Cats section sidebar
export function CatsSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Cats",
      items: [
        { label: "All Cats", href: "/cats", icon: "cat" },
      ],
    },
    {
      title: "Beacon Data",
      items: [
        { label: "Reproduction", href: "/admin/beacon/reproduction", icon: "baby" },
        { label: "Mortality", href: "/admin/beacon/mortality", icon: "clipboard-list" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Places", href: "/places", icon: "map-pin" },
        { label: "People", href: "/people", icon: "users" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Cats" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}

// People section sidebar
export function PeopleSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "People",
      items: [
        { label: "All People", href: "/people", icon: "users" },
      ],
    },
    {
      title: "By Role",
      items: [
        { label: "Trappers", href: "/trappers", icon: "snail" },
        { label: "Staff", href: "/admin/staff", icon: "user-cog" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Places", href: "/places", icon: "map-pin" },
        { label: "Requests", href: "/requests", icon: "clipboard-list" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="People" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}

// Places section sidebar
export function PlacesSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Places",
      items: [
        { label: "All Places", href: "/places", icon: "map-pin" },
        { label: "New Place", href: "/places/new", icon: "plus" },
      ],
    },
    {
      title: "Beacon Data",
      items: [
        { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "bar-chart" },
        { label: "Forecasts", href: "/admin/beacon/forecasts", icon: "trending-up" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Requests", href: "/requests", icon: "clipboard-list" },
        { label: "Cats", href: "/cats", icon: "cat" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Places" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}

// Intake section sidebar
// Quick Filters removed — replaced by page-level tabs (FFS-166)
export function IntakeSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Intake",
      items: [
        { label: "Triage Queue", href: "/intake/queue", icon: "inbox" },
        { label: "New Submission", href: "/intake/queue/new", icon: "plus" },
        { label: "Enter Call Sheet", href: "/intake/call-sheet", icon: "scroll-text" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Requests", href: "/requests", icon: "clipboard-list" },
        { label: "Intake Fields", href: "/admin/intake-fields", icon: "form-input" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Intake" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}

// Trappers section sidebar
export function TrappersSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Trappers",
      items: [
        { label: "All Trappers", href: "/trappers", icon: "snail" },
        { label: "Observations", href: "/trappers/observations", icon: "telescope" },
        { label: "Onboarding", href: "/trappers/onboarding", icon: "file-text" },
        { label: "Training Materials", href: "/trappers/materials", icon: "book-open" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Requests", href: "/requests", icon: "clipboard-list" },
        { label: "People", href: "/people", icon: "users" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Trappers" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}
