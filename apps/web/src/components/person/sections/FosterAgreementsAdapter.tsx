"use client";

import type { SectionProps } from "@/lib/person-roles/types";
import { formatDateLocal } from "@/lib/formatters";

const AGREEMENT_TYPE_LABELS: Record<string, string> = {
  foster: "Foster Agreement",
  forever_foster: "Forever Foster Agreement",
};

/**
 * Foster agreements section — read-only table of signed agreements from Airtable.
 */
export function FosterAgreementsAdapter({ data }: SectionProps) {
  const agreements = data.fosterAgreements;

  if (!agreements || agreements.length === 0) {
    return (
      <div style={{
        padding: "1rem",
        background: "var(--bg-secondary, #f9fafb)",
        borderRadius: "8px",
        textAlign: "center",
      }}>
        <p className="text-muted" style={{ margin: 0 }}>
          No agreements on file. Foster agreements are imported from Airtable.
        </p>
      </div>
    );
  }

  return (
    <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border)" }}>
          <th style={{ padding: "0.5rem 0.75rem" }}>Type</th>
          <th style={{ padding: "0.5rem 0.75rem" }}>Date Signed</th>
          <th style={{ padding: "0.5rem 0.75rem" }}>Source</th>
          <th style={{ padding: "0.5rem 0.75rem" }}>Notes</th>
        </tr>
      </thead>
      <tbody>
        {agreements.map((agreement) => (
          <tr key={agreement.agreement_id} style={{ borderBottom: "1px solid var(--border)" }}>
            <td style={{ padding: "0.5rem 0.75rem" }}>
              <span style={{
                display: "inline-block",
                padding: "0.125rem 0.5rem",
                borderRadius: "4px",
                fontSize: "0.8rem",
                fontWeight: 500,
                background: agreement.agreement_type === "forever_foster" ? "#fef3c7" : "#dbeafe",
                color: agreement.agreement_type === "forever_foster" ? "#92400e" : "#1e40af",
              }}>
                {AGREEMENT_TYPE_LABELS[agreement.agreement_type] || agreement.agreement_type}
              </span>
            </td>
            <td style={{ padding: "0.5rem 0.75rem" }}>
              {agreement.signed_at ? formatDateLocal(agreement.signed_at) : <span className="text-muted">Unknown</span>}
            </td>
            <td style={{ padding: "0.5rem 0.75rem" }}>
              <span style={{
                fontSize: "0.75rem",
                padding: "0.125rem 0.375rem",
                borderRadius: "4px",
                background: "#f3f4f6",
                color: "#6b7280",
              }}>
                {agreement.source_system}
              </span>
            </td>
            <td style={{ padding: "0.5rem 0.75rem" }}>
              {agreement.notes || <span className="text-muted">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
