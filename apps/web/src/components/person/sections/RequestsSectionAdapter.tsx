"use client";

import { StatusBadge, PriorityBadge } from "@/components/badges";
import { formatDateLocal } from "@/lib/formatters";
import type { SectionProps } from "@/lib/person-roles/types";

export function RequestsSectionAdapter({ data }: SectionProps) {
  const { requests, person } = data;

  if (requests.length === 0) {
    return <p className="text-muted">No requests from this person.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {requests.map((req) => (
        <a
          key={req.request_id}
          href={`/requests/${req.request_id}`}
          style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "0.75rem 1rem", background: "var(--card-bg)", borderRadius: "8px",
            textDecoration: "none", color: "inherit", border: "1px solid var(--border)",
          }}
        >
          <StatusBadge status={req.status} />
          <PriorityBadge priority={req.priority} />
          <span style={{ flex: 1, fontWeight: 500 }}>
            {req.summary || req.place_name || "No summary"}
          </span>
          <span className="text-muted text-sm">{formatDateLocal(req.created_at)}</span>
        </a>
      ))}
      {requests.length >= 10 && person && (
        <a href={`/requests?person_id=${person.person_id}`} className="text-sm" style={{ marginTop: "0.5rem" }}>
          View all requests from this person...
        </a>
      )}
    </div>
  );
}
