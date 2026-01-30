"use client";

import { useState, useEffect } from "react";
import { formatDateLocal } from "@/lib/formatters";
import { MyItemsWidget } from "@/components/MyItemsWidget";
import { StatusBadge, PriorityDot } from "@/components/StatusBadge";

interface ActiveRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_name: string | null;
  created_at: string;
  scheduled_date: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  latitude: number | null;
  longitude: number | null;
  updated_at?: string;
}

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  geo_formatted_address: string | null;
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  triage_category: string | null;
  triage_score: number | null;
  cat_count_estimate: number | null;
  has_kittens: boolean | null;
  is_legacy: boolean;
  is_emergency: boolean;
  overdue: boolean;
  contact_attempt_count: number | null;
}

interface DashboardStats {
  active_requests: number;
  pending_intake: number;
  trappers_active: number;
  cats_this_month: number;
}

// Normalize capitalization (JOHN SMITH -> John Smith)
function normalizeName(name: string | null): string {
  if (!name) return "";
  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    return name
      .toLowerCase()
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return name;
}


// Helper to check if a date is stale (more than N days ago)
function isStale(dateStr: string | null | undefined, daysThreshold: number): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > daysThreshold;
}

// Extract city from address string (e.g., "123 Main St, Santa Rosa, CA 95407" -> "Santa Rosa")
function extractCity(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map(p => p.trim());
  // City is usually the second-to-last part before state/zip
  if (parts.length >= 2) {
    // Check if second part looks like a city (not a street type or state)
    const candidate = parts[1];
    if (candidate && !candidate.match(/^\d/) && !candidate.match(/^(CA|California)\s*\d/i)) {
      return candidate;
    }
  }
  return null;
}

function RequestRow({ request }: { request: ActiveRequest }) {
  const isRequestStale = isStale(request.updated_at || request.created_at, 14) && request.status !== "on_hold";
  const displayCity = request.place_city || extractCity(request.place_address) || extractCity(request.place_name);

  return (
    <a
      href={`/requests/${request.request_id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderBottom: "1px solid var(--card-border)",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--card-hover, rgba(0,0,0,0.02))"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <PriorityDot priority={request.priority} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500,
          fontSize: "0.9rem",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {request.summary || request.place_name || "Untitled"}
        </div>
        <div style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}>
          <span>{displayCity || "Unknown location"}</span>
          {request.estimated_cat_count && (
            <span style={{ color: "#6b7280" }}>
              {request.estimated_cat_count} cats
            </span>
          )}
          {request.has_kittens && (
            <span style={{ color: "#f97316" }}>+kittens</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {isRequestStale && (
          <span style={{
            fontSize: "0.6rem",
            fontWeight: 600,
            padding: "2px 6px",
            background: "#fee2e2",
            color: "#dc2626",
            borderRadius: "4px",
          }}>
            STALE
          </span>
        )}
        <StatusBadge status={request.status} variant="soft" size="sm" />
      </div>
    </a>
  );
}

function IntakeRow({ submission }: { submission: IntakeSubmission }) {
  const status = submission.submission_status || "new";

  return (
    <a
      href={`/intake/queue?open=${submission.submission_id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderBottom: "1px solid var(--card-border)",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s",
        background: submission.is_emergency ? "rgba(220, 53, 69, 0.05)" :
                   submission.overdue ? "rgba(255, 193, 7, 0.05)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!submission.is_emergency && !submission.overdue) {
          e.currentTarget.style.background = "var(--card-hover, rgba(0,0,0,0.02))";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = submission.is_emergency ? "rgba(220, 53, 69, 0.05)" :
                                           submission.overdue ? "rgba(255, 193, 7, 0.05)" : "transparent";
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500,
          fontSize: "0.9rem",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          {normalizeName(submission.submitter_name)}
          {submission.is_emergency && (
            <span style={{
              fontSize: "0.6rem",
              fontWeight: 600,
              padding: "1px 4px",
              background: "#dc2626",
              color: "#fff",
              borderRadius: "2px",
            }}>
              URGENT
            </span>
          )}
        </div>
        <div style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {submission.geo_formatted_address || submission.cats_address}
          {submission.cat_count_estimate && (
            <span style={{ marginLeft: "8px", color: "#6b7280" }}>
              {submission.cat_count_estimate} cats
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {submission.overdue && (
          <span style={{
            fontSize: "0.6rem",
            fontWeight: 600,
            padding: "2px 6px",
            background: "#fef3c7",
            color: "#92400e",
            borderRadius: "4px",
          }}>
            OVERDUE
          </span>
        )}
        <StatusBadge status={status} variant="soft" size="sm" />
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: "50px", textAlign: "right" }}>
          {formatDateLocal(submission.submitted_at)}
        </span>
      </div>
    </a>
  );
}

function StatCard({
  value,
  label,
  href,
  color = "#0d6efd",
  trend,
}: {
  value: number | string;
  label: string;
  href: string;
  color?: string;
  trend?: { value: number; label: string };
}) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: "20px",
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "12px",
        textDecoration: "none",
        color: "inherit",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ fontSize: "2rem", fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}>
        {label}
      </div>
      {trend && (
        <div style={{
          fontSize: "0.7rem",
          marginTop: "8px",
          color: trend.value >= 0 ? "#16a34a" : "#dc2626",
        }}>
          {trend.value >= 0 ? "+" : ""}{trend.value} {trend.label}
        </div>
      )}
    </a>
  );
}

