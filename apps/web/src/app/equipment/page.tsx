"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { DataTable } from "@/components/data-table";
import { useDataTable } from "@/components/data-table/useDataTable";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { StatCard } from "@/components/ui/StatCard";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { EquipmentPreviewContent } from "@/components/preview/EquipmentPreviewContent";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS, EQUIPMENT_CONDITION_OPTIONS, EQUIPMENT_CATEGORY_OPTIONS, EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow, EquipmentStatsRow } from "@/lib/types/view-contracts";
import { getCustodyStyle, getConditionStyle, getCategoryStyle } from "@/lib/equipment-styles";
import { Button } from "@/components/ui/Button";

export default function EquipmentPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem", color: "var(--muted)" }}>Loading equipment...</div>}>
      <EquipmentPageContent />
    </Suspense>
  );
}

function formatMinutesAgo(mins: number | null): string {
  if (mins == null) return "unknown";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function EquipmentPageContent() {
  const { success, error: showError } = useToast();
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters({
    search: "",
    category: "",
    custody_status: "",
    condition_status: "",
    functional_status: "",
    type_key: "",
    selected: "",
  });

  const { pageIndex, pageSize, sortKey, sortDir, handlePaginationChange, handleSortChange, apiParams } = useDataTable(
    filters,
    setFilters,
    { defaultSort: "display_name", defaultSortDir: "asc" }
  );

  const [equipment, setEquipment] = useState<VEquipmentInventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<EquipmentStatsRow | null>(null);
  const [types, setTypes] = useState<Array<{ type_key: string; display_name: string; category: string }>>([]);
  const [syncStatus, setSyncStatus] = useState<{
    last_sync_at: string | null;
    minutes_ago: number | null;
    is_stale: boolean;
    total_equipment: number;
  } | null>(null);

  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.equipment_id === filters.selected) || null,
    [equipment, filters.selected]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.category) params.set("category", filters.category);
      if (filters.custody_status) params.set("custody_status", filters.custody_status);
      if (filters.condition_status) params.set("condition_status", filters.condition_status);
      if (filters.functional_status) params.set("functional_status", filters.functional_status);
      if (filters.type_key) params.set("type_key", filters.type_key);
      params.set("limit", String(apiParams.limit));
      params.set("offset", String(apiParams.offset));
      params.set("sort", apiParams.sort);
      params.set("sortDir", apiParams.sortDir);

      const data = await fetchApi<{ equipment: VEquipmentInventoryRow[] }>(
        `/api/equipment?${params}`
      );
      setEquipment(data.equipment || []);
      // Total comes from meta
      const raw = await fetch(`/api/equipment?${params}`).then(r => r.json());
      setTotal(raw.meta?.total || data.equipment?.length || 0);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load equipment");
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.category, filters.custody_status, filters.condition_status, filters.functional_status, filters.type_key, apiParams, showError]);

  // Fetch stats, types, and sync status once
  useEffect(() => {
    fetchApi<EquipmentStatsRow>("/api/equipment/stats").then(setStats).catch(() => {});
    fetchApi<{ types: Array<{ type_key: string; display_name: string; category: string }> }>("/api/equipment/types")
      .then((d) => setTypes(d.types || []))
      .catch(() => {});
    fetchApi<{ last_sync_at: string | null; minutes_ago: number | null; is_stale: boolean; total_equipment: number }>(
      "/api/equipment/sync-status"
    ).then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleQuickAction = useCallback(async (equipmentId: string, action: string) => {
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, { event_type: action });
      success(`${action.replace(/_/g, " ")} recorded`);
      fetchData();
      fetchApi<EquipmentStatsRow>("/api/equipment/stats").then(setStats).catch(() => {});
    } catch (err) {
      showError(err instanceof Error ? err.message : "Action failed");
    }
  }, [fetchData, success, showError]);

  const columns = useMemo<ColumnDef<VEquipmentInventoryRow, unknown>[]>(() => [
    {
      id: "photo",
      header: "",
      cell: ({ row }) => {
        const url = row.original.photo_url;
        return (
          <div style={{
            width: 40,
            height: 40,
            borderRadius: "6px",
            overflow: "hidden",
            background: "var(--muted-bg, #f3f4f6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>—</span>
            )}
          </div>
        );
      },
      meta: { minWidth: "48px", hideOnMobile: true },
    },
    {
      accessorKey: "barcode",
      header: "Barcode",
      cell: ({ row }) => (
        <span style={{ fontFamily: "monospace", fontWeight: 500 }}>{row.original.barcode || "—"}</span>
      ),
      meta: { sortKey: "barcode", minWidth: "80px" },
    },
    {
      accessorKey: "display_name",
      header: "Name",
      meta: { sortKey: "display_name", minWidth: "150px" },
    },
    {
      accessorKey: "type_display_name",
      header: "Type",
      cell: ({ row }) => {
        const item = row.original;
        const typeName = item.type_display_name || item.legacy_type;
        const catStyle = getCategoryStyle(item.type_category || "");
        return (
          <div>
            <span style={{
              fontSize: "0.75rem",
              padding: "0.125rem 0.5rem",
              borderRadius: "4px",
              background: catStyle.bg,
              color: catStyle.text,
              fontWeight: 500,
            }}>
              {typeName}
            </span>
            {item.size && (
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                {item.size}
              </div>
            )}
          </div>
        );
      },
      meta: { sortKey: "type_display_name", hideOnMobile: true },
    },
    {
      accessorKey: "condition_status",
      header: "Condition",
      cell: ({ row }) => {
        const val = row.original.condition_status;
        const style = getConditionStyle(val);
        return (
          <span style={{
            fontSize: "0.75rem",
            padding: "0.125rem 0.5rem",
            borderRadius: "4px",
            background: style.bg,
            color: style.text,
            fontWeight: 500,
          }}>
            {getLabel(EQUIPMENT_CONDITION_OPTIONS, val)}
          </span>
        );
      },
      meta: { sortKey: "condition_status", hideOnMobile: true },
    },
    {
      accessorKey: "custody_status",
      header: "Status",
      cell: ({ row }) => {
        const val = row.original.custody_status;
        const style = getCustodyStyle(val);
        return (
          <span style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: style.text,
          }}>
            {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, val)}
          </span>
        );
      },
      meta: { sortKey: "custody_status" },
    },
    {
      accessorKey: "custodian_name",
      header: "Custodian",
      cell: ({ row }) => row.original.custodian_name || "—",
      meta: { sortKey: "custodian_name", hideOnMobile: true },
    },
    {
      accessorKey: "days_checked_out",
      header: "Days Out",
      cell: ({ row }) => {
        const val = row.original.days_checked_out;
        if (val == null) return "—";
        return (
          <span style={{ fontWeight: 500, color: val > 14 ? "var(--danger-text)" : undefined }}>
            {val}
          </span>
        );
      },
      meta: { sortKey: "days_checked_out", align: "center", hideOnMobile: true },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const item = row.original;
        const actions = [];
        if (item.custody_status === "available") {
          actions.push({ label: "Check Out", onClick: () => handleQuickAction(item.equipment_id, "check_out") });
        }
        if (item.custody_status === "checked_out") {
          actions.push({ label: "Check In", onClick: () => handleQuickAction(item.equipment_id, "check_in") });
        }
        if (item.custody_status !== "missing") {
          actions.push({ label: "Report Missing", onClick: () => handleQuickAction(item.equipment_id, "reported_missing"), variant: "danger" as const, dividerBefore: true });
        }
        return <RowActionMenu actions={actions} />;
      },
    },
  ], [handleQuickAction]);

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Equipment Inventory</h1>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
            {total} items{stats ? ` — ${stats.available} available, ${stats.checked_out} out` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          icon="scan-barcode"
          onClick={() => window.open("/kiosk/equipment/scan", "_blank")}
          title="iPad-optimized checkout/check-in interface"
        >
          Kiosk Mode
        </Button>
      </div>

      {/* Sync status bar */}
      {syncStatus && syncStatus.last_sync_at && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.375rem 0.75rem",
          marginBottom: "0.75rem",
          borderRadius: "6px",
          fontSize: "0.8rem",
          background: syncStatus.is_stale ? "var(--warning-bg)" : "var(--info-bg)",
          color: syncStatus.is_stale ? "var(--warning-text)" : "var(--info-text)",
          border: `1px solid ${syncStatus.is_stale ? "var(--warning-border)" : "var(--info-border)"}`,
        }}>
          {syncStatus.is_stale
            ? `Sync delayed (${formatMinutesAgo(syncStatus.minutes_ago)})`
            : `Airtable Sync: ${formatMinutesAgo(syncStatus.minutes_ago)} \u00B7 ${syncStatus.total_equipment} items`
          }
        </div>
      )}

      {/* Stats Row */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Available" value={stats.available} valueColor="var(--success-text)" />
          <StatCard label="Checked Out" value={stats.checked_out} valueColor="var(--warning-text)" />
          <StatCard label="Maintenance" value={stats.in_maintenance} valueColor="var(--info-text)" />
          <StatCard label="Missing" value={stats.missing} valueColor="var(--danger-text)" />
          {stats.needs_repair > 0 && <StatCard label="Needs Repair" value={stats.needs_repair} valueColor="var(--warning-text)" />}
          {stats.overdue > 0 && <StatCard label="Overdue" value={stats.overdue} valueColor="var(--danger-text)" accentColor="var(--danger-text)" />}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search barcode, name, custodian..."
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", minWidth: "200px" }}
        />
        <select
          value={filters.category}
          onChange={(e) => setFilter("category", e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Categories</option>
          {EQUIPMENT_CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filters.custody_status}
          onChange={(e) => setFilter("custody_status", e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Status</option>
          {EQUIPMENT_CUSTODY_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filters.functional_status}
          onChange={(e) => setFilter("functional_status", e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Functional</option>
          {EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filters.type_key}
          onChange={(e) => setFilter("type_key", e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Types</option>
          {types.map((t) => (
            <option key={t.type_key} value={t.type_key}>{t.display_name}</option>
          ))}
        </select>
        {!isDefault && (
          <button
            onClick={clearFilters}
            style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}
          >
            Clear
          </button>
        )}
      </div>

      <ListDetailLayout
        isDetailOpen={!!filters.selected}
        onDetailClose={() => setFilter("selected", "")}
        detailPanel={
          selectedEquipment ? (
            <EquipmentPreviewContent
              equipment={selectedEquipment}
              onClose={() => setFilter("selected", "")}
            />
          ) : null
        }
      >
        <DataTable
          columns={columns}
          data={equipment}
          getRowId={(row) => row.equipment_id}
          total={total}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPaginationChange={handlePaginationChange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          selectedRowId={filters.selected || undefined}
          onRowClick={(id) => setFilter("selected", id)}
          loading={loading}
          hasActiveFilters={!isDefault}
          onClearFilters={clearFilters}
          aria-label="Equipment inventory"
        />
      </ListDetailLayout>
    </div>
  );
}
