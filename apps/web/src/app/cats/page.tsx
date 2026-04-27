"use client";

import { useState, useEffect, Suspense } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDateLocal } from "@/lib/formatters";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useListData } from "@/hooks/useListData";
import { CatHealthBadges } from "@/components/badges";
import type { HealthFlag } from "@/components/badges/CatHealthBadges";
import EntityPreview from "@/components/search/EntityPreview";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { CatDetailShell } from "@/components/cat/CatDetailShell";
import { FilterChip, SearchInput } from "@/components/filters";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, useDataTable } from "@/components/data-table";

interface Cat {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  microchip: string | null;
  quality_tier: string;
  quality_reason: string;
  has_microchip: boolean;
  owner_count: number;
  owner_names: string | null;
  primary_place_id: string | null;
  primary_place_label: string | null;
  place_kind: string | null;
  has_place: boolean;
  created_at: string;
  last_appointment_date: string | null;
  appointment_count: number;
  source_system: string | null;
  is_deceased?: boolean;
  weight_lbs?: number | null;
  age_group?: string | null;
  health_flags?: HealthFlag[];
}

function buildCatParams(filters: Record<string, string>, apiParams: { limit: number; offset: number; sort?: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.sex) params.set("sex", filters.sex);
  if (filters.altered) params.set("altered_status", filters.altered);
  if (filters.has_place) params.set("has_place", filters.has_place);
  if (filters.has_origin) params.set("has_origin", filters.has_origin);
  if (filters.partner_org) params.set("partner_org", filters.partner_org);
  if (filters.disease) params.set("disease", filters.disease);
  if (filters.condition) params.set("condition", filters.condition);
  if (filters.is_deceased) params.set("is_deceased", filters.is_deceased);
  if (apiParams.sort) params.set("sort", apiParams.sort);
  params.set("limit", String(apiParams.limit));
  params.set("offset", String(apiParams.offset));
  return params;
}

const FILTER_DEFAULTS = {
  q: "",
  sex: "",
  altered: "",
  has_place: "",
  has_origin: "",
  partner_org: "",
  disease: "",
  condition: "",
  is_deceased: "",
  sort: "quality",
  sortDir: "desc",
  page: "0",
  pageSize: "25",
  selected: "",
};

