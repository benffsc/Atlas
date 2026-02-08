"use client";

import { ReactNode } from "react";
import { formatPhone } from "@/lib/formatters";

export interface EntitySide {
  id: string;
  name: string;
  emails?: string[] | null;
  phones?: string[] | null;
  address?: string | null;
  source?: string | null;
  createdAt?: string | null;
  stats?: {
    cats?: number;
    requests?: number;
    appointments?: number;
    places?: number;
    identifiers?: number;
  };
  // For place comparisons
  distance?: number;
  kind?: string;
}

export interface ReviewComparisonCardProps {
  id: string;
  matchType: string;
  matchTypeLabel: string;
  matchTypeColor: string;
  similarity: number;
  similarityLabel?: string;
  leftEntity: EntitySide;
  rightEntity: EntitySide;
  leftLabel?: string;
  rightLabel?: string;
  queueTime?: string;
  decisionReason?: string;
  isSelected?: boolean;
  isResolving?: boolean;
  // Fellegi-Sunter fields (MIG_949)
  matchProbability?: number | null;
  compositeScore?: number | null;
  fieldScores?: Record<string, number> | null;
  comparisonVector?: Record<string, string> | null;
  onSelect?: (id: string) => void;
  onMerge?: (id: string) => void;
  onKeepSeparate?: (id: string) => void;
  onDismiss?: (id: string) => void;
  children?: ReactNode;
}

