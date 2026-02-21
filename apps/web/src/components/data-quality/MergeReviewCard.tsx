"use client";

/**
 * MergeReviewCard - Side-by-side comparison for duplicate review
 *
 * Shows two records side by side with:
 * - Match confidence and reason
 * - Field-by-field comparison
 * - Preview of merged result
 * - Action buttons (keep separate, swap, merge)
 */

import { useState } from "react";

export interface EntityRecord {
  id: string;
  name: string;
  fields: Array<{
    label: string;
    value: string | number | null;
    highlight?: boolean;
  }>;
  stats?: {
    identifiers?: number;
    places?: number;
    cats?: number;
    requests?: number;
  };
  source?: string;
  createdAt?: string;
}

export interface MergeCandidate {
  canonical: EntityRecord;
  duplicate: EntityRecord;
  matchReason: string;
  confidence: number;
  sharedFields?: Array<{ field: string; value: string }>;
}

interface MergeReviewCardProps {
  candidate: MergeCandidate;
  entityType: "person" | "place" | "cat";
  onMerge: (canonicalId: string, duplicateId: string) => Promise<void>;
  onKeepSeparate: (canonicalId: string, duplicateId: string) => Promise<void>;
  onSwap?: (canonicalId: string, duplicateId: string) => Promise<void>;
  onDismiss?: (canonicalId: string, duplicateId: string) => Promise<void>;
  isProcessing?: boolean;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
  showCheckbox?: boolean;
}

function EntityStats({
  stats,
}: {
  stats?: EntityRecord["stats"];
}) {
  if (!stats) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        fontSize: 12,
        color: "#6b7280",
        flexWrap: "wrap",
      }}
    >
      {stats.identifiers !== undefined && (
        <span title="Identifiers (emails, phones)">
          <strong>{stats.identifiers}</strong> IDs
        </span>
      )}
      {stats.places !== undefined && (
        <span title="Places linked">
          <strong>{stats.places}</strong> places
        </span>
      )}
      {stats.cats !== undefined && (
        <span title="Cat relationships">
          <strong>{stats.cats}</strong> cats
        </span>
      )}
      {stats.requests !== undefined && (
        <span title="Requests">
          <strong>{stats.requests}</strong> requests
        </span>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.8
      ? "#22c55e"
      : confidence >= 0.6
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: `${color}15`,
        borderRadius: 16,
        fontSize: 13,
        fontWeight: 500,
        color,
      }}
    >
      <span style={{ fontSize: 16 }}>
        {confidence >= 0.8 ? "●" : confidence >= 0.6 ? "◐" : "○"}
      </span>
      {Math.round(confidence * 100)}% match
    </div>
  );
}

