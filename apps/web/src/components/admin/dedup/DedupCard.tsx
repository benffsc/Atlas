import type { ReactNode } from "react";
import type { DedupConfig } from "./types";

interface Props<C> {
  config: DedupConfig<C>;
  candidate: C;
  isSelected: boolean;
  isResolving: boolean;
  onToggleSelect: () => void;
  onResolve: (action: string) => void;
}

export function DedupCard<C>({ config, candidate, isSelected, isResolving, onToggleSelect, onResolve }: Props<C>) {
  const tierValue = config.getTierValue(candidate);
  const tab = config.tabs.find((t) => t.value === tierValue);
  const tierColor = tab?.color || "#6c757d";
  const tierLabel = tab?.label || tierValue;

  return (
    <div
      className="card"
      style={{
        padding: "1.25rem",
        marginBottom: "0.75rem",
        borderLeft: `4px solid ${tierColor}`,
        opacity: isResolving ? 0.6 : 1,
        background: isSelected ? "rgba(13, 110, 253, 0.05)" : undefined,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              background: tierColor,
              color: "#fff",
              borderRadius: "4px",
            }}
          >
            {tierLabel}
          </span>
          {config.renderHeaderMeta?.(candidate)}
        </div>
      </div>

      {/* 3-column comparison grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "1rem",
          alignItems: "stretch",
        }}
      >
        {config.renderCanonical(candidate)}
        {config.renderCenter(candidate)}
        {config.renderDuplicate(candidate)}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", justifyContent: "flex-end" }}>
        {config.actions.map((action) => (
          <button
            key={action.key}
            onClick={() => onResolve(action.key)}
            disabled={isResolving}
            style={{
              padding: "0.4rem 0.75rem",
              background: action.color,
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
