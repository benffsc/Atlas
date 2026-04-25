"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { fetchApi } from "@/lib/api-client";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { formatPhone } from "@/lib/formatters";
import { FilterBar, FilterChip, FilterDivider, SearchInput } from "@/components/filters";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, DataTablePagination, useDataTable } from "@/components/data-table";
import { SkeletonTable, SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyFilteredResults } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { FosterPreviewContent } from "@/components/preview/FosterPreviewContent";

interface Foster {
  person_id: string;
  display_name: string;
  role_status: string;
  email: string | null;
  phone: string | null;
  started_at: string | null;
  cats_fostered: number;
  vh_groups: string | null;
  has_agreement: boolean;
}

interface FosterAggregates {
  total_fosters: number;
  active_fosters: number;
  inactive_fosters: number;
  total_cats_fostered: number;
}

const FILTER_DEFAULTS = {
  status: "",
  search: "",
  sort: "display_name",
  sortDir: "asc",
  view: "table",
  page: "0",
  pageSize: "50",
  selected: "",
};


function ContactInfo({ email, phone }: { email: string | null; phone: string | null }) {
  return (
    <div style={{ fontSize: "0.8rem" }}>
      {phone && (
        <a href={`tel:${phone}`} style={{ color: "var(--primary)", textDecoration: "none", marginRight: "0.5rem" }}>
          {formatPhone(phone)}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} style={{ color: "var(--primary)", textDecoration: "none", fontSize: "0.75rem" }}>
          {email}
        </a>
      )}
      {!phone && !email && <span className="text-muted">No contact</span>}
    </div>
  );
}

