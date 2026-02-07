"use client";

export interface BatchActionBarProps {
  selectedCount: number;
  isProcessing?: boolean;
  onMergeAll?: () => void;
  onKeepAllSeparate?: () => void;
  onDismissAll?: () => void;
  onClear: () => void;
}

export function BatchActionBar({
  selectedCount,
  isProcessing = false,
  onMergeAll,
  onKeepAllSeparate,
  onDismissAll,
  onClear,
}: BatchActionBarProps) {
  if (selectedCount === 0) return null;

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
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <span style={{ fontWeight: 500, marginRight: "0.5rem" }}>
        {selectedCount} selected
      </span>
      {onMergeAll && (
        <button
          onClick={onMergeAll}
          disabled={isProcessing}
          style={{
            padding: "0.4rem 0.75rem",
            background: "#fd7e14",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isProcessing ? "not-allowed" : "pointer",
            fontSize: "0.85rem",
            opacity: isProcessing ? 0.6 : 1,
          }}
        >
          {isProcessing ? "Processing..." : "Merge All"}
        </button>
      )}
      {onKeepAllSeparate && (
        <button
          onClick={onKeepAllSeparate}
          disabled={isProcessing}
          style={{
            padding: "0.4rem 0.75rem",
            background: "#198754",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isProcessing ? "not-allowed" : "pointer",
            fontSize: "0.85rem",
            opacity: isProcessing ? 0.6 : 1,
          }}
        >
          {isProcessing ? "Processing..." : "Keep All Separate"}
        </button>
      )}
      {onDismissAll && (
        <button
          onClick={onDismissAll}
          disabled={isProcessing}
          style={{
            padding: "0.4rem 0.75rem",
            background: "#6c757d",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isProcessing ? "not-allowed" : "pointer",
            fontSize: "0.85rem",
            opacity: isProcessing ? 0.6 : 1,
          }}
        >
          {isProcessing ? "Processing..." : "Dismiss All"}
        </button>
      )}
      <button
        onClick={onClear}
        disabled={isProcessing}
        style={{
          padding: "0.4rem 0.75rem",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          cursor: isProcessing ? "not-allowed" : "pointer",
          fontSize: "0.85rem",
          marginLeft: "auto",
        }}
      >
        Clear
      </button>
    </div>
  );
}

export default BatchActionBar;
