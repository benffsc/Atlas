"use client";

import { formatDateLocal } from "@/lib/formatters";
import { MyItemsWidget } from "@/components/common";
import { StatusBadge, PriorityDot } from "@/components/badges";
import { AttentionBar } from "./AttentionBar";

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

interface ActionPanelStats {
  stale_requests: number;
  overdue_intake: number;
  unassigned_requests: number;
  needs_attention_total: number;
  person_dedup_pending: number;
  place_dedup_pending: number;
}

interface ActionPanelProps {
  stats: ActionPanelStats | null;
  requests: ActiveRequest[];
  intake: IntakeSubmission[];
  loadingRequests: boolean;
  loadingIntake: boolean;
  isAdmin: boolean;
  staffPersonId: string | null;
  showMyRequests: boolean;
  onToggleMyRequests: () => void;
  onRequestClick: (requestId: string) => void;
}

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

export function ActionPanel({
  stats,
  requests,
  intake,
  loadingRequests,
  loadingIntake,
  isAdmin,
  staffPersonId,
  showMyRequests,
  onToggleMyRequests,
  onRequestClick,
}: ActionPanelProps) {
  return (
    <div className="dashboard-action-panel">
      {/* Attention Bar */}
      <AttentionBar stats={stats} isAdmin={isAdmin} />

      {/* Active Requests */}
      <div className="action-section">
        <h2>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
            {showMyRequests && staffPersonId ? "My Requests" : "Active Requests"}
            {staffPersonId && (
              <button
                onClick={onToggleMyRequests}
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
          <p className="text-muted" style={{ textAlign: "center", padding: "0.75rem 0" }}>
            Loading...
          </p>
        ) : requests.length === 0 ? (
          <p className="text-muted" style={{ textAlign: "center", padding: "0.75rem 0" }}>
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
                className="action-row"
                onClick={(e) => {
                  if (!e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    onRequestClick(req.request_id);
                  }
                }}
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
                    fontSize: "0.7rem",
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

      {/* Recent Intake */}
      <div className="action-section">
        <h2>
          Recent Intake
          <a href="/intake/queue">Triage queue</a>
        </h2>

        {loadingIntake ? (
          <p className="text-muted" style={{ textAlign: "center", padding: "0.75rem 0" }}>
            Loading...
          </p>
        ) : intake.length === 0 ? (
          <p className="text-muted" style={{ textAlign: "center", padding: "0.75rem 0" }}>
            No pending submissions
          </p>
        ) : (
          intake.map(sub => (
            <a
              key={sub.submission_id}
              href={`/intake/queue?open=${sub.submission_id}`}
              className="action-row"
              style={{
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

      {/* My Items */}
      <MyItemsWidget maxItems={3} />
    </div>
  );
}
