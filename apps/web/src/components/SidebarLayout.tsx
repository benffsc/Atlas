"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
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
}

export function SidebarLayout({ children, sections, title, backLink }: SidebarLayoutProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if this is a print route - these should have no sidebar
  const isPrintRoute = pathname?.includes("/print");

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

  const sidebarContent = (
    <>
      {backLink && (
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
            <span style={{ fontSize: "1rem" }}>←</span> {backLink.label}
          </Link>
        </div>
      )}

      {title && (
        <div style={{ padding: "0 1rem", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>{title}</h2>
        </div>
      )}

      {sections.map((section, idx) => (
        <div key={idx} style={{ marginBottom: "1.5rem" }}>
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
          <nav>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  color: isActive(item.href) ? "var(--primary)" : "var(--text-primary)",
                  background: isActive(item.href) ? "var(--info-bg)" : "transparent",
                  borderLeft: isActive(item.href) ? "3px solid var(--primary)" : "3px solid transparent",
                  textDecoration: "none",
                }}
              >
                {item.icon && <span style={{ fontSize: "1rem" }}>{item.icon}</span>}
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      ))}
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
            background: "#3b82f6",
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
          width: isMobile ? "280px" : "180px",
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
          transition: isMobile ? "left 0.3s ease-in-out" : undefined,
          boxShadow: isMobile && mobileMenuOpen ? "2px 0 8px rgba(0,0,0,0.15)" : undefined,
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
          padding: isMobile ? "1rem" : "1rem 1.25rem",
          minWidth: 0,
          marginLeft: isMobile ? 0 : undefined,
        }}
      >
        {children}
      </main>
    </div>
  );
}

// Pre-configured sidebar for Admin pages - Simplified for new Data Hub architecture
export function AdminSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Dashboard",
      items: [
        { label: "Overview", href: "/admin", icon: "📊" },
        { label: "Clinic Days", href: "/admin/clinic-days", icon: "🏥" },
      ],
    },
    {
      title: "Data",
      items: [
        { label: "Data Hub", href: "/admin/data", icon: "📊" },
        { label: "Upload Data", href: "/admin/v2-ingest", icon: "📤" },
        { label: "Review Queue", href: "/admin/data?tab=review", icon: "📋" },
      ],
    },
    {
      title: "Beacon",
      items: [
        { label: "Atlas Map", href: "/map", icon: "🗺️" },
        { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "🐱" },
        { label: "Seasonal Analysis", href: "/admin/beacon/seasonal", icon: "📆" },
        { label: "Forecasts", href: "/admin/beacon/forecasts", icon: "🔮" },
      ],
    },
    {
      title: "Email",
      items: [
        { label: "Email Hub", href: "/admin/email", icon: "📧" },
        { label: "Templates", href: "/admin/email-templates", icon: "📝" },
        { label: "Batches", href: "/admin/email-batches", icon: "📨" },
      ],
    },
    {
      title: "Settings",
      items: [
        { label: "Staff", href: "/admin/staff", icon: "👥" },
        { label: "Organizations", href: "/admin/organizations", icon: "🏢" },
        { label: "Intake Fields", href: "/admin/intake-fields", icon: "📝" },
        { label: "Ecology Config", href: "/admin/ecology", icon: "🌿" },
        { label: "AI Access", href: "/admin/ai-access", icon: "🔐" },
      ],
    },
    {
      title: "Linear",
      items: [
        { label: "Dashboard", href: "/admin/linear", icon: "📐" },
        { label: "Issues", href: "/admin/linear/issues", icon: "📋" },
        { label: "Sessions", href: "/admin/linear/sessions", icon: "🤖" },
      ],
    },
    {
      title: "Developer",
      items: [
        { label: "Claude Code", href: "/admin/claude-code", icon: "🤖" },
        { label: "Knowledge Base", href: "/admin/knowledge-base", icon: "📚" },
        { label: "Tippy Corrections", href: "/admin/tippy-corrections", icon: "✏️" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Admin" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}

// Main sidebar sections — exported so AppShell hamburger drawer can reuse them
export const mainSidebarSections: NavSection[] = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard", href: "/", icon: "🏠" },
      { label: "Atlas Map", href: "/map", icon: "🗺️" },
      { label: "Intake Queue", href: "/intake/queue", icon: "📥" },
      { label: "Requests", href: "/requests", icon: "📋" },
      { label: "Clinic Days", href: "/admin/clinic-days", icon: "🏥" },
      { label: "Trappers", href: "/trappers", icon: "🪤" },
    ],
  },
  {
    title: "Records",
    items: [
      { label: "Cats", href: "/cats", icon: "🐱" },
      { label: "People", href: "/people", icon: "👥" },
      { label: "Places", href: "/places", icon: "📍" },
      { label: "Search", href: "/search", icon: "🔍" },
    ],
  },
  {
    title: "Beacon",
    items: [
      { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "📊" },
      { label: "Seasonal Analysis", href: "/admin/beacon/seasonal", icon: "📆" },
      { label: "Forecasts", href: "/admin/beacon/forecasts", icon: "🔮" },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Admin Panel", href: "/admin", icon: "⚙️" },
    ],
  },
];

// Main app sidebar for all pages
export function MainSidebar({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout sections={mainSidebarSections} title="Atlas">
      {children}
    </SidebarLayout>
  );
}

