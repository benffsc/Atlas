"use client";

import { Icon } from "@/components/ui/Icon";
import type { TripReportRow } from "@/hooks/useRequestDetail";

interface TripReportsTabProps {
  tripReports: TripReportRow[];
  onLogSession: () => void;
}

export function TripReportsTab({ tripReports, onLogSession }: TripReportsTabProps) {
  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          {tripReports.length} report{tripReports.length !== 1 ? "s" : ""}
          {tripReports.length > 0 && (() => {
            const totalTrapped = tripReports.reduce((sum, r) => sum + (r.cats_trapped || 0), 0);
            const totalReturned = tripReports.reduce((sum, r) => sum + (r.cats_returned || 0), 0);
            return totalTrapped > 0 ? ` — ${totalTrapped} trapped, ${totalReturned} returned` : "";
          })()}
        </span>
        <button
          onClick={onLogSession}
          className="btn btn-sm btn-primary"
          style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
        >
          + Log Session
        </button>
      </div>

      {tripReports.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>No trip reports yet</p>
          <p style={{ margin: 0, fontSize: "0.8rem" }}>Log your first trapping session to track progress.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {tripReports.map((report) => (
            <div
              key={report.report_id}
              style={{
                padding: "0.75rem 1rem",
                background: report.is_final_visit ? "var(--success-bg)" : "var(--muted-bg)",
                borderRadius: "8px",
                border: report.is_final_visit ? "1px solid #86efac" : "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                    {new Date(report.visit_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  {report.trapper_name && (
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      by {report.trapper_name}
                    </span>
                  )}
                  {report.is_final_visit && (
                    <span style={{
                      fontSize: "0.7rem", fontWeight: 600, padding: "0.125rem 0.375rem",
                      borderRadius: "4px", background: "#166534", color: "#fff",
                    }}>
                      FINAL VISIT
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                  {report.submitted_from === "airtable" ? "Airtable" : "Beacon"}
                </span>
              </div>

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                {(report.cats_trapped > 0 || report.cats_returned > 0) && (
                  <span>Trapped: <strong>{report.cats_trapped}</strong> | Returned: <strong>{report.cats_returned}</strong></span>
                )}
                {report.traps_set != null && (
                  <span>Traps: <strong>{report.traps_set}</strong> set{report.traps_retrieved != null ? `, ${report.traps_retrieved} retrieved` : ""}</span>
                )}
                {report.cats_seen != null && (
                  <span>Seen: <strong>{report.cats_seen}</strong>{report.eartipped_seen != null ? ` (${report.eartipped_seen} eartipped)` : ""}</span>
                )}
              </div>

              {report.issues_encountered && report.issues_encountered.length > 0 && (
                <div style={{ marginTop: "0.375rem", fontSize: "0.8rem", color: "#b45309" }}>
                  Issues: {report.issues_encountered.join(", ")}
                  {report.issue_details && ` — ${report.issue_details}`}
                </div>
              )}

              {report.site_notes && (
                <div style={{ marginTop: "0.375rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  {report.site_notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
