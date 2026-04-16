"use client";

import { useState, useEffect, Suspense } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useEntityDetail } from "@/hooks/useEntityDetail";
import { useListData } from "@/hooks/useListData";
import { formatPlaceKind } from "@/lib/display-labels";
import { formatRelativeTime } from "@/lib/formatters";
import { PlaceRiskBadges } from "@/components/badges";
import type { DiseaseFlag } from "@/components/badges/PlaceRiskBadges";
import type { PlaceDetail } from "@/hooks/useEntityDetail";
import EntityPreview from "@/components/search/EntityPreview";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { PlacePreviewContent } from "@/components/preview/PlacePreviewContent";
import { FilterBar, FilterDivider, SearchInput, ActiveFilterTags } from "@/components/filters";
import { DataTable, useDataTable } from "@/components/data-table";
import { SkeletonList } from "@/components/feedback/Skeleton";

interface Place {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  postal_code: string | null;
  cat_count: number;
  person_count: number;
  has_cat_activity: boolean;
  created_at: string;
  last_appointment_date: string | null;
  active_request_count: number;
  watch_list?: boolean;
  disease_flags?: DiseaseFlag[];
}

function buildPlaceParams(filters: Record<string, string>, apiParams: { limit: number; offset: number; sort?: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.kind) params.set("place_kind", filters.kind);
  if (filters.has_cats) params.set("has_cats", filters.has_cats);
  if (filters.disease_risk) params.set("disease_risk", filters.disease_risk);
  if (filters.watch_list) params.set("watch_list", filters.watch_list);
  if (apiParams.sort) params.set("sort", apiParams.sort);
  params.set("limit", String(apiParams.limit));
  params.set("offset", String(apiParams.offset));
  return params;
}

const KIND_COLORS: Record<string, string> = {
  residential_house: "#198754",
  apartment_unit: "#0d6efd",
  apartment_building: "#6610f2",
  business: "#fd7e14",
  clinic: "#dc3545",
  outdoor_site: "#20c997",
  neighborhood: "#6c757d",
  mobile_home_space: "#795548",
};

const FILTER_DEFAULTS = {
  q: "",
  kind: "",
  has_cats: "",
  disease_risk: "",
  watch_list: "",
  page: "0",
  pageSize: "25",
  sortDir: "desc",
  selected: "",
};

// Column definitions
const placeColumns: ColumnDef<Place, unknown>[] = [
  {
    accessorKey: "display_name",
    header: "Name",
    meta: { sortKey: "name" },
    cell: ({ row }) => {
      const place = row.original;
      return (
        <div>
          <EntityPreview entityType="place" entityId={place.place_id}>
            <a href={`/places/${place.place_id}`} onClick={(e) => e.stopPropagation()}>
              {place.display_name}
            </a>
          </EntityPreview>
          {(place.disease_flags?.length || place.watch_list) ? (
            <div style={{ marginTop: "2px" }}>
              <PlaceRiskBadges
                diseaseFlags={place.disease_flags}
                watchList={place.watch_list}
              />
            </div>
          ) : null}
        </div>
      );
    },
  },
  {
    accessorKey: "formatted_address",
    header: "Address",
    meta: { hideOnMobile: true },
    cell: ({ row }) => {
      const place = row.original;
      return (
        <div>
          {place.formatted_address || <span className="text-muted">&mdash;</span>}
          {place.locality && <div className="text-sm text-muted">{place.locality}</div>}
        </div>
      );
    },
  },
  {
    accessorKey: "place_kind",
    header: "Type",
    cell: ({ row }) => {
      const place = row.original;
      return place.place_kind ? (
        <span className="badge" style={{ background: KIND_COLORS[place.place_kind] || "#6c757d" }}>
          {formatPlaceKind(place.place_kind)}
        </span>
      ) : (
        <span className="text-muted">&mdash;</span>
      );
    },
  },
  {
    accessorKey: "cat_count",
    header: "Cats",
    meta: { sortKey: "cats" },
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v > 0 ? <span>{v}</span> : <span className="text-muted">0</span>;
    },
  },
  {
    accessorKey: "person_count",
    header: "People",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v > 0 ? <span>{v}</span> : <span className="text-muted">0</span>;
    },
  },
  {
    accessorKey: "last_appointment_date",
    header: "Last Active",
    meta: { sortKey: "recent_activity", hideOnMobile: true },
    cell: ({ row }) => {
      const place = row.original;
      return (
        <div>
          {place.last_appointment_date ? (
            <span title={place.last_appointment_date}>
              {formatRelativeTime(place.last_appointment_date)}
            </span>
          ) : (
            <span className="text-muted">&mdash;</span>
          )}
          {place.active_request_count > 0 && (
            <span
              className="badge"
              style={{
                marginLeft: "0.5rem",
                fontSize: "0.65em",
                background: "var(--warning-bg)",
                color: "var(--warning-text)",
              }}
            >
              {place.active_request_count} req
            </span>
          )}
        </div>
      );
    },
  },
];

function PlacesPageContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const { pageIndex, pageSize, sortKey, sortDir, handlePaginationChange, handleSortChange, apiParams } =
    useDataTable(filters, setFilters, { defaultPageSize: 25 });

  const [searchInput, setSearchInput] = useState(filters.q);

  const { items: places, total, loading, error } = useListData<Place>({
    endpoint: "/api/places",
    filters,
    apiParams,
    buildParams: buildPlaceParams,
    dataKey: "places",
  });

  // Panel preview
  const { detail: selectedDetail, loading: detailLoading } = useEntityDetail(
    filters.selected ? "place" : null,
    filters.selected || null,
  );

  // Sync search input on external clear
  useEffect(() => {
    if (filters.q !== searchInput) setSearchInput(filters.q);
  }, [filters.q]);

  const handleRowClick = (placeId: string) => {
    setFilter("selected", filters.selected === placeId ? "" : placeId);
  };

  const panelContent = filters.selected && selectedDetail && !detailLoading ? (
    <PlacePreviewContent
      place={selectedDetail as PlaceDetail}
      onClose={() => setFilter("selected", "")}
    />
  ) : filters.selected && detailLoading ? (
    <div style={{ padding: "2rem" }}><SkeletonList items={6} /></div>
  ) : null;

  return (
    <ListDetailLayout
      isDetailOpen={!!filters.selected}
      detailPanel={panelContent}
      onDetailClose={() => setFilter("selected", "")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Places</h1>
        <a href="/places/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
          + New Place
        </a>
      </div>

      <FilterBar showClear={!isDefault} onClear={clearFilters}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(v) => setFilters({ q: v, page: "0" })}
          placeholder="Search by address, locality..."
        />
        <FilterDivider />
        <select value={filters.kind} onChange={(e) => setFilters({ kind: e.target.value, page: "0" })} style={selectStyle}>
          <option value="">All types</option>
          <option value="residential_house">Residential House</option>
          <option value="apartment_unit">Apartment Unit</option>
          <option value="apartment_building">Apartment Building</option>
          <option value="business">Business</option>
          <option value="clinic">Clinic</option>
          <option value="outdoor_site">Outdoor Site</option>
          <option value="neighborhood">Neighborhood</option>
        </select>
        <select value={filters.has_cats} onChange={(e) => setFilters({ has_cats: e.target.value, page: "0" })} style={selectStyle}>
          <option value="">All places</option>
          <option value="true">Has cats</option>
          <option value="false">No cats</option>
        </select>
        <select value={filters.disease_risk} onChange={(e) => setFilters({ disease_risk: e.target.value, page: "0" })} style={selectStyle}>
          <option value="">All risk levels</option>
          <option value="felv">FeLV risk</option>
          <option value="fiv">FIV risk</option>
        </select>
        <select value={filters.watch_list} onChange={(e) => setFilters({ watch_list: e.target.value, page: "0" })} style={selectStyle}>
          <option value="">All watch status</option>
          <option value="true">On watch list</option>
          <option value="false">Not on watch list</option>
        </select>
      </FilterBar>

      <ActiveFilterTags
        filters={filters}
        defaults={FILTER_DEFAULTS}
        labels={{
          kind: "Type",
          has_cats: "Has Cats",
          disease_risk: "Disease Risk",
          watch_list: "Watch List",
        }}
        valueLabels={{
          disease_risk: { felv: "FeLV", fiv: "FIV" },
        }}
        exclude={["q", "page", "pageSize", "sortDir", "selected"]}
        onRemove={(key) => setFilter(key as keyof typeof FILTER_DEFAULTS, FILTER_DEFAULTS[key as keyof typeof FILTER_DEFAULTS])}
        onClearAll={clearFilters}
      />

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!error && (
        <DataTable<Place>
          columns={placeColumns}
          data={places}
          getRowId={(place) => place.place_id}
          total={total}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPaginationChange={handlePaginationChange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          selectedRowId={filters.selected}
          onRowClick={handleRowClick}
          loading={loading}
          hasActiveFilters={!isDefault}
          onClearFilters={clearFilters}
          renderCard={(place, { isSelected, onClick }) => (
            <a
              href={`/places/${place.place_id}`}
              style={{
                display: "block",
                textDecoration: "none",
                color: "inherit",
                background: isSelected ? "var(--info-bg, #eff6ff)" : "var(--card-bg)",
                border: `1px solid ${isSelected ? "var(--primary, #3b82f6)" : "var(--border)"}`,
                borderRadius: "8px",
                padding: "0.75rem",
              }}
              onClick={(e) => {
                e.preventDefault();
                onClick();
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: "0.95rem", flex: 1, minWidth: 0 }}>
                  {place.display_name}
                </div>
                {place.place_kind && (
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.7em",
                      background: KIND_COLORS[place.place_kind] || "#6c757d",
                      flexShrink: 0,
                      marginLeft: "0.5rem",
                    }}
                  >
                    {formatPlaceKind(place.place_kind)}
                  </span>
                )}
              </div>
              {(place.disease_flags?.length || place.watch_list || place.active_request_count > 0) ? (
                <div style={{ marginTop: "4px" }}>
                  <PlaceRiskBadges
                    diseaseFlags={place.disease_flags}
                    watchList={place.watch_list}
                    activeRequestCount={place.active_request_count}
                  />
                </div>
              ) : null}
              {place.formatted_address && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {place.formatted_address}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
                <span>{place.cat_count} cats</span>
                <span>{place.person_count} people</span>
                {place.locality && <span>{place.locality}</span>}
                {place.last_appointment_date && (
                  <span>Last: {formatRelativeTime(place.last_appointment_date)}</span>
                )}
              </div>
            </a>
          )}
          aria-label="Places table"
        />
      )}
    </ListDetailLayout>
  );
}

const selectStyle = {
  padding: "0.3rem 0.5rem",
  fontSize: "0.75rem",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "9999px",
  background: "var(--card-bg, #fff)",
  color: "var(--text-primary, #111827)",
  cursor: "pointer",
} as const;

export default function PlacesPage() {
  return (
    <Suspense fallback={<div className="loading">Loading places...</div>}>
      <PlacesPageContent />
    </Suspense>
  );
}
