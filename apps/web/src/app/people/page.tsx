"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useEntityDetail } from "@/hooks/useEntityDetail";
import { useListData } from "@/hooks/useListData";
import { formatRelativeTime } from "@/lib/formatters";
import { PersonStatusBadges } from "@/components/badges";
import type { PersonDetail } from "@/hooks/useEntityDetail";
import EntityPreview from "@/components/search/EntityPreview";
import { CreatePersonModal } from "@/components/modals";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { PersonPreviewContent } from "@/components/preview/PersonPreviewContent";
import { FilterBar, SearchInput, ToggleButtonGroup, FilterDivider, ActiveFilterTags } from "@/components/filters";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, useDataTable } from "@/components/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { SkeletonList } from "@/components/feedback/Skeleton";

interface Person {
  person_id: string;
  display_name: string;
  account_type: string | null;
  is_canonical: boolean;
  surface_quality: string | null;
  quality_reason: string | null;
  has_email: boolean;
  has_phone: boolean;
  cat_count: number;
  place_count: number;
  cat_names: string | null;
  primary_place: string | null;
  created_at: string;
  last_appointment_date: string | null;
  // Status fields (FFS-434)
  primary_role?: string | null;
  trapper_type?: string | null;
  do_not_contact?: boolean;
  entity_type?: string | null;
}

function buildPeopleParams(filters: Record<string, string>, apiParams: { limit: number; offset: number; sort?: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.deep === "true") params.set("deep_search", "true");
  params.set("limit", String(apiParams.limit));
  params.set("offset", String(apiParams.offset));
  return params;
}

const FILTER_DEFAULTS = {
  q: "",
  deep: "",
  page: "0",
  pageSize: "25",
  sortDir: "desc",
  selected: "",
};

const DEEP_SEARCH_OPTIONS = [
  { value: "", label: "Standard" },
  { value: "true", label: "Deep" },
];

const personColumns: ColumnDef<Person, unknown>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => {
      const person = row.original;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <EntityPreview entityType="person" entityId={person.person_id}>
            <a href={`/people/${person.person_id}`} onClick={(e) => e.stopPropagation()}>{person.display_name}</a>
          </EntityPreview>
          <PersonStatusBadges
            primaryRole={person.primary_role}
            trapperType={person.trapper_type}
            doNotContact={person.do_not_contact}
            entityType={person.entity_type}
            catCount={person.cat_count}
          />
          {person.account_type && person.account_type !== "person" && !person.entity_type && (
            <span className="badge" style={{ fontSize: "0.7em", background: "#6c757d" }}>
              {person.account_type}
            </span>
          )}
          {person.is_canonical === false && (
            <span
              className="badge"
              style={{ fontSize: "0.7em", background: "#dc3545" }}
              title="Non-canonical record (organization, placeholder, or garbage name)"
            >
              Non-canonical
            </span>
          )}
        </div>
      );
    },
  },
  {
    id: "confidence",
    header: "Confidence",
    cell: ({ row }) => {
      const person = row.original;
      if (person.surface_quality === "High") {
        return <span className="badge badge-primary" title={person.quality_reason || undefined}>High</span>;
      }
      if (person.surface_quality === "Medium") {
        return <span className="badge" title={person.quality_reason || undefined} style={{ background: "#ffc107", color: "#000" }}>Medium</span>;
      }
      return <span className="badge" title={person.quality_reason || undefined} style={{ background: "#dc3545" }}>Low</span>;
    },
  },
  {
    id: "contact",
    header: "Contact",
    cell: ({ row }) => {
      const person = row.original;
      if (person.has_email && person.has_phone) {
        return <span title="Has email and phone">Email / Phone</span>;
      }
      if (person.has_email) return <span title="Has email">Email</span>;
      if (person.has_phone) return <span title="Has phone">Phone</span>;
      return <span className="text-muted">&mdash;</span>;
    },
  },
  {
    id: "cats",
    header: "Cats",
    cell: ({ row }) => {
      const person = row.original;
      if (person.cat_count > 0) {
        return <span title={person.cat_names || ""}>{person.cat_count}</span>;
      }
      return <span className="text-muted">0</span>;
    },
  },
  {
    id: "places",
    header: "Places",
    cell: ({ row }) => {
      const person = row.original;
      if (person.place_count > 0) return <span>{person.place_count}</span>;
      return <span className="text-muted">0</span>;
    },
  },
  {
    id: "last_active",
    header: "Last Active",
    cell: ({ row }) => {
      const person = row.original;
      if (person.last_appointment_date) {
        return <span title={person.last_appointment_date}>{formatRelativeTime(person.last_appointment_date)}</span>;
      }
      return <span className="text-muted">&mdash;</span>;
    },
  },
];

