import type { DedupConfig } from "./types";

interface Props<C> {
  config: DedupConfig<C>;
  selectedCount: number;
  batchAction: boolean;
  onBatchResolve: (action: string) => void;
  onClearSelection: () => void;
}

export function DedupBatchBar<C>({ config, selectedCount, batchAction, onBatchResolve, onClearSelection }: Props<C>) {
  if (selectedCount === 0) return null;

  const batchActions = config.actions.filter((a) => a.showInBatch !== false);

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        padding: "0.75rem 1rem",
        background: "var(--bg-muted, #f8f9fa)",
        borderRadius: "8px",
        marginBottom: "1rem",
        alignItems: "center",
      }}
    >
      <span style={{ fontWeight: 500, marginRight: "0.5rem" }}>{selectedCount} selected</span>
      {batchActions.map((action) => (
        <button
          key={action.key}
          onClick={() => onBatchResolve(action.key)}
          disabled={batchAction}
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
          {action.batchLabel}
        </button>
      ))}
      <button
        onClick={onClearSelection}
        style={{
          padding: "0.4rem 0.75rem",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        Clear Selection
      </button>
    </div>
  );
}
