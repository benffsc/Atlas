"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { GlobalSearch, CommandPaletteProvider, useCommandPalette } from "@/components/search";
import { usePermission } from "@/hooks/usePermission";
import { ToastProvider } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { usePresentationMode, PresentationModeIndicator } from "@/components/PresentationMode";
import { fetchApi } from "@/lib/api-client";

interface Staff {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: "admin" | "staff" | "volunteer";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The product is ALWAYS "Beacon". The org (useOrgConfig().nameShort, e.g.
  // "FFSC") is the organization operating the tool, not the tool itself. We
  // explicitly do NOT fall back to nameShort here — that would hide the Beacon
  // brand. Beacon is a standalone product name that works across any org that
  // deploys it. Atlas is the internal backend name only.
  const appName = "Beacon";
  const [staff, setStaff] = useState<Staff | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Presentation mode — config-driven (ops.app_config → presentation.*)
  const { enabled: presentationEnabled, toggle: togglePresentation, exit: exitPresentation } = usePresentationMode();
  const [presentationConfig, setPresentationConfig] = useState<{
    enabled: boolean;
    font_scale: number;
    indicator_text: string;
  }>({ enabled: true, font_scale: 1.2, indicator_text: "Presentation Mode — press ESC to exit" });

  useEffect(() => {
    fetchApi<{ enabled: boolean; font_scale: number; indicator_text: string }>("/api/presentation-config")
      .then((result) => {
        if (result && typeof result === "object" && "enabled" in result) {
          setPresentationConfig(result as { enabled: boolean; font_scale: number; indicator_text: string });
        }
      })
      .catch(() => { /* Silent fail — use defaults */ });
  }, []);

  const isPrintRoute = pathname?.includes("/print") || pathname?.includes("/trapper-sheet");
  const isLoginPage = pathname === "/login";
  const isMapPage = pathname === "/map";
  const isKioskRoute = pathname?.startsWith("/kiosk");
  const isStoryPage = pathname === "/story";
  const isWelcomePage = pathname === "/welcome";
  const isChromeless = isPrintRoute || isLoginPage || isMapPage || isKioskRoute || isStoryPage || isWelcomePage;

  // Fetch current user on mount
  useEffect(() => {
    if (isLoginPage) return;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((raw) => {
        const data = raw?.data || raw;
        if (data?.authenticated && data.staff) {
          setStaff(data.staff);
        }
      })
      .catch(() => { /* fire-and-forget: auth check for UI chrome */ });
  }, [isLoginPage]);

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setStaff(null);
    window.location.href = "/login";
  };

  // Must call all hooks before any early return (React rules of hooks)
  const isAdmin = usePermission("admin.access");

  // No chrome for these routes (kiosk has its own layout shell)
  if (isChromeless) {
    return <>{children}</>;
  }

  const isActive = (href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  return (
    <CommandPaletteProvider>
      {/* Slim top bar */}
      <nav className="nav">
        <div className="nav-inner">
          {/* Beacon wordmark logo (wordmark already contains "BEACON" text) */}
          <a href="/" className="nav-brand" style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
            <img
              src="/beacon-logo.jpeg"
              alt={appName}
              className="nav-logo"
              style={{ height: "36px", width: "auto", display: "block" }}
            />
          </a>

          {/* Search - flex grow to fill center */}
          <div style={{ flex: 1, maxWidth: "min(480px, 40vw)" }}>
            <GlobalSearch />
          </div>

          {/* Right side: spacer + user menu */}
          <div style={{ flex: 1 }} />

          {/* User Menu */}
          {staff ? (
            <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 10px",
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "var(--foreground)",
                }}
              >
                <span
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    fontSize: "0.7rem",
                  }}
                >
                  {staff.display_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <span
                  className="nav-user-name"
                  style={{ maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {staff.display_name}
                </span>
                <span style={{ fontSize: "0.55rem", opacity: 0.5 }}>{"\u25BC"}</span>
              </button>

              {menuOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: "4px",
                    background: "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    minWidth: "200px",
                    zIndex: 1000,
                  }}
                >
                  {/* User Info */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--card-border)" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{staff.display_name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{staff.email}</div>
                    <div
                      style={{
                        marginTop: "6px",
                        display: "inline-block",
                        padding: "2px 8px",
                        background: staff.auth_role === "admin" ? "var(--info-bg)" : staff.auth_role === "volunteer" ? "var(--warning-bg)" : "var(--success-bg)",
                        color: staff.auth_role === "admin" ? "var(--info-text)" : staff.auth_role === "volunteer" ? "var(--warning-text)" : "var(--success-text)",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontWeight: 500,
                        textTransform: "capitalize",
                      }}
                    >
                      {staff.auth_role}
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div style={{ padding: "8px 0" }}>
                    <DropdownLink href="/me">My Dashboard</DropdownLink>
                    <DropdownLink href={`/admin/staff/${staff.staff_id}`}>My Profile</DropdownLink>
                    {isAdmin && (
                      <>
                        <div style={{ borderTop: "1px solid var(--card-border)", margin: "4px 0" }} />
                        <DropdownLink href="/admin">Admin Panel</DropdownLink>
                      </>
                    )}
                    {presentationConfig.enabled && (
                      <>
                        <div style={{ borderTop: "1px solid var(--card-border)", margin: "4px 0" }} />
                        <button
                          onClick={() => { togglePresentation(); setMenuOpen(false); }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            width: "100%",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            textAlign: "left",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--foreground)",
                          }}
                          aria-label={presentationEnabled ? "Exit presentation mode" : "Enter presentation mode"}
                        >
                          <Icon name={presentationEnabled ? "eye-off" : "eye"} size={16} />
                          {presentationEnabled ? "Exit presentation" : "Presentation mode"}
                        </button>
                      </>
                    )}
                    <div style={{ borderTop: "1px solid var(--card-border)", margin: "4px 0" }} />
                    <button
                      onClick={handleLogout}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 16px",
                        fontSize: "0.875rem",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--danger-text)",
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <a
              href="/login"
              style={{
                padding: "6px 12px",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                borderRadius: "6px",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              Sign In
            </a>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main className="container"><ToastProvider>{children}</ToastProvider></main>

      {/* Presentation mode indicator (floats bottom-right when active) */}
      <PresentationModeIndicator
        enabled={presentationEnabled}
        onExit={exitPresentation}
        config={{
          text: presentationConfig.indicator_text,
          fontScale: presentationConfig.font_scale,
        }}
      />
    </CommandPaletteProvider>
  );
}


/** Reusable dropdown menu link */
function DropdownLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: "8px 16px",
        fontSize: "0.875rem",
        color: "var(--foreground)",
        textDecoration: "none",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--section-bg)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </a>
  );
}