function PeoplePageContent() {
  const router = useRouter();
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { pageIndex, pageSize, sortKey, sortDir, handlePaginationChange, handleSortChange, apiParams } =
    useDataTable(filters, setFilters, { defaultPageSize: 25 });

  const [searchInput, setSearchInput] = useState(filters.q);

  const { items: people, total, loading, error, refetch: refetchPeople } = useListData<Person>({
    endpoint: "/api/people",
    filters,
    apiParams,
    buildParams: buildPeopleParams,
    dataKey: "people",
  });

  // Panel preview
  const { detail: selectedDetail, loading: detailLoading } = useEntityDetail(
    filters.selected ? "person" : null,
    filters.selected || null,
  );

  // Sync search input on external clear
  useEffect(() => {
    if (filters.q !== searchInput) setSearchInput(filters.q);
  }, [filters.q]);

  const handleRowClick = (personId: string) => {
    setFilter("selected", filters.selected === personId ? "" : personId);
  };

  const panelContent = filters.selected && selectedDetail && !detailLoading ? (
    <PersonPreviewContent
      person={selectedDetail as PersonDetail}
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
      <PageHeader
        title="People"
        actions={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setShowCreateModal(true)}>
            New Person
          </Button>
        }
      />

      <CreatePersonModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(personId) => {
          setShowCreateModal(false);
          router.push(`/people/${personId}`);
        }}
      />

      <FilterBar showClear={!isDefault} onClear={clearFilters}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(v) => setFilters({ q: v, page: "0" })}
          placeholder="Search by name..."
        />
        <FilterDivider />
        <ToggleButtonGroup
          options={DEEP_SEARCH_OPTIONS}
          value={filters.deep}
          onChange={(v) => setFilters({ deep: v, page: "0" })}
          aria-label="Search depth"
        />
      </FilterBar>

      <ActiveFilterTags
        filters={filters}
        defaults={FILTER_DEFAULTS}
        labels={{ deep: "Search Mode" }}
        valueLabels={{ deep: { true: "Deep Search" } }}
        exclude={["q", "page", "pageSize", "sortDir", "selected"]}
        onRemove={(key) => setFilter(key as keyof typeof FILTER_DEFAULTS, FILTER_DEFAULTS[key as keyof typeof FILTER_DEFAULTS])}
        onClearAll={clearFilters}
      />

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      <DataTable<Person>
        columns={personColumns}
        data={people}
        getRowId={(row) => row.person_id}
        total={total}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPaginationChange={handlePaginationChange}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        selectedRowId={filters.selected}
        onRowClick={handleRowClick}
        getRowStyle={(row) => row.surface_quality === "Low" ? { opacity: 0.7 } : undefined}
        loading={loading}
        hasActiveFilters={!isDefault}
        onClearFilters={clearFilters}
        aria-label="People"
        renderCard={(person, { isSelected, onClick }) => (
          <a
            href={`/people/${person.person_id}`}
            style={{
              display: "block",
              textDecoration: "none",
              color: "inherit",
              background: isSelected ? "var(--info-bg, #eff6ff)" : "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.75rem",
              opacity: person.surface_quality === "Low" ? 0.7 : 1,
            }}
            onClick={(e) => {
              e.preventDefault();
              onClick();
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{person.display_name}</div>
              {person.surface_quality === "High" ? (
                <span className="badge badge-primary" style={{ fontSize: "0.7em" }}>High</span>
              ) : person.surface_quality === "Medium" ? (
                <span className="badge" style={{ fontSize: "0.7em", background: "#ffc107", color: "#000" }}>Med</span>
              ) : (
                <span className="badge" style={{ fontSize: "0.7em", background: "#dc3545" }}>Low</span>
              )}
            </div>
            {(person.do_not_contact || person.primary_role || person.entity_type) && (
              <div style={{ marginTop: "4px" }}>
                <PersonStatusBadges
                  primaryRole={person.primary_role}
                  trapperType={person.trapper_type}
                  doNotContact={person.do_not_contact}
                  entityType={person.entity_type}
                  catCount={person.cat_count}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              <span>
                {person.has_email && "Email"}{person.has_email && person.has_phone && " / "}{person.has_phone && "Phone"}
                {!person.has_email && !person.has_phone && "No contact"}
              </span>
              <span>{person.cat_count} cats</span>
              <span>{person.place_count} places</span>
              {person.last_appointment_date && (
                <span>Last: {formatRelativeTime(person.last_appointment_date)}</span>
              )}
            </div>
            {person.primary_place && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{person.primary_place}</div>
            )}
          </a>
        )}
      />
    </ListDetailLayout>
  );
}

export default function PeoplePage() {
  return (
    <Suspense fallback={<div className="loading">Loading people...</div>}>
      <PeoplePageContent />
    </Suspense>
  );
}
