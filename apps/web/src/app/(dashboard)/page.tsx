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
  cats_this_month: number;
  stale_requests: number;
  overdue_intake: number;
  unassigned_requests: number;
  needs_attention_total: number;
  requests_with_location: number;
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
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [myRequests, setMyRequests] = useState<ActiveRequest[]>([]);
  const [intake, setIntake] = useState<IntakeSubmission[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingIntake, setLoadingIntake] = useState(true);
  const [isMyRequests, setIsMyRequests] = useState(false);

  useEffect(() => {
    // 1. Auth (immediate) — cascades into "my requests"
    fetch("/api/auth/me")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.authenticated && data.staff) {
          setStaff(data.staff);
          // 4. Fetch requests assigned to me (cascades from auth)
          const personId = data.staff.person_id;
          if (personId) {
            setIsMyRequests(true);
            fetch(`/api/requests?assigned_to_person=${personId}&limit=5`)
              .then(res => res.ok ? res.json() : { requests: [] })
              .then(d => {
                const active = (d.requests || []).filter(
                  (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
                );
                setMyRequests(active.slice(0, 5));
              })
              .catch(() => setMyRequests([]))
              .finally(() => setLoadingRequests(false));
          } else {
            // Fallback: show all active requests
            fetch("/api/requests?limit=5")
              .then(res => res.ok ? res.json() : { requests: [] })
              .then(d => {
                const active = (d.requests || []).filter(
                  (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
                );
                setMyRequests(active.slice(0, 5));
              })
              .catch(() => setMyRequests([]))
              .finally(() => setLoadingRequests(false));
          }
        } else {
          // Not authenticated — still load requests
          fetch("/api/requests?limit=5")
            .then(res => res.ok ? res.json() : { requests: [] })
            .then(d => {
              const active = (d.requests || []).filter(
                (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
              );
              setMyRequests(active.slice(0, 5));
            })
            .catch(() => setMyRequests([]))
            .finally(() => setLoadingRequests(false));
        }
      })
      .catch(() => {
        setLoadingRequests(false);
      });

    // 2. Dashboard stats (immediate, parallel)
    fetch("/api/dashboard/stats")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && !data.error) setStats(data);
      })
      .catch(() => {});

    // 3. Recent intake (immediate, parallel)
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
      {stats && stats.needs_attention_total > 0 && (
        <div className="attention-bar">
          {stats.stale_requests > 0 && (
            <a href="/requests?sort_by=created" className="attention-chip">
              <span className="chip-count">{stats.stale_requests}</span> stale requests
            </a>
          )}
          {stats.overdue_intake > 0 && (
            <a href="/intake/queue?mode=attention" className="attention-chip">
              <span className="chip-count">{stats.overdue_intake}</span> overdue intake
            </a>
          )}
          {stats.unassigned_requests > 0 && (
            <a href="/requests?trapper=needs_trapper" className="attention-chip">
              <span className="chip-count">{stats.unassigned_requests}</span> unassigned
            </a>
          )}
        </div>
      )}

      {/* 3. Stat Pills */}
      <div className="stat-pills">
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
        {/* Left: My Active Requests */}
        <div className="dashboard-card">
          <h2>
            {isMyRequests ? "My Active Requests" : "Active Requests"}
            <a href={isMyRequests ? "/requests" : "/requests"}>View all</a>
          </h2>

          {loadingRequests ? (
            <p className="text-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
              Loading...
            </p>
          ) : myRequests.length === 0 ? (
            <p className="text-muted" style={{ textAlign: "center", padding: "1rem 0" }}>
              {isMyRequests ? "No requests assigned to you" : "No active requests"}
            </p>
          ) : (
            myRequests.map(req => {
              const city = req.place_city || extractCity(req.place_address) || extractCity(req.place_name);
              return (
                <a
                  key={req.request_id}
                  href={`/requests/${req.request_id}`}
                  className="dashboard-card-row"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <PriorityDot priority={req.priority} />
                  <span className="row-summary">
                    {req.summary || req.place_name || "Untitled"}
                  </span>
                  {city && <span className="row-city">{city}</span>}
                  <StatusBadge status={req.status} variant="soft" size="sm" />
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

      {/* 6. My Items */}
      <MyItemsWidget maxItems={3} />
    </div>
  );
}