function FosterCard({ foster }: { foster: Foster }) {
  const isInactive = foster.role_status !== "active";

  return (
    <a
      href={`/fosters/${foster.person_id}`}
      style={{
        display: "block",
        padding: "1rem",
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        textDecoration: "none",
        color: "inherit",
        opacity: isInactive ? 0.6 : 1,
        transition: "box-shadow 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div style={{ fontWeight: 600 }}>{foster.display_name}</div>
        <span style={{
          padding: "0.125rem 0.5rem",
          borderRadius: "9999px",
          fontSize: "0.7rem",
          fontWeight: 600,
          background: foster.role_status === "active" ? "#dcfce7" : "#f3f4f6",
          color: foster.role_status === "active" ? "#166534" : "#6b7280",
        }}>
          {foster.role_status}
        </span>
      </div>
      <ContactInfo email={foster.email} phone={foster.phone} />
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.8rem" }}>
        <span>{foster.cats_fostered} cats</span>
        {foster.vh_groups && (
          <span className="text-muted" style={{ fontSize: "0.75rem" }}>{foster.vh_groups}</span>
        )}
        {foster.has_agreement && (
          <span style={{ color: "#1e40af", fontSize: "0.75rem" }}>Agreement</span>
        )}
      </div>
    </a>
  );
}

// Column definitions for table view
const fosterColumns: ColumnDef<Foster, unknown>[] = [
  {
    accessorKey: "display_name",
    header: "Name",
    meta: { sortKey: "display_name" },
    cell: ({ row }) => {
      const f = row.original;
      return (
        <a
          href={`/fosters/${f.person_id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}
        >
          {f.display_name}
        </a>
      );
    },
  },
  {
    accessorKey: "email",
    header: "Contact",
    cell: ({ row }) => {
      const f = row.original;
      return <ContactInfo email={f.email} phone={f.phone} />;
    },
  },
  {
    accessorKey: "role_status",
    header: "Status",
    meta: { sortKey: "role_status" },
    cell: ({ row }) => {
      const f = row.original;
      return (
        <span style={{
          display: "inline-block",
          padding: "0.125rem 0.5rem",
          borderRadius: "9999px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: f.role_status === "active" ? "#dcfce7" : "#f3f4f6",
          color: f.role_status === "active" ? "#166534" : "#6b7280",
        }}>
          {f.role_status}
        </span>
      );
    },
  },
  {
    accessorKey: "cats_fostered",
    header: "Cats",
    meta: { sortKey: "cats_fostered", align: "center" as const },
    cell: ({ getValue }) => (
      <span style={{ fontWeight: 500 }}>{getValue() as number}</span>
    ),
  },
  {
    accessorKey: "vh_groups",
    header: "VH Groups",
    meta: { hideOnMobile: true },
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v ? <span style={{ fontSize: "0.8rem" }}>{v}</span> : <span className="text-muted">&mdash;</span>;
    },
  },
  {
    accessorKey: "has_agreement",
    header: "Agreement",
    cell: ({ getValue }) => {
      const v = getValue() as boolean;
      return v ? (
        <span style={{
          display: "inline-block",
          padding: "0.125rem 0.5rem",
          borderRadius: "4px",
          fontSize: "0.75rem",
          background: "#dbeafe",
          color: "#1e40af",
        }}>
          On file
        </span>
      ) : (
        <span className="text-muted" style={{ fontSize: "0.8rem" }}>None</span>
      );
    },
  },
];

const sortSelectStyle = {
  padding: "0.3rem 0.5rem",
  fontSize: "0.75rem",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "9999px",
  background: "var(--card-bg, #fff)",
  color: "var(--text-primary, #111827)",
  cursor: "pointer",
} as const;

function FosterRosterContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const { pageIndex, pageSize, sortKey, sortDir, handlePaginationChange, handleSortChange, apiParams } =
    useDataTable(filters, setFilters, { defaultPageSize: 50, defaultSort: "display_name", defaultSortDir: "asc" });

  const [searchInput, setSearchInput] = useState(filters.search);
  const [fosters, setFosters] = useState<Foster[]>([]);
  const [aggregates, setAggregates] = useState<FosterAggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  // Compute total from hasMore pattern (API does not return total count)
  const total = hasMore ? apiParams.offset + pageSize + 1 : apiParams.offset + fosters.length;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(apiParams.limit));
      params.set("offset", String(apiParams.offset));
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      if (apiParams.sort) params.set("sort", apiParams.sort);

      const data = await fetchApi<{
        fosters: Foster[];
        aggregates: FosterAggregates;
      }>(`/api/fosters?${params.toString()}`);

      setFosters(data.fosters || []);
      setAggregates(data.aggregates || null);
      setHasMore((data.fosters || []).length === pageSize);
    } catch (err) {
      console.error("Failed to fetch fosters:", err);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.search, apiParams.sort, apiParams.limit, apiParams.offset, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sync search input on external clear
  useEffect(() => {
    if (filters.search !== searchInput) setSearchInput(filters.search);
  }, [filters.search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title="Foster Roster"
        subtitle={`VolunteerHub-sourced foster parents.${aggregates ? ` ${aggregates.total_fosters} total.` : ""}`}
      />

      {/* Stats */}
      {aggregates && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <StatCard label="Total Fosters" value={aggregates.total_fosters} />
          <StatCard label="Active" value={aggregates.active_fosters} valueColor="#16a34a" />
          <StatCard label="Inactive" value={aggregates.inactive_fosters} valueColor="#6b7280" />
          <StatCard label="Cats Fostered" value={aggregates.total_cats_fostered} valueColor="#7c3aed" />
        </div>
      )}

      {/* Filters */}
      <FilterBar showClear={!isDefault} onClear={clearFilters}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(v) => setFilters({ search: v, page: "0" })}
          placeholder="Search by name or email..."
        />
        <FilterDivider />
        <FilterChip
          label="Status"
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          value={filters.status}
          onChange={(v) => setFilters({ status: v, page: "0" })}
        />
        <FilterDivider />
        <FilterChip
          label="View"
          options={[
            { value: "table", label: "Table" },
            { value: "cards", label: "Cards" },
          ]}
          value={filters.view}
          onChange={(v) => setFilter("view", v || "table")}
        />
        <FilterDivider />
        <select
          value={filters.sort}
          onChange={(e) => handleSortChange(e.target.value, sortDir)}
          style={sortSelectStyle}
        >
          <option value="display_name">Name</option>
          <option value="cats_fostered">Cats Fostered</option>
          <option value="started_at">Start Date</option>
        </select>
      </FilterBar>

      {/* Content */}
      {filters.view === "cards" ? (
        <>
          {loading ? (
            <SkeletonList items={6} showAvatar />
          ) : fosters.length === 0 ? (
            <EmptyFilteredResults onClearFilters={clearFilters} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
              {fosters.map((f) => <FosterCard key={f.person_id} foster={f} />)}
            </div>
          )}
          {!loading && fosters.length > 0 && (
            <DataTablePagination
              pageIndex={pageIndex}
              pageSize={pageSize}
              total={total}
              onPaginationChange={handlePaginationChange}
            />
          )}
        </>
      ) : (
        <DataTable<Foster>
          columns={fosterColumns}
          data={fosters}
          density="compact"
          getRowId={(f) => f.person_id}
          total={total}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPaginationChange={handlePaginationChange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          getRowStyle={(f) => f.role_status !== "active" ? { opacity: 0.6, background: "var(--section-bg)" } : undefined}
          loading={loading}
          hasActiveFilters={!isDefault}
          onClearFilters={clearFilters}
          aria-label="Foster roster table"
        />
      )}
    </div>
  );
}

export default function FostersPage() {
  return (
    <Suspense fallback={<div className="page-container"><SkeletonTable rows={8} columns={5} /></div>}>
      <FosterRosterContent />
    </Suspense>
  );
}
