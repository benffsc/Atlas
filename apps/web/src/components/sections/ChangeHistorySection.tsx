"use client";

import type { SectionProps } from "@/lib/person-roles/types";

const FIELD_LABELS: Record<string, string> = {
  role_status: "Status",
  trapper_type: "Trapper Type",
  availability_status: "Availability",
  has_signed_contract: "Contract",
  notes: "Notes",
  rescue_name: "Rescue Name",
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
 * Change history section for trapper detail.
 * Shows recent field-level changes with old/new values and reasons.
 */
export function ChangeHistorySection({ data }: SectionProps) {
  const { changeHistory } = data;
  const fieldChanges = changeHistory.filter(e => e.field_name);

  if (fieldChanges.length === 0) {
    return <p className="text-muted">No changes recorded.</p>;
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {fieldChanges.slice(0, 10).map((entry) => {
          const label = FIELD_LABELS[entry.field_name || ""] || entry.field_name;
          let oldVal: string = entry.old_value || "";
          let newVal: string = entry.new_value || "";
          try { oldVal = JSON.parse(oldVal || '""'); } catch { /* keep raw */ }
          try { newVal = JSON.parse(newVal || '""'); } catch { /* keep raw */ }

          return (
            <div key={entry.edit_id} style={{
              display: "flex", alignItems: "center", gap: "0.75rem",
              padding: "0.5rem 0.75rem", background: "#f8f9fa", borderRadius: "6px", fontSize: "0.85rem",
            }}>
              <span style={{ color: "var(--muted)", fontSize: "0.75rem", minWidth: "60px" }}>
                {timeAgo(entry.created_at)}
              </span>
              <span>
                <strong>{label}</strong>: {String(oldVal || "—")} → {String(newVal || "—")}
              </span>
              {entry.reason && (
                <span style={{ color: "var(--muted)", fontSize: "0.8rem", fontStyle: "italic" }}>— {entry.reason}</span>
              )}
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.7rem" }}>
                {entry.editor}
              </span>
            </div>
          );
        })}
      </div>
      {fieldChanges.length > 10 && (
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          Showing 10 of {fieldChanges.length} changes
        </p>
      )}
    </>
  );
}
