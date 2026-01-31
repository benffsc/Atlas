"use client";

import { useState, useEffect } from "react";
import { formatDateLocal } from "@/lib/formatters";
import { MyItemsWidget } from "@/components/MyItemsWidget";
import { StatusBadge, PriorityDot } from "@/components/StatusBadge";
import { useIsMobile } from "@/hooks/useIsMobile";

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
  cats_this_month: number;
  stale_requests: number;
  overdue_intake: number;
  unassigned_requests: number;
  needs_attention_total: number;
  requests_with_location: number;
  my_active_requests: number;
  person_dedup_pending: number;
  place_dedup_pending: number;
}

interface StaffInfo {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: string;
  person_id: string | null;
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(displayName: string): string {
  return displayName.split(" ")[0] || displayName;
}

// Extract city from address string
function extractCity(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map(p => p.trim());
  if (parts.length >= 2) {
    const candidate = parts[1];
    if (candidate && !candidate.match(/^\d/) && !candidate.match(/^(CA|California)\s*\d/i)) {
      return candidate;
    }
  }
  return null;
}

export default function Home() {
  const isMobile = useIsMobile();
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [requests, setRequests] = useState<ActiveRequest[]>([]);
  const [intake, setIntake] = useState<IntakeSubmission[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingIntake, setLoadingIntake] = useState(true);
  const [showMyRequests, setShowMyRequests] = useState(true);

  // Fetch auth first, then kick off dependent fetches
  useEffect(() => {
    let staffData: StaffInfo | null = null;

    // 1. Auth (for greeting + person_id)
    fetch("/api/auth/me")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.authenticated && data.staff) {
          staffData = data.staff;
          setStaff(data.staff);
        }
      })
      .catch(() => {})
      .finally(() => {
        // 2. Active requests
        fetch("/api/requests?limit=8")
          .then(res => res.ok ? res.json() : { requests: [] })
          .then(data => {
            const active = (data.requests || []).filter(
              (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
            );
            setRequests(active.slice(0, 6));
          })
          .catch(() => setRequests([]))
          .finally(() => setLoadingRequests(false));

        // 3. Dashboard stats (with staff_person_id for "my requests" count)
        const statsUrl = staffData?.person_id
          ? `/api/dashboard/stats?staff_person_id=${staffData.person_id}`
          : "/api/dashboard/stats";
        fetch(statsUrl)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data && !data.error) setStats(data);
          })
          .catch(() => {});
      });

    // 4. Recent intake (parallel, no auth dependency)
    fetch("/api/intake/queue?mode=attention&limit=5")
      .then(res => res.ok ? res.json() : { submissions: [] })
      .then(data => setIntake((data.submissions || []).slice(0, 5)))
      .catch(() => setIntake([]))
      .finally(() => setLoadingIntake(false));
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
      {/* 1. Personal Greeting */}
      <div className="dashboard-greeting">
        <div>
          <h1>
            {staff
              ? `${getGreeting()}, ${getFirstName(staff.display_name)}`
              : "Dashboard"}
          </h1>
          <div className="date-line">{today}</div>
        </div>
        <a
          href="/requests/new"
          className="btn btn-primary"
          style={{ whiteSpace: "nowrap" }}
        >
          + New Request
        </a>
      </div>

      {/* 2. Needs Attention Bar */}
      {stats && (stats.needs_attention_total > 0 || (staff?.auth_role === "admin" && (stats.person_dedup_pending > 0 || stats.place_dedup_pending > 0))) && (
        <div className="attention-bar" style={{ flexWrap: "wrap" }}>
          {stats.stale_requests > 0 && (
            <a href="/requests?sort=created&order=asc" className="attention-chip">
              <span className="chip-count">{stats.stale_requests}</span> stale requests
            </a>
          )}
          {stats.overdue_intake > 0 && (
            <a href="/intake/queue?mode=attention" className="attention-chip">
              <span className="chip-count">{stats.overdue_intake}</span> overdue intake
            </a>
          )}
          {stats.unassigned_requests > 0 && (
            <a href="/requests?trapper=pending" className="attention-chip">
              <span className="chip-count">{stats.unassigned_requests}</span> unassigned
            </a>
          )}
          {staff?.auth_role === "admin" && stats.person_dedup_pending > 0 && (
            <a href="/admin/person-dedup" className="attention-chip">
              <span className="chip-count">{stats.person_dedup_pending}</span> person dedup
            </a>
          )}
          {staff?.auth_role === "admin" && stats.place_dedup_pending > 0 && (
            <a href="/admin/place-dedup" className="attention-chip">
              <span className="chip-count">{stats.place_dedup_pending}</span> place dedup
            </a>
          )}
        </div>
      )}

      {/* 3. Stat Pills */}
      <div className="stat-pills" style={{ flexWrap: "wrap", gap: "8px" }}>
        <a href="/requests" className="stat-pill blue">
          <span className="pill-count">{stats?.active_requests ?? "..."}</span>
          Active Requests
        </a>
        <a href="/intake/queue" className="stat-pill orange">
          <span className="pill-count">{stats?.pending_intake ?? "..."}</span>
          Pending Intake
        </a>
        <a href="/cats" className="stat-pill purple">
          <span className="pill-count">{stats?.cats_this_month ?? "..."}</span>
          Cats This Month
        </a>
      </div>

      {/* 4. Two-Column Content */}
      <div className="dashboard-grid">
        {/* Left: Active Requests */}
        <div className="dashboard-card">
          <h2>
            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
              {showMyRequests && staff?.person_id ? "My Requests" : "Active Requests"}
              {staff?.person_id && (
                <button
                  onClick={() => setShowMyRequests(!showMyRequests)}
                  style={{
                    fontSize: "0.7rem",
                    padding: "2px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    background: "transparent",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontWeight: 400,
                  }}
                >
                  {showMyRequests ? "Show All" : "Show Mine"}
                </button>
              )}
            </span>
            <a href="/requests">View all</a>
          </h2>

          {loadingRequests ? (
            <p className="text-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
              Loading...
            </p>
          ) : requests.length === 0 ? (
            <p className="text-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
              No active requests
            </p>
          ) : (
            requests.map(req => {
              const city = req.place_city || extractCity(req.place_address) || extractCity(req.place_name);
              const shortAddress = req.place_address
                ? req.place_address.split(",")[0]
                : req.place_name;
              return (
                <a
                  key={req.request_id}
                  href={`/requests/${req.request_id}`}
                  className="dashboard-card-row"
                  style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
                >
                  <PriorityDot priority={req.priority} />
                  <span className="row-summary">
                    {req.summary || req.place_name || "Untitled"}
                  </span>
                  <StatusBadge status={req.status} variant="soft" size="sm" />
                  {shortAddress && (
                    <span style={{
                      width: "100%",
                      paddingLeft: "1.25rem",
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {shortAddress}{city && city !== shortAddress ? `, ${city}` : ""}
                    </span>
                  )}
                </a>
              );
            })
          )}
        </div>

        {/* Right: Recent Intake */}
        <div className="dashboard-card">
          <h2>
            Recent Intake
            <a href="/intake/queue">Triage queue</a>
          </h2>

          {loadingIntake ? (
            <p className="text-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
              Loading...
            </p>
          ) : intake.length === 0 ? (
            <p className="text-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
              No pending submissions
            </p>
          ) : (
            intake.map(sub => (
              <a
                key={sub.submission_id}
                href={`/intake/queue?open=${sub.submission_id}`}
                className="dashboard-card-row"
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  background: sub.is_emergency
                    ? "rgba(220, 53, 69, 0.05)"
                    : sub.overdue
                      ? "rgba(255, 193, 7, 0.05)"
                      : undefined,
                }}
              >
                <span className="row-summary">
                  {normalizeName(sub.submitter_name)}
                  {sub.is_emergency && (
                    <span style={{
                      fontSize: "0.6rem",
                      fontWeight: 600,
                      padding: "1px 4px",
                      background: "#dc2626",
                      color: "#fff",
                      borderRadius: "2px",
                      marginLeft: "6px",
                      verticalAlign: "middle",
                    }}>
                      URGENT
                    </span>
                  )}
                </span>
                {sub.overdue && (
                  <span style={{
                    fontSize: "0.6rem",
                    fontWeight: 600,
                    padding: "2px 6px",
                    background: "#fef3c7",
                    color: "#92400e",
                    borderRadius: "4px",
                    flexShrink: 0,
                  }}>
                    OVERDUE
                  </span>
                )}
                <StatusBadge status={sub.submission_status || "new"} variant="soft" size="sm" />
                <span className="row-city">{formatDateLocal(sub.submitted_at)}</span>
              </a>
            ))
          )}
        </div>
      </div>

      {/* 5. Map Preview (desktop only) */}
      {!isMobile && (
        <div className="map-preview">
          <div className="map-preview-card">
            <div>
              <div className="map-label">Active requests on map</div>
              <div className="map-count">
                {stats?.requests_with_location ?? "..."} with location data
              </div>
            </div>
            <a href="/map" className="btn btn-primary" style={{ fontSize: "0.85rem" }}>
              Open Map
            </a>
          </div>
        </div>
      )}

      {/* 6. My Items */}
      <MyItemsWidget maxItems={3} />
    </div>
  );
}