export function MergeReviewCard({
  candidate,
  entityType,
  onMerge,
  onKeepSeparate,
  onSwap,
  onDismiss,
  isProcessing = false,
  isSelected = false,
  onSelect,
  showCheckbox = false,
}: MergeReviewCardProps) {
  const [showPreview, setShowPreview] = useState(false);
  const { canonical, duplicate, matchReason, confidence, sharedFields } = candidate;

  const entityLabel = entityType === "person" ? "Person" : entityType === "place" ? "Place" : "Cat";
  const entityPath = entityType === "person" ? "people" : entityType === "place" ? "places" : "cats";

  // Calculate merged stats preview
  const mergedStats = {
    identifiers: (canonical.stats?.identifiers || 0) + (duplicate.stats?.identifiers || 0),
    places: Math.max(canonical.stats?.places || 0, duplicate.stats?.places || 0),
    cats: (canonical.stats?.cats || 0) + (duplicate.stats?.cats || 0),
    requests: (canonical.stats?.requests || 0) + (duplicate.stats?.requests || 0),
  };

  return (
    <div
      style={{
        background: "white",
        borderRadius: 12,
        border: `1px solid ${isSelected ? "#3b82f6" : "#e5e7eb"}`,
        boxShadow: isSelected
          ? "0 0 0 2px rgba(59, 130, 246, 0.2)"
          : "0 1px 3px rgba(0, 0, 0, 0.05)",
        overflow: "hidden",
        opacity: isProcessing ? 0.6 : 1,
        transition: "all 0.2s",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {showCheckbox && onSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelect(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
          )}
          <ConfidenceBadge confidence={confidence} />
          <span style={{ fontSize: 13, color: "#6b7280" }}>{matchReason}</span>
        </div>

        {sharedFields && sharedFields.length > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            {sharedFields.map((sf) => (
              <span
                key={sf.field}
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  background: "#dbeafe",
                  color: "#1d4ed8",
                  borderRadius: 4,
                }}
              >
                {sf.field}: {sf.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Side-by-side comparison */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 0,
        }}
      >
        {/* Canonical (Winner) */}
        <div
          style={{
            padding: 16,
            background: "rgba(34, 197, 94, 0.04)",
            borderRight: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#22c55e",
              marginBottom: 8,
            }}
          >
            Keep ({entityLabel} A)
          </div>
          <a
            href={`/${entityPath}/${canonical.id}`}
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#111827",
              textDecoration: "none",
            }}
          >
            {canonical.name || "(unnamed)"}
          </a>

          <div style={{ marginTop: 12 }}>
            {canonical.fields.map((field) => (
              <div
                key={field.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  fontSize: 13,
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                <span style={{ color: "#6b7280" }}>{field.label}</span>
                <span
                  style={{
                    fontWeight: field.highlight ? 500 : 400,
                    color: field.highlight ? "#22c55e" : "#111827",
                  }}
                >
                  {field.value ?? "—"}
                </span>
              </div>
            ))}
          </div>

          {canonical.stats && (
            <div style={{ marginTop: 12 }}>
              <EntityStats stats={canonical.stats} />
            </div>
          )}

          {(canonical.source || canonical.createdAt) && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "#9ca3af",
              }}
            >
              {canonical.source && <span>{canonical.source}</span>}
              {canonical.source && canonical.createdAt && <span> • </span>}
              {canonical.createdAt && (
                <span>Created {new Date(canonical.createdAt).toLocaleDateString()}</span>
              )}
            </div>
          )}
        </div>

        {/* Arrow/Indicator */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 12px",
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              fontSize: 24,
              color: "#9ca3af",
            }}
          >
            ←
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#9ca3af",
              marginTop: 4,
              textAlign: "center",
            }}
          >
            merge
            <br />
            into
          </div>
        </div>

        {/* Duplicate (Loser) */}
        <div
          style={{
            padding: 16,
            background: "rgba(107, 114, 128, 0.04)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#6b7280",
              marginBottom: 8,
            }}
          >
            Merge ({entityLabel} B)
          </div>
          <a
            href={`/${entityPath}/${duplicate.id}`}
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#111827",
              textDecoration: "none",
            }}
          >
            {duplicate.name || "(unnamed)"}
          </a>

          <div style={{ marginTop: 12 }}>
            {duplicate.fields.map((field) => (
              <div
                key={field.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  fontSize: 13,
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                <span style={{ color: "#6b7280" }}>{field.label}</span>
                <span
                  style={{
                    fontWeight: field.highlight ? 500 : 400,
                    color: field.highlight ? "#6b7280" : "#111827",
                  }}
                >
                  {field.value ?? "—"}
                </span>
              </div>
            ))}
          </div>

          {duplicate.stats && (
            <div style={{ marginTop: 12 }}>
              <EntityStats stats={duplicate.stats} />
            </div>
          )}

          {(duplicate.source || duplicate.createdAt) && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "#9ca3af",
              }}
            >
              {duplicate.source && <span>{duplicate.source}</span>}
              {duplicate.source && duplicate.createdAt && <span> • </span>}
              {duplicate.createdAt && (
                <span>Created {new Date(duplicate.createdAt).toLocaleDateString()}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Merge Preview */}
      {showPreview && (
        <div
          style={{
            padding: 16,
            background: "#f0fdf4",
            borderTop: "1px solid #bbf7d0",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#166534",
              marginBottom: 8,
            }}
          >
            After Merge:
          </div>
          <div
            style={{
              display: "flex",
              gap: 24,
              fontSize: 13,
              color: "#166534",
            }}
          >
            <span>
              <strong>{canonical.name}</strong>
            </span>
            <span>
              {mergedStats.identifiers} emails/phones
            </span>
            <span>{mergedStats.cats} cats</span>
            <span>{mergedStats.places} places</span>
            <span>{mergedStats.requests} requests</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "#f9fafb",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <button
          onClick={() => setShowPreview(!showPreview)}
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: "transparent",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            cursor: "pointer",
            color: "#374151",
          }}
        >
          {showPreview ? "Hide Preview" : "Preview Merge"}
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          {onDismiss && (
            <button
              onClick={() => onDismiss(canonical.id, duplicate.id)}
              disabled={isProcessing}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                background: "#6b7280",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: isProcessing ? "not-allowed" : "pointer",
              }}
            >
              Skip
            </button>
          )}
          <button
            onClick={() => onKeepSeparate(canonical.id, duplicate.id)}
            disabled={isProcessing}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: "#22c55e",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: isProcessing ? "not-allowed" : "pointer",
            }}
          >
            Not Duplicate
          </button>
          {onSwap && (
            <button
              onClick={() => onSwap(canonical.id, duplicate.id)}
              disabled={isProcessing}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                background: "#8b5cf6",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: isProcessing ? "not-allowed" : "pointer",
              }}
            >
              Swap Primary
            </button>
          )}
          <button
            onClick={() => onMerge(canonical.id, duplicate.id)}
            disabled={isProcessing}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: "#f59e0b",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: isProcessing ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            Confirm Merge
          </button>
        </div>
      </div>
    </div>
  );
}
