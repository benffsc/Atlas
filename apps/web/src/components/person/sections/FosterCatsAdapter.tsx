"use client";

import type { SectionProps } from "@/lib/person-roles/types";
import { formatDateLocal } from "@/lib/formatters";

/**
 * Foster cats section — table of ALL cats linked as foster from sot.person_cat.
 * No current/past distinction (data doesn't support it reliably).
 */
export function FosterCatsAdapter({ data }: SectionProps) {
  const cats = data.fosterCats;

  if (!cats || cats.length === 0) {
    return <p className="text-muted">No foster cats linked to this person.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border)" }}>
            <th style={{ padding: "0.5rem 0.75rem" }}>Name</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Microchip</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Source</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Confidence</th>
            <th style={{ padding: "0.5rem 0.75rem" }}>Linked</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => (
            <tr key={cat.cat_id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                <a
                  href={`/cats/${cat.cat_id}`}
                  style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}
                >
                  {cat.cat_name || "Unnamed"}
                </a>
              </td>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                {cat.microchip ? (
                  <code style={{ fontSize: "0.8rem", background: "var(--bg-secondary, #f3f4f6)", padding: "0.125rem 0.375rem", borderRadius: "3px" }}>
                    {cat.microchip}
                  </code>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                <span style={{
                  display: "inline-block",
                  padding: "0.125rem 0.375rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  background: cat.source_system === "shelterluv" ? "#ede9fe" : "#f3f4f6",
                  color: cat.source_system === "shelterluv" ? "#6d28d9" : "#6b7280",
                }}>
                  {cat.source_system || "Unknown"}
                </span>
              </td>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                {cat.confidence != null ? (
                  <span style={{
                    color: Number(cat.confidence) >= 0.7 ? "#16a34a" : Number(cat.confidence) >= 0.4 ? "#d97706" : "#dc2626",
                    fontWeight: 500,
                  }}>
                    {(Number(cat.confidence) * 100).toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                {cat.linked_at ? formatDateLocal(cat.linked_at) : <span className="text-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
        Showing all cats linked as foster via ShelterLuv cross-matching.
        No current/past distinction — data doesn&apos;t track foster placement dates.
      </p>
    </div>
  );
}
