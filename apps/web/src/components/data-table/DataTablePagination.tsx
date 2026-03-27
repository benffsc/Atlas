"use client";

import { useMemo } from "react";
import { COLORS, TYPOGRAPHY, BORDERS, TRANSITIONS } from "@/lib/design-tokens";

interface DataTablePaginationProps {
  pageIndex: number;
  pageSize: number;
  total: number;
  onPaginationChange: (page: number, pageSize: number) => void;
  pageSizeOptions?: number[];
}

function getVisiblePages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);

  const pages: (number | "ellipsis")[] = [0];

  if (current > 2) pages.push("ellipsis");

  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 3) pages.push("ellipsis");

  pages.push(total - 1);

  return pages;
}

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "2rem",
  height: "2rem",
  padding: "0 0.5rem",
  fontSize: TYPOGRAPHY.size.sm,
  border: `1px solid ${COLORS.border}`,
  borderRadius: BORDERS.radius.md,
  cursor: "pointer",
  transition: `all ${TRANSITIONS.fast}`,
  background: "var(--card-bg, #fff)",
  color: COLORS.textPrimary,
} as const;

export function DataTablePagination({
  pageIndex,
  pageSize,
  total,
  onPaginationChange,
  pageSizeOptions = [10, 25, 50, 100],
}: DataTablePaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const visiblePages = useMemo(() => getVisiblePages(pageIndex, totalPages), [pageIndex, totalPages]);

  if (totalPages <= 1 && total <= pageSize) return null;

  const canPrev = pageIndex > 0;
  const canNext = pageIndex < totalPages - 1;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        marginTop: "1rem",
        padding: "0.5rem 0",
      }}
    >
      {/* Page navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
        <button
          type="button"
          onClick={() => onPaginationChange(pageIndex - 1, pageSize)}
          disabled={!canPrev}
          style={{
            ...buttonBase,
            ...(canPrev
              ? {}
              : {
                  color: "var(--muted)",
                  background: "var(--bg-secondary)",
                  borderColor: "var(--border-light, var(--border))",
                  cursor: "not-allowed",
                }),
          }}
        >
          Previous
        </button>

        {visiblePages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e${i}`} style={{ padding: "0 0.25rem", color: COLORS.gray400 }}>
              &hellip;
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPaginationChange(p, pageSize)}
              style={{
                ...buttonBase,
                background: p === pageIndex ? COLORS.primary : "var(--card-bg, #fff)",
                color: p === pageIndex ? "#fff" : COLORS.textPrimary,
                borderColor: p === pageIndex ? COLORS.primary : COLORS.border,
                fontWeight: p === pageIndex ? 600 : 400,
              }}
            >
              {p + 1}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onPaginationChange(pageIndex + 1, pageSize)}
          disabled={!canNext}
          style={{
            ...buttonBase,
            ...(canNext
              ? {}
              : {
                  color: "var(--muted)",
                  background: "var(--bg-secondary)",
                  borderColor: "var(--border-light, var(--border))",
                  cursor: "not-allowed",
                }),
          }}
        >
          Next
        </button>
      </div>

      {/* Right side: page size + total */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: TYPOGRAPHY.size.sm }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: COLORS.textSecondary }}>
          Records per page:
          <select
            value={pageSize}
            onChange={(e) => onPaginationChange(0, parseInt(e.target.value, 10))}
            style={{
              padding: "0.25rem 0.375rem",
              fontSize: TYPOGRAPHY.size.sm,
              border: `1px solid ${COLORS.border}`,
              borderRadius: BORDERS.radius.md,
              background: "var(--card-bg, #fff)",
              color: COLORS.textPrimary,
              cursor: "pointer",
            }}
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <span style={{ color: COLORS.textSecondary }}>
          Total: <strong style={{ color: COLORS.textPrimary }}>{total.toLocaleString()}</strong>
        </span>
      </div>
    </div>
  );
}
