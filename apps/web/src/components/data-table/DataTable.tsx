"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { useIsMobile } from "@/hooks/useIsMobile";
import { COLORS, TYPOGRAPHY, TRANSITIONS } from "@/lib/design-tokens";
import { EmptyFilteredResults, EmptyList } from "@/components/feedback/EmptyState";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTableProps } from "./types";
import { SkeletonList } from "@/components/feedback/Skeleton";

// Skeleton loading rows
function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} style={{ padding: "0.75rem 0.5rem" }}>
              <div
                style={{
                  height: "0.875rem",
                  width: `${50 + Math.random() * 40}%`,
                  backgroundColor: COLORS.gray100,
                  borderRadius: "4px",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
            </td>
          ))}
        </tr>
      ))}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </>
  );
}

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  total,
  pageIndex,
  pageSize,
  onPaginationChange,
  pageSizeOptions,
  sortKey,
  sortDir,
  onSortChange,
  selectedRowId,
  onRowClick,
  getRowStyle,
  renderCard,
  loading,
  emptyState,
  hasActiveFilters,
  onClearFilters,
  "aria-label": ariaLabel,
}: DataTableProps<TData>) {
  const isMobile = useIsMobile();

  const table = useReactTable<TData>({
    data,
    columns: columns as ColumnDef<TData, unknown>[],
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => getRowId(row),
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    state: {
      pagination: { pageIndex, pageSize },
    },
  });

  // Mobile card view
  if (isMobile && renderCard) {
    if (loading) {
      return (
        <div style={{ padding: "1rem" }}>
          <SkeletonList items={5} />
        </div>
      );
    }

    if (!data.length) {
      return emptyState ?? (
        hasActiveFilters ? (
          <EmptyFilteredResults onClearFilters={onClearFilters} />
        ) : (
          <EmptyList entityName="items" />
        )
      );
    }

    return (
      <div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(var(--card-min-width, 240px), 1fr))",
            gap: "0.75rem",
          }}
        >
          {data.map((row) => {
            const id = getRowId(row);
            return (
              <div key={id}>
                {renderCard(row, {
                  isSelected: selectedRowId === id,
                  onClick: () => onRowClick?.(id),
                })}
              </div>
            );
          })}
        </div>
        <DataTablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          total={total}
          onPaginationChange={onPaginationChange}
          pageSizeOptions={pageSizeOptions}
        />
      </div>
    );
  }

  // Desktop table
  const visibleColumns = isMobile
    ? columns.filter((col) => !(col.meta as { hideOnMobile?: boolean })?.hideOnMobile)
    : columns;

  return (
    <div>
      <div className="table-container">
        <table aria-label={ariaLabel} style={{ width: "100%" }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as {
                    sortKey?: string;
                    align?: string;
                    minWidth?: string;
                    hideOnMobile?: boolean;
                  } | undefined;

                  if (isMobile && meta?.hideOnMobile) return null;

                  const isSortable = !!meta?.sortKey && !!onSortChange;
                  const isCurrentSort = meta?.sortKey === sortKey;

                  return (
                    <th
                      key={header.id}
                      style={{
                        textAlign: (meta?.align as "left" | "center" | "right") || "left",
                        minWidth: meta?.minWidth,
                        cursor: isSortable ? "pointer" : "default",
                        userSelect: isSortable ? "none" : "auto",
                        whiteSpace: "nowrap",
                      }}
                      onClick={() => {
                        if (isSortable && meta?.sortKey) {
                          const newDir = isCurrentSort && sortDir === "asc" ? "desc" : "asc";
                          onSortChange(meta.sortKey, newDir);
                        }
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {isSortable && isCurrentSort && (
                          <span style={{ fontSize: "0.7em", opacity: 0.7 }}>
                            {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                          </span>
                        )}
                        {isSortable && !isCurrentSort && (
                          <span style={{ fontSize: "0.7em", opacity: 0.3 }}>
                            {"\u25B2"}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={visibleColumns.length} />
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} style={{ padding: 0 }}>
                  {emptyState ?? (
                    hasActiveFilters ? (
                      <EmptyFilteredResults onClearFilters={onClearFilters} />
                    ) : (
                      <EmptyList entityName="items" />
                    )
                  )}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isSelected = selectedRowId === row.id;
                const customStyle = getRowStyle?.(row.original);

                return (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick?.(row.id)}
                    style={{
                      cursor: onRowClick ? "pointer" : "default",
                      background: isSelected ? "var(--info-bg, #eff6ff)" : undefined,
                      borderLeft: isSelected ? `3px solid ${COLORS.primary}` : "3px solid transparent",
                      transition: `background ${TRANSITIONS.fast}`,
                      ...customStyle,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as {
                        align?: string;
                        hideOnMobile?: boolean;
                      } | undefined;

                      if (isMobile && meta?.hideOnMobile) return null;

                      return (
                        <td
                          key={cell.id}
                          style={{
                            textAlign: (meta?.align as "left" | "center" | "right") || "left",
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && data.length > 0 && (
        <DataTablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          total={total}
          onPaginationChange={onPaginationChange}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  );
}
