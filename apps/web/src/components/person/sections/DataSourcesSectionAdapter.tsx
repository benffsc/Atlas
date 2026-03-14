"use client";

import { formatPhone } from "@/lib/formatters";
import type { SectionProps } from "@/lib/person-roles/types";

export function DataSourcesSectionAdapter({ data }: SectionProps) {
  const identifiers = data.person?.identifiers;
  if (!identifiers || identifiers.length === 0) return null;

  return (
    <>
      <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
        This person record was seeded from these sources:
      </p>
      <table style={{ width: "100%", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "0.5rem 0" }}>Type</th>
            <th style={{ padding: "0.5rem 0" }}>Value</th>
            <th style={{ padding: "0.5rem 0" }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {identifiers.map((pid, idx) => (
            <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.5rem 0" }}>
                <span className="badge" style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}>{pid.id_type}</span>
              </td>
              <td style={{ padding: "0.5rem 0" }}>{pid.id_type === "phone" ? formatPhone(pid.id_value) : pid.id_value}</td>
              <td style={{ padding: "0.5rem 0" }} className="text-muted">
                {pid.source_system ? `${pid.source_system}${pid.source_table ? `.${pid.source_table}` : ""}` : "Unknown"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