// Column definitions
const catColumns: ColumnDef<Cat, unknown>[] = [
  {
    accessorKey: "display_name",
    header: "Name",
    meta: { sortKey: "name" },
    cell: ({ row }) => {
      const cat = row.original;
      return (
        <div>
          <EntityPreview entityType="cat" entityId={cat.cat_id}>
            <a
              href={`/cats/${cat.cat_id}`}
              onClick={(e) => e.stopPropagation()}
              style={cat.is_deceased ? { textDecoration: "line-through", color: "var(--text-muted)" } : {}}
            >
              {cat.display_name}
            </a>
          </EntityPreview>
          {(cat.health_flags?.length || cat.is_deceased) && (
            <div style={{ marginTop: "2px" }}>
              <CatHealthBadges healthFlags={cat.health_flags} isDeceased={cat.is_deceased} />
            </div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "quality_tier",
    header: "Confidence",
    meta: { sortKey: "quality" },
    cell: ({ row }) => {
      const cat = row.original;
      if (cat.quality_tier === "A") {
        return <span className="badge badge-primary" title="Has microchip">Verified</span>;
      }
      if (cat.quality_tier === "B") {
        return <span className="badge" title={cat.quality_reason} style={{ background: "#ffc107", color: "#000" }}>Clinic ID</span>;
      }
      return <span className="badge" title={cat.quality_reason} style={{ background: "#dc3545" }}>Unverified</span>;
    },
  },
  {
    accessorKey: "sex",
    header: "Gender",
    cell: ({ getValue }) => (getValue() as string) || "\u2014",
  },
  {
    accessorKey: "altered_status",
    header: "Altered",
    cell: ({ getValue }) => (getValue() as string) || "\u2014",
  },
  {
    accessorKey: "microchip",
    header: "Microchip",
    meta: { hideOnMobile: true },
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v ? <span className="text-sm">{v}</span> : "\u2014";
    },
  },
  {
    accessorKey: "last_appointment_date",
    header: "Last Appointment",
    meta: { sortKey: "recent_appointment", hideOnMobile: true },
    cell: ({ row }) => {
      const cat = row.original;
      return cat.last_appointment_date ? (
        <span className="text-sm" title={`${cat.appointment_count} appointment${cat.appointment_count !== 1 ? "s" : ""}`}>
          {formatDateLocal(cat.last_appointment_date)}
        </span>
      ) : (
        <span className="text-muted">&mdash;</span>
      );
    },
  },
  {
    accessorKey: "has_place",
    header: "Location",
    cell: ({ row }) => {
      const cat = row.original;
      return cat.has_place ? (
        <span className="badge badge-primary">{cat.place_kind || "place"}</span>
      ) : (
        <span className="text-muted">&mdash;</span>
      );
    },
  },
];

function CatsPageContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const { pageIndex, pageSize, sortKey, sortDir, handlePaginationChange, handleSortChange, apiParams } =
    useDataTable(filters, setFilters, { defaultPageSize: 25, defaultSort: "quality", defaultSortDir: "desc" });

  const [searchInput, setSearchInput] = useState(filters.q);

  const { items: cats, total, loading, error, refetch: refetchCats } = useListData<Cat>({
    endpoint: "/api/cats",
    filters,
    apiParams,
    buildParams: buildCatParams,
    dataKey: "cats",
  });

  // Sync search input on external clear
  useEffect(() => {
    if (filters.q !== searchInput) setSearchInput(filters.q);
  }, [filters.q]);

  const handleRowClick = (catId: string) => {
    setFilter("selected", filters.selected === catId ? "" : catId);
  };

  const panelContent = filters.selected ? (
    <CatDetailShell
      id={filters.selected}
      mode="panel"
      onClose={() => setFilter("selected", "")}
      onDataUpdated={() => refetchCats()}
    />
  ) : null;

  return (
    <ListDetailLayout
      isDetailOpen={!!filters.selected}
      detailPanel={panelContent}
      onDetailClose={() => setFilter("selected", "")}
    >
      <PageHeader title="Cats" />

      {/* Search bar — full width */}
      <div style={{ marginBottom: "0.75rem" }}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(v) => setFilters({ q: v, page: "0" })}
          placeholder="Search..."
        />
      </div>

      {/* Filter chips row */}
      <div className="filter-chips-row">
        <FilterChip
          label="Confidence"
          options={[
            { value: "A", label: "Verified" },
            { value: "B", label: "Clinic ID" },
            { value: "C", label: "Unverified" },
          ]}
          value={filters.has_origin || ""}
          onChange={(v) => setFilters({ has_origin: v, page: "0" })}
        />
        <FilterChip
          label="Gender"
          options={[
            { value: "Female", label: "Female" },
            { value: "Male", label: "Male" },
          ]}
          value={filters.sex}
          onChange={(v) => setFilters({ sex: v, page: "0" })}
        />
        <FilterChip
          label="Altered status"
          options={[
            { value: "Spayed", label: "Spayed" },
            { value: "Neutered", label: "Neutered" },
            { value: "Intact", label: "Intact" },
          ]}
          value={filters.altered}
          onChange={(v) => setFilters({ altered: v, page: "0" })}
        />
        <FilterChip
          label="Location"
          options={[
            { value: "true", label: "Has location" },
            { value: "false", label: "No location" },
          ]}
          value={filters.has_place}
          onChange={(v) => setFilters({ has_place: v, page: "0" })}
        />
        <FilterChip
          label="Source"
          options={[
            { value: "SCAS", label: "SCAS" },
            { value: "FFSC", label: "FFSC" },
            { value: "RPAS", label: "Rohnert Park" },
            { value: "MH", label: "Marin Humane" },
          ]}
          value={filters.partner_org}
          onChange={(v) => setFilters({ partner_org: v, page: "0" })}
        />
        <FilterChip
          label="Disease"
          options={[
            { value: "felv", label: "FeLV+" },
            { value: "fiv", label: "FIV+" },
          ]}
          value={filters.disease}
          onChange={(v) => setFilters({ disease: v, page: "0" })}
        />
        <FilterChip
          label="Condition"
          options={[
            { value: "pregnant", label: "Pregnant" },
            { value: "lactating", label: "Lactating" },
            { value: "uri", label: "URI" },
            { value: "fleas", label: "Fleas" },
            { value: "ear_mites", label: "Ear Mites" },
          ]}
          value={filters.condition}
          onChange={(v) => setFilters({ condition: v, page: "0" })}
        />
        <FilterChip
          label="Living & Deceased"
          options={[
            { value: "false", label: "Living only" },
            { value: "true", label: "Deceased only" },
          ]}
          value={filters.is_deceased}
          onChange={(v) => setFilters({ is_deceased: v, page: "0" })}
        />
      </div>

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!error && (
        <DataTable<Cat>
          columns={catColumns}
          data={cats}
          density="compact"
          getRowId={(cat) => cat.cat_id}
          total={total}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPaginationChange={handlePaginationChange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          selectedRowId={filters.selected}
          onRowClick={handleRowClick}
          getRowStyle={(cat) => cat.quality_tier !== "A" ? { opacity: 0.8 } : undefined}
          loading={loading}
          hasActiveFilters={!isDefault}
          onClearFilters={clearFilters}
          renderCard={(cat, { isSelected, onClick }) => (
            <a
              href={`/cats/${cat.cat_id}`}
              style={{
                display: "block",
                textDecoration: "none",
                color: "inherit",
                background: isSelected ? "var(--info-bg, #eff6ff)" : "var(--card-bg)",
                border: `1px solid ${isSelected ? "var(--primary, #3b82f6)" : "var(--border)"}`,
                borderRadius: "8px",
                padding: "0.75rem",
                opacity: cat.quality_tier !== "A" ? 0.85 : 1,
              }}
              onClick={(e) => {
                e.preventDefault();
                onClick();
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: "0.95rem", textDecoration: cat.is_deceased ? "line-through" : "none", color: cat.is_deceased ? "var(--text-muted)" : "inherit" }}>
                  {cat.display_name}
                </div>
                {cat.quality_tier === "A" ? (
                  <span className="badge badge-primary" style={{ fontSize: "0.7em" }}>Verified</span>
                ) : cat.quality_tier === "B" ? (
                  <span className="badge" style={{ fontSize: "0.7em", background: "#ffc107", color: "#000" }}>Clinic ID</span>
                ) : (
                  <span className="badge" style={{ fontSize: "0.7em", background: "#dc3545" }}>Unverified</span>
                )}
              </div>
              {(cat.health_flags?.length || cat.is_deceased) && (
                <div style={{ marginTop: "4px" }}>
                  <CatHealthBadges healthFlags={cat.health_flags} isDeceased={cat.is_deceased} />
                </div>
              )}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                <span>{cat.sex || "Unknown sex"} / {cat.altered_status || "Unknown"}</span>
              </div>
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {cat.microchip && <span style={{ fontFamily: "monospace" }}>{cat.microchip.slice(0, 10)}...</span>}
                {cat.last_appointment_date && <span>Last appointment: {formatDateLocal(cat.last_appointment_date)}</span>}
                {cat.has_place && <span>{cat.place_kind || "Has location"}</span>}
              </div>
            </a>
          )}
          aria-label="Cats table"
        />
      )}
    </ListDetailLayout>
  );
}


export default function CatsPage() {
  return (
    <Suspense fallback={<div className="loading">Loading cats...</div>}>
      <CatsPageContent />
    </Suspense>
  );
}
