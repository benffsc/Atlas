"use client";

import { useState, useEffect } from "react";

interface ActiveRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  place_city: string | null;
  requester_name: string | null;
  created_at: string;
  scheduled_date: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  latitude: number | null;
  longitude: number | null;
}

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  // Geocoded address
  geo_formatted_address: string | null;
  geo_confidence: string | null;
  // Unified status (primary)
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  native_status: string;
  triage_category: string | null;
  triage_score: number | null;
  cat_count_estimate: number | null;
  has_kittens: boolean | null;
  is_legacy: boolean;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  is_emergency: boolean;
  overdue: boolean;
  intake_source: string | null;
  contact_attempt_count: number | null;
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    new: { bg: "#0d6efd", color: "#fff" },
    triaged: { bg: "#6610f2", color: "#fff" },
    scheduled: { bg: "#198754", color: "#fff" },
    in_progress: { bg: "#fd7e14", color: "#000" },
    completed: { bg: "#20c997", color: "#000" },
    cancelled: { bg: "#6c757d", color: "#fff" },
    on_hold: { bg: "#ffc107", color: "#000" },
    pending: { bg: "#17a2b8", color: "#fff" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };
  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#dc3545", color: "#fff" },
    high: { bg: "#fd7e14", color: "#000" },
    normal: { bg: "#6c757d", color: "#fff" },
    low: { bg: "#adb5bd", color: "#000" },
  };
  const style = colors[priority] || { bg: "#6c757d", color: "#fff" };
  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}
    >
      {priority}
    </span>
  );
}

function ColonySizeBadge({ count }: { count: number | null }) {
  const catCount = count ?? 0;
  let style: { bg: string; color: string; label: string };

  if (catCount >= 20) {
    style = { bg: "#dc3545", color: "#fff", label: `${catCount}+` };
  } else if (catCount >= 7) {
    style = { bg: "#fd7e14", color: "#000", label: `${catCount}` };
  } else if (catCount >= 2) {
    style = { bg: "#0d6efd", color: "#fff", label: `${catCount}` };
  } else {
    style = { bg: "#6c757d", color: "#fff", label: catCount ? `${catCount}` : "?" };
  }

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}
      title={`${catCount} cats`}
    >
      🐱 {style.label}
    </span>
  );
}

