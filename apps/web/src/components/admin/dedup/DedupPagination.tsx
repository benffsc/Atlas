interface Props {
  offset: number;
  limit: number;
  hasMore: boolean;
  candidateCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function DedupPagination({ offset, limit, hasMore, candidateCount, onPrevious, onNext }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: "1.5rem",
      }}
    >
      <button
        onClick={onPrevious}
        disabled={offset === 0}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "transparent",
          cursor: offset === 0 ? "default" : "pointer",
          opacity: offset === 0 ? 0.5 : 1,
        }}
      >
        Previous
      </button>
      <span className="text-muted text-sm">
        Showing {offset + 1}–{Math.min(offset + limit, offset + candidateCount)}
      </span>
      <button
        onClick={onNext}
        disabled={!hasMore}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "transparent",
          cursor: !hasMore ? "default" : "pointer",
          opacity: !hasMore ? 0.5 : 1,
        }}
      >
        Next
      </button>
    </div>
  );
}
