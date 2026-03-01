"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DataQualityBadge, VerificationBadge } from "@/components/badges";

interface ReviewItem {
  entity_type: string;
  entity_id: string;
  entity_name: string;
  entity_link: string;
  review_reason: string;
  source_system: string;
  confidence: string;
  created_at: string;
  details: string | null;
  verified_at?: string | null;
}

// Map entity_type to verification table name
const verifyTableMap: Record<string, string> = {
  colony_estimate: "colony_estimates",
  reproduction: "vitals",
  mortality: "mortality_events",
  birth: "birth_events",
};

interface ReviewSummary {
  total: number;
  colony_estimates: number;
  reproduction: number;
  mortality: number;
  birth: number;
}

const entityTypeLabels: Record<string, { label: string; color: string; bg: string }> = {
  colony_estimate: { label: "Colony", color: "#0d6efd", bg: "#e7f1ff" },
  reproduction: { label: "Reproduction", color: "#d63384", bg: "#fce7f3" },
  mortality: { label: "Mortality", color: "#dc3545", bg: "#fee2e2" },
  birth: { label: "Birth", color: "#198754", bg: "#d1fae5" },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function NeedsReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    async function fetchItems() {
      try {
        const res = await fetch("/api/admin/needs-review");
        if (res.ok) {
          const data = await res.json();
          setItems(data.items || []);
          setSummary(data.summary || null);
        }
      } catch (err) {
        console.error("Error fetching review items:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchItems();
  }, []);

  const filteredItems = filter === "all" ? items : items.filter((i) => i.entity_type === filter);

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1>Needs Review</h1>
        <p className="text-muted">
          AI-parsed and low-confidence data that may need human verification
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "0.75rem",
            marginBottom: "1.5rem",
          }}
        >
          <button
            onClick={() => setFilter("all")}
            style={{
              padding: "0.75rem",
              textAlign: "center",
              background: filter === "all" ? "var(--foreground)" : "var(--card-bg)",
              color: filter === "all" ? "var(--background)" : "var(--foreground)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{summary.total}</div>
            <div style={{ fontSize: "0.75rem" }}>All Items</div>
          </button>
          <button
            onClick={() => setFilter("colony_estimate")}
            style={{
              padding: "0.75rem",
              textAlign: "center",
              background: filter === "colony_estimate" ? entityTypeLabels.colony_estimate.bg : "var(--card-bg)",
              border: `1px solid ${filter === "colony_estimate" ? entityTypeLabels.colony_estimate.color : "var(--card-border)"}`,
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: entityTypeLabels.colony_estimate.color }}>
              {summary.colony_estimates}
            </div>
            <div style={{ fontSize: "0.75rem" }}>Colony Est.</div>
          </button>
          <button
            onClick={() => setFilter("reproduction")}
            style={{
              padding: "0.75rem",
              textAlign: "center",
              background: filter === "reproduction" ? entityTypeLabels.reproduction.bg : "var(--card-bg)",
              border: `1px solid ${filter === "reproduction" ? entityTypeLabels.reproduction.color : "var(--card-border)"}`,
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: entityTypeLabels.reproduction.color }}>
              {summary.reproduction}
            </div>
            <div style={{ fontSize: "0.75rem" }}>Reproduction</div>
          </button>
          <button
            onClick={() => setFilter("mortality")}
            style={{
              padding: "0.75rem",
              textAlign: "center",
              background: filter === "mortality" ? entityTypeLabels.mortality.bg : "var(--card-bg)",
              border: `1px solid ${filter === "mortality" ? entityTypeLabels.mortality.color : "var(--card-border)"}`,
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: entityTypeLabels.mortality.color }}>
              {summary.mortality}
            </div>
            <div style={{ fontSize: "0.75rem" }}>Mortality</div>
          </button>
          <button
            onClick={() => setFilter("birth")}
            style={{
              padding: "0.75rem",
              textAlign: "center",
              background: filter === "birth" ? entityTypeLabels.birth.bg : "var(--card-bg)",
              border: `1px solid ${filter === "birth" ? entityTypeLabels.birth.color : "var(--card-border)"}`,
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: entityTypeLabels.birth.color }}>
              {summary.birth}
            </div>
            <div style={{ fontSize: "0.75rem" }}>Births</div>
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-muted">Loading items for review...</div>
      ) : filteredItems.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p className="text-muted">
            {filter === "all" ? "No items need review" : `No ${filter.replace("_", " ")} items need review`}
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Entity</th>
                <th>Reason</th>
                <th>Source</th>
                <th>Confidence</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={`${item.entity_type}-${item.entity_id}`}>
                  <td>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background: entityTypeLabels[item.entity_type]?.bg || "#f3f4f6",
                        color: entityTypeLabels[item.entity_type]?.color || "#6b7280",
                      }}
                    >
                      {entityTypeLabels[item.entity_type]?.label || item.entity_type}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={item.entity_link}
                      style={{ fontWeight: 500, color: "#0d6efd" }}
                    >
                      {item.entity_name}
                    </Link>
                    {item.details && (
                      <div className="text-muted text-sm">{item.details}</div>
                    )}
                  </td>
                  <td style={{ maxWidth: "200px" }}>
                    <div style={{ fontSize: "0.85rem" }}>{item.review_reason}</div>
                  </td>
                  <td>
                    <DataQualityBadge
                      source={item.source_system}
                      needsReview={true}
                    />
                  </td>
                  <td>
                    <span
                      style={{
                        color:
                          item.confidence === "Low"
                            ? "#dc3545"
                            : item.confidence === "Medium"
                            ? "#fd7e14"
                            : "#198754",
                      }}
                    >
                      {item.confidence}
                    </span>
                  </td>
                  <td className="text-muted text-sm">{formatDate(item.created_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <VerificationBadge
                        table={verifyTableMap[item.entity_type] || item.entity_type}
                        recordId={item.entity_id}
                        verifiedAt={item.verified_at || null}
                        onVerify={() => {
                          // Remove from list after verification
                          setItems((prev) =>
                            prev.filter(
                              (i) =>
                                !(i.entity_type === item.entity_type && i.entity_id === item.entity_id)
                            )
                          );
                          // Update summary counts
                          if (summary) {
                            const typeKey = item.entity_type === "colony_estimate" ? "colony_estimates" : item.entity_type;
                            setSummary((prev) => {
                              if (!prev) return null;
                              const counts: Record<string, number> = {
                                total: prev.total - 1,
                                colony_estimates: prev.colony_estimates,
                                reproduction: prev.reproduction,
                                mortality: prev.mortality,
                                birth: prev.birth,
                              };
                              if (typeKey in counts) {
                                counts[typeKey] = counts[typeKey] - 1;
                              }
                              return {
                                total: counts.total,
                                colony_estimates: counts.colony_estimates,
                                reproduction: counts.reproduction,
                                mortality: counts.mortality,
                                birth: counts.birth,
                              };
                            });
                          }
                        }}
                      />
                      <Link
                        href={item.entity_link}
                        style={{
                          display: "inline-block",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          background: "#0d6efd",
                          color: "#fff",
                          textDecoration: "none",
                        }}
                      >
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="card" style={{ marginTop: "1.5rem", padding: "1rem", background: "#f0f7ff" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>About This Queue</div>
        <p className="text-muted text-sm" style={{ margin: 0 }}>
          This queue shows data extracted by AI parsers (Beacon) that may need human verification.
          Items appear here when:
        </p>
        <ul className="text-muted text-sm" style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
          <li>Colony estimates have low confidence scores (&lt;70%)</li>
          <li>Reproduction data was parsed from clinical notes</li>
          <li>Mortality/birth events were inferred from text</li>
          <li>Date precision is "estimate", "season only", or "year only"</li>
        </ul>
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          Click "Review" to view and verify the data on the entity page.
        </p>
      </div>
    </div>
  );
}