function QuickAction({
  icon,
  label,
  href,
  description,
}: {
  icon: string;
  label: string;
  href: string;
  description?: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "16px",
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "10px",
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#0d6efd";
        e.currentTarget.style.background = "rgba(13, 110, 253, 0.02)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--card-border)";
        e.currentTarget.style.background = "var(--card-bg)";
      }}
    >
      <span style={{ fontSize: "1.5rem" }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{label}</div>
        {description && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{description}</div>
        )}
      </div>
    </a>
  );
}

export default function Home() {
  const [requests, setRequests] = useState<ActiveRequest[]>([]);
  const [intakeSubmissions, setIntakeSubmissions] = useState<IntakeSubmission[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    active_requests: 0,
    pending_intake: 0,
    trappers_active: 0,
    cats_this_month: 0,
  });
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingIntake, setLoadingIntake] = useState(true);
  const [attentionCount, setAttentionCount] = useState(0);

  useEffect(() => {
    // Fetch active requests (not completed/cancelled)
    fetch("/api/requests?limit=50")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data) => {
        const allRequests = data.requests || [];
        const active = allRequests.filter(
          (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
        );
        setRequests(active.slice(0, 6));
        setStats(prev => ({ ...prev, active_requests: active.length }));

        // Count stale/urgent requests
        const needsAttention = active.filter((r: ActiveRequest) =>
          isStale(r.updated_at || r.created_at, 14) && r.status !== "on_hold"
        ).length;
        setAttentionCount(prev => prev + needsAttention);
      })
      .catch(() => setRequests([]))
      .finally(() => setLoadingRequests(false));

    // Fetch intake submissions needing attention
    fetch("/api/intake/queue?mode=attention&limit=50")
      .then((res) => (res.ok ? res.json() : { submissions: [] }))
      .then((data) => {
        const subs = data.submissions || [];
        setIntakeSubmissions(subs.slice(0, 6));
        setStats(prev => ({ ...prev, pending_intake: subs.length }));

        const overdueCount = subs.filter((s: IntakeSubmission) => s.overdue || s.is_emergency).length;
        setAttentionCount(prev => prev + overdueCount);
      })
      .catch(() => setIntakeSubmissions([]))
      .finally(() => setLoadingIntake(false));

    // Fetch dashboard stats
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setStats(prev => ({
            ...prev,
            trappers_active: data.trappers_active || 0,
            cats_this_month: data.cats_this_month || 0,
          }));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "24px",
      }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
            Forgotten Felines of Sonoma County
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <a
            href="/requests/new"
            style={{
              padding: "10px 16px",
              background: "#0d6efd",
              color: "#fff",
              borderRadius: "8px",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            + New Request
          </a>
        </div>
      </div>

      {/* Attention Banner */}
      {!loadingRequests && !loadingIntake && attentionCount > 0 && (
        <div
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
            borderRadius: "12px",
            marginBottom: "24px",
            border: "1px solid #fecaca",
          }}
        >
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}>
            <span style={{ fontSize: "1.5rem" }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: "#991b1b" }}>
                {attentionCount} item{attentionCount > 1 ? "s" : ""} need attention
              </div>
              <div style={{ fontSize: "0.8rem", color: "#b91c1c" }}>
                Overdue intake submissions or stale requests require follow-up
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: "16px",
        marginBottom: "32px",
      }}>
        <StatCard
          value={stats.active_requests}
          label="Active Requests"
          href="/requests"
          color="#0d6efd"
        />
        <StatCard
          value={stats.pending_intake}
          label="Pending Intake"
          href="/intake/queue"
          color="#f97316"
        />
        <StatCard
          value={stats.trappers_active}
          label="Active Trappers"
          href="/trappers"
          color="#16a34a"
        />
        <StatCard
          value={stats.cats_this_month}
          label="Cats This Month"
          href="/cats"
          color="#8b5cf6"
        />
      </div>

      {/* Main Content Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "24px",
      }}>
        {/* Active Requests Panel */}
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--card-border)",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
              Trapping Requests
            </h2>
            <a
              href="/requests"
              style={{
                fontSize: "0.8rem",
                color: "#0d6efd",
                textDecoration: "none",
              }}
            >
              View all →
            </a>
          </div>

          {loadingRequests ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading...
            </div>
          ) : requests.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center" }}>
              <div style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                No active requests
              </div>
              <a
                href="/requests/new"
                style={{ fontSize: "0.875rem", color: "#0d6efd" }}
              >
                Create your first request
              </a>
            </div>
          ) : (
            <div>
              {requests.map((req) => (
                <RequestRow key={req.request_id} request={req} />
              ))}
            </div>
          )}
        </div>

        {/* Intake Submissions Panel */}
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--card-border)",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
              Website Submissions
            </h2>
            <a
              href="/intake/queue"
              style={{
                fontSize: "0.8rem",
                color: "#0d6efd",
                textDecoration: "none",
              }}
            >
              Triage queue →
            </a>
          </div>

          {loadingIntake ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading...
            </div>
          ) : intakeSubmissions.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
              No pending submissions
            </div>
          ) : (
            <div>
              {intakeSubmissions.map((sub) => (
                <IntakeRow key={sub.submission_id} submission={sub} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* My Items Section */}
      <div style={{ marginTop: "24px" }}>
        <MyItemsWidget maxItems={3} />
      </div>

      {/* Quick Actions */}
      <div style={{ marginTop: "32px" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px" }}>
          Quick Actions
        </h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "12px",
        }}>
          <QuickAction
            icon="🐱"
            label="Browse Cats"
            href="/cats"
            description="Search the registry"
          />
          <QuickAction
            icon="👥"
            label="People"
            href="/people"
            description="Contacts & requesters"
          />
          <QuickAction
            icon="📍"
            label="Places"
            href="/places"
            description="Addresses & colonies"
          />
          <QuickAction
            icon="🗺️"
            label="Map"
            href="/map"
            description="Atlas geographic view"
          />
          <QuickAction
            icon="🎓"
            label="Trappers"
            href="/trappers"
            description="Volunteer management"
          />
          <QuickAction
            icon="⚙️"
            label="Admin"
            href="/admin"
            description="Settings & analytics"
          />
          <QuickAction
            icon="🔍"
            label="Search"
            href="/search"
            description="Find anything"
          />
        </div>
      </div>
    </div>
  );
}
