"use client";

import { useState, useEffect } from "react";

interface ActiveRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  requester_name: string | null;
  created_at: string;
  scheduled_date: string | null;
}

interface AppointmentRequest {
  appointment_id: string;
  status: string;
  requester_name: string | null;
  requester_phone: string | null;
  cat_name: string | null;
  reason: string | null;
  submitted_at: string;
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

export default function Home() {
  const [requests, setRequests] = useState<ActiveRequest[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(true);

  useEffect(() => {
    // Fetch active requests (not completed/cancelled)
    fetch("/api/requests?limit=10")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data) => {
        // Filter out completed/cancelled for dashboard
        const active = (data.requests || []).filter(
          (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
        );
        setRequests(active);
      })
      .catch(() => setRequests([]))
      .finally(() => setLoadingRequests(false));

    // Fetch pending appointment requests
    fetch("/api/appointments?status=pending&limit=10")
      .then((res) => (res.ok ? res.json() : { appointments: [] }))
      .then((data) => setAppointments(data.appointments || []))
      .catch(() => setAppointments([]))
      .finally(() => setLoadingAppointments(false));
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

      {/* Active Requests Section */}
      <div style={{ marginTop: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2>Active Requests</h2>
          <a href="/requests/new" className="badge-primary" style={{ padding: "0.5rem 1rem", borderRadius: "6px", textDecoration: "none" }}>
            + New Request
          </a>
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
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "1rem",
            }}
          >
            {requests.map((req) => (
              <a
                key={req.request_id}
                href={`/requests/${req.request_id}`}
                className="card"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <StatusBadge status={req.status} />
                  <PriorityBadge priority={req.priority} />
                </div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>
                  {req.summary || req.place_name || "Untitled Request"}
                </h3>
                {req.place_name && req.summary && (
                  <p className="text-muted text-sm">{req.place_name}</p>
                )}
                <div
                  className="text-muted text-sm"
                  style={{ marginTop: "0.5rem" }}
                >
                  {req.scheduled_date
                    ? `Scheduled: ${new Date(req.scheduled_date).toLocaleDateString()}`
                    : `Created: ${new Date(req.created_at).toLocaleDateString()}`}
                </div>
              </a>
            ))}
          </div>
        )}
        <div style={{ marginTop: "1rem", textAlign: "center" }}>
          <a href="/requests">View all requests</a>
        </div>
      </div>

      {/* Appointment Requests Section (from website form) */}
      <div style={{ marginTop: "2.5rem" }}>
        <h2 style={{ marginBottom: "1rem" }}>Website Submissions</h2>
        <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          Appointment requests submitted through the website form. Call back to gather details.
        </p>

        {loadingAppointments ? (
          <div className="text-muted">Loading submissions...</div>
        ) : appointments.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: "center", padding: "2rem" }}
          >
            <p className="text-muted">No pending submissions</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Cat</th>
                  <th>Reason</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appt) => (
                  <tr key={appt.appointment_id}>
                    <td>
                      <StatusBadge status={appt.status} />
                    </td>
                    <td>{appt.requester_name || "Unknown"}</td>
                    <td>{appt.requester_phone || "—"}</td>
                    <td>{appt.cat_name || "—"}</td>
                    <td className="text-sm">
                      {appt.reason
                        ? appt.reason.length > 50
                          ? appt.reason.substring(0, 50) + "..."
                          : appt.reason
                        : "—"}
                    </td>
                    <td className="text-sm text-muted">
                      {new Date(appt.submitted_at).toLocaleDateString()}
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
