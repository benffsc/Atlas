import type { ColumnDef, RowData } from "@tanstack/react-table";
import type { CSSProperties, ReactNode } from "react";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> { // eslint-disable-line @typescript-eslint/no-unused-vars
    sortKey?: string;
    align?: "left" | "center" | "right";
    hideOnMobile?: boolean;
    minWidth?: string;
  }
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;

  // Pagination (server-side)
  total: number;
  pageIndex: number;
  pageSize: number;
  onPaginationChange: (page: number, pageSize: number) => void;
  pageSizeOptions?: number[];

  // Sorting (server-side)
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSortChange?: (sortKey: string, sortDir: "asc" | "desc") => void;

  // Row selection (ListDetailLayout preview)
  selectedRowId?: string;
  onRowClick?: (rowId: string) => void;
  getRowStyle?: (row: TData) => CSSProperties | undefined;

  // Mobile card fallback
  renderCard?: (row: TData, opts: { isSelected: boolean; onClick: () => void }) => ReactNode;

  // Density (FFS-1260, Dom Design)
  /** Row density: "default" (auto) or "compact" (38px rows) */
  density?: "default" | "compact";

  // Loading/Empty
  loading?: boolean;
  emptyState?: ReactNode;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;

  "aria-label"?: string;
}