function FieldComparisonVector({
  fieldScores,
  comparisonVector,
}: {
  fieldScores?: Record<string, number> | null;
  comparisonVector?: Record<string, string> | null;
}) {
  if (!comparisonVector && !fieldScores) return null;

  const fields = comparisonVector
    ? Object.entries(comparisonVector)
    : fieldScores
      ? Object.entries(fieldScores).map(([k, v]) => [k, v > 0 ? "agree" : v < 0 ? "disagree" : "missing"])
      : [];

  if (fields.length === 0) return null;

  const fieldLabels: Record<string, string> = {
    email_exact: "Email",
    phone_exact: "Phone",
    phone_softblacklist: "Phone (shared)",
    name_exact: "Name (exact)",
    name_similar_high: "Name",
    name_similar_med: "Name (partial)",
    address_exact: "Address",
    address_proximity: "Address (nearby)",
  };

  const statusIcons: Record<string, { icon: string; color: string }> = {
    agree: { icon: "✓", color: "#198754" },
    disagree: { icon: "✗", color: "#dc3545" },
    missing: { icon: "–", color: "#6c757d" },
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginTop: "0.5rem",
        fontSize: "0.75rem",
      }}
    >
      {fields.map(([field, status]) => {
        const label = fieldLabels[field] || field.replace(/_/g, " ");
        const { icon, color } = statusIcons[status as string] || statusIcons.missing;
        const weight = fieldScores?.[field];
        return (
          <span
            key={field}
            title={weight ? `Weight: ${weight > 0 ? "+" : ""}${weight.toFixed(2)}` : undefined}
            style={{
              padding: "0.15rem 0.4rem",
              background: `${color}15`,
              border: `1px solid ${color}40`,
              borderRadius: "4px",
              color,
              fontWeight: 500,
            }}
          >
            {icon} {label}
            {weight !== undefined && weight !== 0 && (
              <span style={{ opacity: 0.7, marginLeft: "0.25rem" }}>
                ({weight > 0 ? "+" : ""}{weight.toFixed(1)})
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function EntityStatPills({ stats }: { stats: EntitySide["stats"] }) {
  if (!stats) return null;

  const items = [
    { key: "cats", label: "cats", value: stats.cats },
    { key: "requests", label: "requests", value: stats.requests },
    { key: "appointments", label: "appts", value: stats.appointments },
    { key: "places", label: "places", value: stats.places },
    { key: "identifiers", label: "IDs", value: stats.identifiers },
  ].filter((item) => item.value !== undefined && item.value > 0);

  if (items.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", flexWrap: "wrap" }}>
      {items.map((item) => (
        <span key={item.key} title={item.label}>
          {item.value} {item.label}
        </span>
      ))}
    </div>
  );
}

function EntityCard({
  entity,
  label,
  labelColor,
  bgColor,
  borderColor,
}: {
  entity: EntitySide;
  label: string;
  labelColor: string;
  bgColor: string;
  borderColor: string;
}) {
  return (
    <div
      style={{
        padding: "0.75rem",
        background: bgColor,
        borderRadius: "8px",
        border: `1px solid ${borderColor}`,
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          textTransform: "uppercase",
          color: labelColor,
          marginBottom: "0.25rem",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontWeight: 600,
          fontSize: "1rem",
          marginBottom: "0.5rem",
        }}
      >
        <a href={entity.id.includes("-") ? `/people/${entity.id}` : `#`}>
          {entity.name || "(no name)"}
        </a>
      </div>
      {entity.emails && entity.emails.length > 0 && (
        <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
          <span className="text-muted">Email:</span> {entity.emails[0]}
          {entity.emails.length > 1 && ` +${entity.emails.length - 1}`}
        </div>
      )}
      {entity.phones && entity.phones.length > 0 && (
        <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
          <span className="text-muted">Phone:</span> {formatPhone(entity.phones[0])}
          {entity.phones.length > 1 && ` +${entity.phones.length - 1}`}
        </div>
      )}
      {entity.address && (
        <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
          <span className="text-muted">Address:</span>{" "}
          {entity.address.length > 35 ? entity.address.substring(0, 35) + "..." : entity.address}
        </div>
      )}
      <EntityStatPills stats={entity.stats} />
      {entity.createdAt && (
        <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
          Created {new Date(entity.createdAt).toLocaleDateString()}
        </div>
      )}
      {entity.source && (
        <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
          Source: {entity.source}
        </div>
      )}
    </div>
  );
}

export function ReviewComparisonCard({
  id,
  matchType,
  matchTypeLabel,
  matchTypeColor,
  similarity,
  similarityLabel = "match",
  leftEntity,
  rightEntity,
  leftLabel = "Existing (Keep)",
  rightLabel = "Incoming (Merge)",
  queueTime,
  decisionReason,
  isSelected = false,
  isResolving = false,
  matchProbability,
  compositeScore,
  fieldScores,
  comparisonVector,
  onSelect,
  onMerge,
  onKeepSeparate,
  onDismiss,
  children,
}: ReviewComparisonCardProps) {
  // Use matchProbability if available (F-S), otherwise fall back to similarity
  const displayProbability = matchProbability ?? similarity;
  const probabilityColor =
    displayProbability >= 0.9
      ? "#198754"  // Green for high confidence
      : displayProbability >= 0.7
        ? "#fd7e14"  // Orange for medium
        : "#dc3545"; // Red for low

  return (
    <div
      className="card"
      style={{
        padding: "1.25rem",
        marginBottom: "0.75rem",
        borderLeft: `4px solid ${matchTypeColor}`,
        opacity: isResolving ? 0.6 : 1,
        background: isSelected ? "rgba(13, 110, 253, 0.05)" : undefined,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {onSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(id)}
            />
          )}
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              background: matchTypeColor,
              color: "#fff",
              borderRadius: "4px",
            }}
          >
            {matchTypeLabel}
          </span>
          {leftEntity.address && (
            <span className="text-muted text-sm">
              @ {leftEntity.address.length > 40
                ? leftEntity.address.substring(0, 40) + "..."
                : leftEntity.address}
            </span>
          )}
        </div>
        {queueTime && (
          <span className="text-muted text-sm">In queue: {queueTime}</span>
        )}
      </div>

      {/* Side-by-side Comparison */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "1rem",
          alignItems: "stretch",
        }}
      >
        <EntityCard
          entity={leftEntity}
          label={leftLabel}
          labelColor="#198754"
          bgColor="rgba(25, 135, 84, 0.08)"
          borderColor="rgba(25, 135, 84, 0.2)"
        />

        {/* Probability Indicator */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "80px",
          }}
        >
          <div
            style={{
              fontSize: "1.4rem",
              fontWeight: 700,
              color: probabilityColor,
            }}
          >
            {Math.round(displayProbability * 100)}%
          </div>
          <div className="text-muted" style={{ fontSize: "0.7rem" }}>
            {matchProbability !== null && matchProbability !== undefined ? "probability" : similarityLabel}
          </div>
          {compositeScore !== null && compositeScore !== undefined && (
            <div className="text-muted" style={{ fontSize: "0.65rem", marginTop: "0.25rem" }}>
              score: {compositeScore > 0 ? "+" : ""}{compositeScore.toFixed(1)}
            </div>
          )}
        </div>

        <EntityCard
          entity={rightEntity}
          label={rightLabel}
          labelColor="#6c757d"
          bgColor="rgba(108, 117, 125, 0.08)"
          borderColor="rgba(108, 117, 125, 0.2)"
        />
      </div>

      {/* Decision Reason */}
      {decisionReason && (
        <div
          className="text-muted text-sm"
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem 0.75rem",
            background: "var(--bg-muted)",
            borderRadius: "4px",
          }}
        >
          <strong>Detection:</strong> {decisionReason}
        </div>
      )}

      {/* Field Comparison Vector (F-S) */}
      {(fieldScores || comparisonVector) && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "var(--bg-muted)",
            borderRadius: "4px",
          }}
        >
          <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>
            <strong>Field Comparison:</strong>
          </div>
          <FieldComparisonVector
            fieldScores={fieldScores}
            comparisonVector={comparisonVector}
          />
        </div>
      )}

      {/* Custom children (for additional info) */}
      {children}

      {/* Action Buttons */}
      {(onMerge || onKeepSeparate || onDismiss) && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginTop: "0.75rem",
            justifyContent: "flex-end",
          }}
        >
          {onKeepSeparate && (
            <button
              onClick={() => onKeepSeparate(id)}
              disabled={isResolving}
              style={{
                padding: "0.4rem 0.75rem",
                background: "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Keep Separate
            </button>
          )}
          {onMerge && (
            <button
              onClick={() => onMerge(id)}
              disabled={isResolving}
              style={{
                padding: "0.4rem 0.75rem",
                background: "#fd7e14",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Merge
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(id)}
              disabled={isResolving}
              style={{
                padding: "0.4rem 0.75rem",
                background: "#6c757d",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ReviewComparisonCard;
