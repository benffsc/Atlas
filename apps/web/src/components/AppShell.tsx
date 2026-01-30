"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import GlobalSearch from "@/components/GlobalSearch";
import { mainSidebarSections, type NavSection } from "@/components/SidebarLayout";

interface Staff {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: "admin" | "staff" | "volunteer";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isPrintRoute = pathname?.includes("/print");
  const isLoginPage = pathname === "/login";
  const isMapPage = pathname === "/map";

  // Fetch current user on mount
  useEffect(() => {
    if (isLoginPage) return;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && data.staff) {
          setStaff(data.staff);
        }
      })
      .catch(() => {});
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

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setStaff(null);
    window.location.href = "/login";
  };

  // No chrome for these routes
  if (isPrintRoute || isLoginPage || isMapPage) {
    return <>{children}</>;
  }

  const isAdmin = staff?.auth_role === "admin";

  const isActive = (href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  return (
    <>
      {/* Slim top bar */}
      <nav className="nav">
        <div className="nav-inner">
          {/* Hamburger menu */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1.25rem",
              padding: "6px 8px",
              color: "var(--foreground)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-label="Toggle navigation"
          >
            {drawerOpen ? "\u2715" : "\u2630"}
          </button>

          {/* Logo */}
          <a href="/" className="nav-brand" style={{ flexShrink: 0 }}>
            <img src="/logo.png" alt="Atlas" className="nav-logo" style={{ height: "32px" }} />
            <span style={{ fontSize: "1.25rem" }}>Atlas</span>
          </a>

          {/* Search - flex grow to fill center */}
          <div style={{ flex: 1, maxWidth: "480px" }}>
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

      {/* Navigation Drawer (slides from left) */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 199,
          }}
        />
      )}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: drawerOpen ? 0 : "-280px",
          width: "280px",
          height: "100dvh",
          background: "var(--background)",
          borderRight: "1px solid var(--card-border)",
          zIndex: 200,
          transition: "left 0.25s ease-in-out",
          overflowY: "auto",
          boxShadow: drawerOpen ? "4px 0 12px rgba(0,0,0,0.1)" : "none",
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--card-border)",
            height: "56px",
          }}
        >
          <a href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none", color: "var(--foreground)", fontWeight: 700, fontSize: "1.1rem" }}>
            <img src="/logo.png" alt="" style={{ height: "28px" }} />
            Atlas
          </a>
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "var(--muted)", padding: "4px" }}
            aria-label="Close navigation"
          >
            {"\u2715"}
          </button>
        </div>

        {/* Sidebar nav sections */}
        <div style={{ padding: "0.75rem 0" }}>
          {mainSidebarSections.map((section, idx) => (
            <div key={idx} style={{ marginBottom: "1.25rem" }}>
              <div
                style={{
                  padding: "0 1rem",
                  marginBottom: "0.375rem",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--muted)",
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
                      color: isActive(item.href) ? "var(--primary)" : "var(--foreground)",
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

          {/* Admin section (only for admins) */}
          {isAdmin && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div
                style={{
                  padding: "0 1rem",
                  marginBottom: "0.375rem",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--muted)",
                }}
              >
                Quick Admin
              </div>
              <nav>
                <DrawerLink href="/admin/data-engine/review" icon="🔍" label="Data Engine Review" active={isActive("/admin/data-engine/review")} />
                <DrawerLink href="/admin/intake-fields" icon="📝" label="Intake Fields" active={isActive("/admin/intake-fields")} />
                <DrawerLink href="/admin/tippy-feedback" icon="💬" label="Tippy Feedback" active={isActive("/admin/tippy-feedback")} />
              </nav>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="container">{children}</main>
    </>
  );
}

/** Reusable drawer nav link */
function DrawerLink({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        fontSize: "0.875rem",
        color: active ? "var(--primary)" : "var(--foreground)",
        background: active ? "var(--info-bg)" : "transparent",
        borderLeft: active ? "3px solid var(--primary)" : "3px solid transparent",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: "1rem" }}>{icon}</span>
      {label}
    </Link>
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
