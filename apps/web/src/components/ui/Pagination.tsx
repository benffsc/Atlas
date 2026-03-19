interface PaginationProps {
  offset: number;
  limit: number;
  /** Direct "has more" flag from API. Takes precedence over `total`. */
  hasMore?: boolean;
  /** Total item count — used to compute hasMore and display "of N". */
  total?: number;
  /** Items on current page (for "Showing X–Y" display). Defaults to limit. */
  itemCount?: number;
  /** Suffix after total count, e.g. "emails" → "of 150 emails" */
  totalLabel?: string;
  onPrevious: () => void;
  onNext: () => void;
  style?: React.CSSProperties;
}

export function Pagination({
  offset,
  limit,
  hasMore,
  total,
  itemCount,
  totalLabel,
  onPrevious,
  onNext,
  style,
}: PaginationProps) {
  const canPrevious = offset > 0;
  const canNext = hasMore !== undefined ? hasMore : total !== undefined ? offset + limit < total : false;
  const count = itemCount ?? limit;

  const rangeEnd = total !== undefined
    ? Math.min(offset + limit, total)
    : offset + count;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: "1.5rem",
        ...style,
      }}
    >
      <button
        onClick={onPrevious}
        disabled={!canPrevious}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "transparent",
          cursor: canPrevious ? "pointer" : "default",
          opacity: canPrevious ? 1 : 0.5,
        }}
      >
        Previous
      </button>
      <span className="text-muted text-sm">
        Showing {offset + 1}–{rangeEnd}
        {total !== undefined && (
          <> of {total}{totalLabel ? ` ${totalLabel}` : ""}</>
        )}
      </span>
      <button
        onClick={onNext}
        disabled={!canNext}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "transparent",
          cursor: canNext ? "pointer" : "default",
          opacity: canNext ? 1 : 0.5,
        }}
      >
        Next
      </button>
    </div>
  );
}