function RequestMapPreview({ requestId, latitude, longitude }: {
  requestId: string;
  latitude: number | null;
  longitude: number | null;
}) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [nearbyCount, setNearbyCount] = useState<number>(0);

  useEffect(() => {
    if (!latitude || !longitude) return;

    const fetchMap = async () => {
      try {
        const response = await fetch(`/api/requests/${requestId}/map?width=400&height=200&zoom=15&scale=2`);
        if (response.ok) {
          const data = await response.json();
          setMapUrl(data.map_url);
          setNearbyCount(data.nearby_count);
        }
      } catch (err) {
        console.error("Failed to fetch map:", err);
      }
    };

    fetchMap();
  }, [requestId, latitude, longitude]);

  if (!latitude || !longitude) {
    return (
      <div
        style={{
          width: "100%",
          height: "140px",
          background: "var(--card-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px 8px 0 0",
          color: "var(--text-muted)",
          fontSize: "0.875rem",
        }}
      >
        No location
      </div>
    );
  }

  if (!mapUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "140px",
          background: "var(--card-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <img
        src={mapUrl}
        alt="Location map"
        style={{
          width: "100%",
          height: "140px",
          objectFit: "cover",
          borderRadius: "8px 8px 0 0",
        }}
      />
      {nearbyCount > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "6px",
            right: "6px",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "2px 6px",
            borderRadius: "4px",
            fontSize: "0.7rem",
          }}
        >
          {nearbyCount} nearby
        </div>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: ActiveRequest }) {
  return (
    <a
      href={`/requests/${request.request_id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        className="card"
        style={{
          padding: 0,
          border: "1px solid var(--card-border)",
          borderRadius: "10px",
          overflow: "hidden",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "none";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {/* Map Preview */}
        <RequestMapPreview
          requestId={request.request_id}
          latitude={request.latitude}
          longitude={request.longitude}
        />

        {/* Card Content */}
        <div style={{ padding: "10px" }}>
          {/* Badges Row */}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "6px" }}>
            <StatusBadge status={request.status} />
            <PriorityBadge priority={request.priority} />
            <ColonySizeBadge count={request.estimated_cat_count} />
            {request.has_kittens && (
              <span className="badge" style={{ background: "#fd7e14", color: "#000", fontSize: "0.65rem" }}>
                +kittens
              </span>
            )}
          </div>

          {/* Title */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.9rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {request.summary || request.place_name || "Untitled"}
          </div>

          {/* Location */}
          {request.place_name && request.summary && (
            <div
              className="text-muted"
              style={{
                fontSize: "0.75rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {request.place_name}
              {request.place_city && ` • ${request.place_city}`}
            </div>
          )}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              marginTop: "6px",
            }}
          >
            <span>{request.requester_name || "Unknown"}</span>
            <span>
              {request.scheduled_date
                ? new Date(request.scheduled_date).toLocaleDateString()
                : new Date(request.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}

export default function Home() {
  const [requests, setRequests] = useState<ActiveRequest[]>([]);
  const [intakeSubmissions, setIntakeSubmissions] = useState<IntakeSubmission[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingIntake, setLoadingIntake] = useState(true);

  useEffect(() => {
    // Fetch active requests (not completed/cancelled)
    fetch("/api/requests?limit=8")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data) => {
        // Filter out completed/cancelled for dashboard
        const active = (data.requests || []).filter(
          (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
        );
        setRequests(active.slice(0, 8)); // Limit to 8 cards
      })
      .catch(() => setRequests([]))
      .finally(() => setLoadingRequests(false));

    // Fetch intake submissions needing attention using unified status
    fetch("/api/intake/queue?mode=attention&limit=10")
      .then((res) => (res.ok ? res.json() : { submissions: [] }))
      .then((data) => {
        // The API already filters to new/in_progress status
        setIntakeSubmissions(data.submissions || []);
      })
      .catch(() => setIntakeSubmissions([]))
      .finally(() => setLoadingIntake(false));
  }, []);

  return (
    <div>
      <h1>Atlas Dashboard</h1>

      {/* Quick Links: Cats, People, Places */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
          marginTop: "1.5rem",
        }}
      >
        <a href="/cats" className="card" style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: "1.5rem" }}>Cats</h2>
          <p className="text-muted text-sm">Browse the cat registry</p>
        </a>

        <a href="/people" className="card" style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: "1.5rem" }}>People</h2>
          <p className="text-muted text-sm">Owners, requesters, contacts</p>
        </a>

        <a href="/places" className="card" style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: "1.5rem" }}>Places</h2>
          <p className="text-muted text-sm">Addresses and locations</p>
        </a>
      </div>

      {/* Active Trapping Requests Section */}
      <div style={{ marginTop: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2>Trapping Requests</h2>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <a
              href="/requests"
              style={{
                padding: "0.4rem 0.8rem",
                borderRadius: "6px",
                textDecoration: "none",
                border: "1px solid var(--card-border)",
                fontSize: "0.875rem",
              }}
            >
              View All →
            </a>
            <a
              href="/requests/new"
              style={{
                padding: "0.4rem 0.8rem",
                background: "var(--foreground)",
                color: "var(--background)",
                borderRadius: "6px",
                textDecoration: "none",
                fontSize: "0.875rem",
              }}
            >
              + New
            </a>
          </div>
        </div>

        {loadingRequests ? (
          <div className="text-muted">Loading requests...</div>
        ) : requests.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: "center", padding: "2rem" }}
          >
            <p className="text-muted">No active requests</p>
            <a href="/requests/new" style={{ marginTop: "0.5rem", display: "inline-block" }}>
              Create your first request
            </a>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {requests.map((req) => (
              <RequestCard key={req.request_id} request={req} />
            ))}
          </div>
        )}
      </div>

      {/* Website Submissions Section (TNR Intake Queue) */}
      <div style={{ marginTop: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <div>
            <h2>Website Submissions</h2>
            <p className="text-muted text-sm" style={{ margin: 0 }}>
              FFR requests from the website. Review, gather details, then create a Trapping Request.
            </p>
          </div>
          <a
            href="/intake/queue"
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              textDecoration: "none",
              border: "1px solid var(--card-border)",
              fontSize: "0.875rem",
              color: "var(--foreground)",
              background: "var(--card-bg)",
            }}
          >
            Triage Queue →
          </a>
        </div>

        {loadingIntake ? (
          <div className="text-muted">Loading submissions...</div>
        ) : intakeSubmissions.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: "center", padding: "2rem" }}
          >
            <p className="text-muted">No submissions needing review</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "60px" }}>Type</th>
                  <th>Submitter</th>
                  <th>Location</th>
                  <th style={{ width: "60px" }}>Cats</th>
                  <th style={{ width: "100px" }}>Status</th>
                  <th style={{ width: "80px" }}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {intakeSubmissions.map((sub) => (
                  <tr
                    key={sub.submission_id}
                    onClick={() => window.location.href = `/intake/queue?open=${sub.submission_id}`}
                    style={{
                      background: sub.is_emergency ? "rgba(220, 53, 69, 0.1)" : sub.overdue ? "rgba(255, 193, 7, 0.1)" : undefined,
                      cursor: "pointer",
                    }}
                  >
                    {/* Type column */}
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: sub.is_legacy ? "#6c757d" : "#198754",
                          color: "#fff",
                          fontSize: "0.65rem",
                        }}
                      >
                        {sub.is_legacy ? "Legacy" : "Native"}
                      </span>
                    </td>
                    {/* Submitter column */}
                    <td>
                      <div style={{ fontWeight: 500 }}>{normalizeName(sub.submitter_name)}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.email}</div>
                      {sub.phone && <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.phone}</div>}
                    </td>
                    {/* Location column */}
                    <td>
                      <div>
                        {sub.geo_formatted_address || sub.cats_address}
                      </div>
                      {sub.geo_formatted_address && sub.geo_formatted_address !== sub.cats_address && (
                        <div style={{ fontSize: "0.65rem", color: "var(--muted)", fontStyle: "italic" }}>
                          (original: {sub.cats_address})
                        </div>
                      )}
                      {!sub.geo_formatted_address && sub.cats_city && (
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.cats_city}</div>
                      )}
                      {!sub.geo_formatted_address && sub.geo_confidence === null && (
                        <span style={{ fontSize: "0.6rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "2px" }}>
                          needs geocoding
                        </span>
                      )}
                    </td>
                    {/* Cats column */}
                    <td>
                      <div>{sub.cat_count_estimate ?? "?"}</div>
                      {sub.has_kittens && <span style={{ fontSize: "0.7rem", color: "#fd7e14" }}>+kittens</span>}
                    </td>
                    {/* Status column */}
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        {/* Unified status badge */}
                        <span
                          className="badge"
                          style={{
                            background: sub.submission_status === "new" ? "#0d6efd" :
                                       sub.submission_status === "in_progress" ? "#fd7e14" :
                                       sub.submission_status === "scheduled" ? "#198754" :
                                       sub.submission_status === "complete" ? "#20c997" :
                                       "#6c757d",
                            color: sub.submission_status === "in_progress" ? "#000" : "#fff",
                            fontSize: "0.65rem",
                          }}
                        >
                          {sub.submission_status === "new" ? "New" :
                           sub.submission_status === "in_progress" ? "In Progress" :
                           sub.submission_status === "scheduled" ? "Scheduled" :
                           sub.submission_status === "complete" ? "Complete" :
                           sub.submission_status || "Unknown"}
                        </span>
                        {/* Triage category */}
                        {sub.triage_category && (
                          <span
                            className="badge"
                            style={{
                              background: sub.triage_category === "high_priority_tnr" ? "#dc3545" :
                                         sub.triage_category === "standard_tnr" ? "#0d6efd" :
                                         "#6c757d",
                              color: "#fff",
                              fontSize: "0.6rem",
                            }}
                          >
                            {sub.triage_category.replace(/_/g, " ")}
                          </span>
                        )}
                        {/* Appointment date if scheduled */}
                        {sub.appointment_date && (
                          <span style={{ fontSize: "0.7rem", color: "#198754" }}>
                            {new Date(sub.appointment_date).toLocaleDateString()}
                          </span>
                        )}
                        {sub.is_emergency && (
                          <span style={{ color: "#dc3545", fontSize: "0.65rem", fontWeight: "bold" }}>
                            EMERGENCY
                          </span>
                        )}
                        {/* Contact attempts */}
                        {sub.contact_attempt_count && sub.contact_attempt_count > 0 && (
                          <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>
                            {sub.contact_attempt_count} contact{sub.contact_attempt_count > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Submitted column */}
                    <td className="text-sm text-muted">
                      {new Date(sub.submitted_at).toLocaleDateString()}
                      {sub.overdue && (
                        <div style={{ fontSize: "0.65rem", color: "#dc3545", fontWeight: 500 }}>
                          overdue
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
