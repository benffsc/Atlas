"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import GlobalSearch from "@/components/GlobalSearch";

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
  const menuRef = useRef<HTMLDivElement>(null);

  // Check if this is a print route - these should have no chrome
  const isPrintRoute = pathname?.includes("/print");

  // Check if this is the login page
  const isLoginPage = pathname === "/login";

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
      .catch(() => {
        // Ignore errors
      });
  }, [isLoginPage]);

  // Close menu when clicking outside
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

  if (isPrintRoute) {
    // Print routes get no navigation, no container wrapper
    return <>{children}</>;
  }

  if (isLoginPage) {
    // Login page gets no navigation
    return <>{children}</>;
  }

  const isAdmin = staff?.auth_role === "admin";
  const isVolunteer = staff?.auth_role === "volunteer";

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <a href="/" className="nav-brand">
            <img src="/logo.png" alt="Atlas" className="nav-logo" />
            <span>Atlas</span>
          </a>

          <GlobalSearch />

          <div className="nav-links">
            {/* Main Navigation - different for volunteers */}
            {isVolunteer ? (
              <>
                <a href="/" className="nav-link">
                  Dashboard
                </a>
                <a href="/requests" className="nav-link">
                  Requests
                </a>
                <a href="/beacon" className="nav-link">
                  Beacon
                </a>
              </>
            ) : (
              <>
                <a href="/requests" className="nav-link">
                  Requests
                </a>
                <a href="/cats" className="nav-link">
                  Cats
                </a>
                <a href="/people" className="nav-link">
                  People
                </a>
                <a href="/places" className="nav-link">
                  Places
                </a>
                <a href="/intake/queue" className="nav-link">
                  Intake
                </a>
                <a href="/beacon" className="nav-link">
                  Beacon
                </a>
                {isAdmin && (
                  <a href="/admin" className="nav-link" style={{ opacity: 0.7 }}>
                    Admin
                  </a>
                )}
              </>
            )}

            {/* User Menu */}
            {staff ? (
              <div ref={menuRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 12px",
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
                      fontSize: "0.75rem",
                    }}
                  >
                    {staff.display_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {staff.display_name}
                  </span>
                  <span style={{ fontSize: "0.6rem", opacity: 0.5 }}>▼</span>
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
                    <div
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--card-border)",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--foreground)" }}>
                        {staff.display_name}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {staff.email}
                      </div>
                      <div
                        style={{
                          marginTop: "6px",
                          display: "inline-block",
                          padding: "2px 8px",
                          background:
                            staff.auth_role === "admin"
                              ? "var(--info-bg)"
                              : staff.auth_role === "volunteer"
                              ? "var(--warning-bg)"
                              : "var(--success-bg)",
                          color:
                            staff.auth_role === "admin"
                              ? "var(--info-text)"
                              : staff.auth_role === "volunteer"
                              ? "var(--warning-text)"
                              : "var(--success-text)",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 500,
                          textTransform: "capitalize",
                        }}
                      >
                        {staff.auth_role}
                      </div>
                    </div>

                    {/* Admin Quick Access */}
                    {isAdmin && (
                      <div
                        style={{
                          padding: "8px 0",
                          borderBottom: "1px solid var(--card-border)",
                        }}
                      >
                        <div style={{ padding: "4px 16px", fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Admin Tools
                        </div>
                        <a
                          href="/admin/identity-health"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Identity Health
                        </a>
                        <a
                          href="/admin/intake-fields"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Intake Fields
                        </a>
                        <a
                          href="/admin/data-engine/review"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Data Engine Review
                        </a>
                        <a
                          href="/admin/tippy-feedback"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Tippy Feedback
                        </a>
                        <a
                          href="/admin/data-improvements"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Data Improvements
                        </a>
                        <a
                          href="/admin/ai-extraction"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          AI Extraction
                        </a>
                        <a
                          href="/admin/auth"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Staff Auth
                        </a>
                        <a
                          href="/admin/clinic-days"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Clinic Days
                        </a>
                        <a
                          href="/admin/knowledge-base"
                          style={{
                            display: "block",
                            padding: "8px 16px",
                            fontSize: "0.875rem",
                            color: "var(--foreground)",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--section-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          Knowledge Base
                        </a>
                      </div>
                    )}

                    {/* Menu Items */}
                    <div style={{ padding: "8px 0" }}>
                      <a
                        href="/me"
                        style={{
                          display: "block",
                          padding: "8px 16px",
                          fontSize: "0.875rem",
                          color: "var(--foreground)",
                          textDecoration: "none",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--section-bg)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        My Dashboard
                      </a>
                      <a
                        href={`/admin/staff/${staff.staff_id}`}
                        style={{
                          display: "block",
                          padding: "8px 16px",
                          fontSize: "0.875rem",
                          color: "var(--foreground)",
                          textDecoration: "none",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--section-bg)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        My Profile
                      </a>
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
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--section-bg)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
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
                }}
              >
                Sign In
              </a>
            )}
          </div>
        </div>
      </nav>
      <main className="container">{children}</main>
    </>
  );
}
