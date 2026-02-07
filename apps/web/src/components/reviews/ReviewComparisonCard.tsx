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
  onSelect?: (id: string) => void;
  onMerge?: (id: string) => void;
  onKeepSeparate?: (id: string) => void;
  onDismiss?: (id: string) => void;
  children?: ReactNode;
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
  onSelect,
  onMerge,
  onKeepSeparate,
  onDismiss,
  children,
}: ReviewComparisonCardProps) {
  const similarityColor =
    similarity >= 0.85
      ? "#198754"
      : similarity >= 0.5
        ? "#fd7e14"
        : "#dc3545";

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

        {/* Similarity Indicator */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "60px",
          }}
        >
          <div
            style={{
              fontSize: "1.4rem",
              fontWeight: 700,
              color: similarityColor,
            }}
          >
            {Math.round(similarity * 100)}%
          </div>
          <div className="text-muted" style={{ fontSize: "0.7rem" }}>
            {similarityLabel}
          </div>
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
