"use client";

import type { SectionProps } from "@/lib/person-roles/types";

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active: { bg: "#dcfce7", color: "#166534" },
  completed: { bg: "#dbeafe", color: "#1e40af" },
  declined: { bg: "#fee2e2", color: "#b91c1c" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Assignment history section for trapper detail.
 * Shows all request assignments with status and attributed cats.
 */
export function AssignmentHistorySection({ data }: SectionProps) {
  const { assignments } = data;

  if (assignments.length === 0) {
    return <p className="text-muted">No request assignments.</p>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Address</th>
          <th>Role</th>
          <th>Status</th>
          <th>Request Status</th>
          <th>Assigned</th>
          <th>Cats</th>
        </tr>
      </thead>
      <tbody>
        {assignments.map((a) => (
          <tr key={a.assignment_id}>
            <td>
              <a href={`/requests/${a.request_id}`} style={{ fontWeight: 500 }}>
                {a.request_address || "Unknown address"}
              </a>
            </td>
            <td>
              <span style={{
                fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
                background: a.assignment_type === "primary" ? "#dbeafe" : "#f3f4f6",
                color: a.assignment_type === "primary" ? "#1e40af" : "#6b7280",
              }}>
                {a.assignment_type}
              </span>
            </td>
            <td>
              <span style={{
                fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
                background: (STATUS_COLORS[a.assignment_status] || STATUS_COLORS.active).bg,
                color: (STATUS_COLORS[a.assignment_status] || STATUS_COLORS.active).color,
              }}>
                {a.assignment_status}
              </span>
            </td>
            <td className="text-muted" style={{ fontSize: "0.85rem" }}>{a.request_status}</td>
            <td className="text-muted" style={{ fontSize: "0.85rem" }}>{timeAgo(a.assigned_at)}</td>
            <td style={{ fontWeight: a.cats_attributed > 0 ? 600 : 400 }}>
              {a.cats_attributed > 0 ? a.cats_attributed : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