/**
 * Requests section sidebar.
 *
 * Quick filters use the simplified 4-state system (MIG_2530):
 * - new: Awaiting initial review
 * - working: Actively being handled
 * - paused: On hold
 * - completed: Finished
 */
interface RequestCounts {
  new: number;
  working: number;
  paused: number;
  completed: number;
  needs_trapper: number;
  urgent: number;
}

export function RequestsSidebar({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<RequestCounts | null>(null);

  // Fetch request counts on mount
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const response = await fetch("/api/requests/counts");
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setCounts(data.data);
          }
        }
      } catch {
        // Silently fail - counts are optional enhancement
      }
    };
    fetchCounts();
    // Refresh counts every 60 seconds
    const interval = setInterval(fetchCounts, 60000);
    return () => clearInterval(interval);
  }, []);

  const formatCount = (count: number | undefined) => {
    if (count === undefined || count === 0) return "";
    return ` (${count})`;
  };

  const sections: NavSection[] = [
    {
      title: "Quick Actions",
      items: [
        { label: "Enter Call Sheet", href: "/intake/call-sheet", icon: "📞" },
        { label: "Print Call Sheet", href: "/requests/print/full", icon: "🖨️" },
        { label: "New Request", href: "/requests/new", icon: "➕" },
      ],
    },
    {
      title: "By Status",
      items: [
        { label: `New${formatCount(counts?.new)}`, href: "/requests?status=new", icon: "🆕" },
        { label: `Working${formatCount(counts?.working)}`, href: "/requests?status=working", icon: "🔄" },
        { label: `Paused${formatCount(counts?.paused)}`, href: "/requests?status=paused", icon: "⏸️" },
        { label: `Completed${formatCount(counts?.completed)}`, href: "/requests?status=completed", icon: "✅" },
      ],
    },
    {
      title: "By Assignment",
      items: [
        { label: `Needs Trapper${formatCount(counts?.needs_trapper)}`, href: "/requests?trapper=pending", icon: "🪤" },
        { label: "My Assigned", href: "/requests?trapper=mine", icon: "👤" },
        { label: "Client Trapping", href: "/requests?trapper=client_trapping", icon: "🏠" },
      ],
    },
    {
      title: "Priority",
      items: [
        { label: `Urgent${formatCount(counts?.urgent)}`, href: "/requests?priority=urgent", icon: "🚨" },
        { label: "Has Kittens", href: "/requests?kittens=true", icon: "🐱" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "All Requests", href: "/requests", icon: "📋" },
        { label: "Intake Queue", href: "/intake/queue", icon: "📥" },
        { label: "Trappers", href: "/trappers", icon: "🪤" },
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
        { label: "All Cats", href: "/cats", icon: "🐱" },
      ],
    },
    {
      title: "Beacon Data",
      items: [
        { label: "Reproduction", href: "/admin/beacon/reproduction", icon: "🍼" },
        { label: "Mortality", href: "/admin/beacon/mortality", icon: "📋" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Places", href: "/places", icon: "📍" },
        { label: "People", href: "/people", icon: "👥" },
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
        { label: "All People", href: "/people", icon: "👥" },
      ],
    },
    {
      title: "By Role",
      items: [
        { label: "Trappers", href: "/trappers", icon: "🪤" },
        { label: "Staff", href: "/admin/staff", icon: "👔" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Places", href: "/places", icon: "📍" },
        { label: "Requests", href: "/requests", icon: "📋" },
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
        { label: "All Places", href: "/places", icon: "📍" },
        { label: "New Place", href: "/places/new", icon: "➕" },
      ],
    },
    {
      title: "Beacon Data",
      items: [
        { label: "Colony Estimates", href: "/admin/beacon/colony-estimates", icon: "📊" },
        { label: "Forecasts", href: "/admin/beacon/forecasts", icon: "🔮" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Requests", href: "/requests", icon: "📋" },
        { label: "Cats", href: "/cats", icon: "🐱" },
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
export function IntakeSidebar({ children }: { children: React.ReactNode }) {
  const sections: NavSection[] = [
    {
      title: "Intake",
      items: [
        { label: "Triage Queue", href: "/intake/queue", icon: "📥" },
        { label: "New Submission", href: "/intake/queue/new", icon: "➕" },
        { label: "Enter Call Sheet", href: "/intake/call-sheet", icon: "📞" },
      ],
    },
    {
      title: "Quick Filters",
      items: [
        { label: "New", href: "/intake/queue?status=new", icon: "🆕" },
        { label: "In Progress", href: "/intake/queue?status=in_progress", icon: "🔄" },
        { label: "Scheduled", href: "/intake/queue?status=scheduled", icon: "📅" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Requests", href: "/requests", icon: "📋" },
        { label: "Intake Fields", href: "/admin/intake-fields", icon: "📝" },
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
        { label: "All Trappers", href: "/trappers", icon: "🪤" },
        { label: "Observations", href: "/trappers/observations", icon: "👁️" },
        { label: "Onboarding", href: "/trappers/onboarding", icon: "📝" },
        { label: "Training Materials", href: "/trappers/materials", icon: "📚" },
      ],
    },
    {
      title: "Related",
      items: [
        { label: "Requests", href: "/requests", icon: "📋" },
        { label: "People", href: "/people", icon: "👥" },
      ],
    },
  ];

  return (
    <SidebarLayout sections={sections} title="Trappers" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}
