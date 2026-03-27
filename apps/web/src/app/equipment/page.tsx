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
import { Icon } from "@/components/ui/Icon";

// Category → fallback icon for items without photos
const CATEGORY_ICONS: Record<string, string> = {
  trap: "target",
  cage: "package-plus",
  camera: "camera",
  accessory: "wrench",
};

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

// ---------------------------------------------------------------------------
// Filter pill: compact dropdown that looks like a chip when active
// ---------------------------------------------------------------------------
function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string; [key: string]: unknown }>;
  onChange: (v: string) => void;
}) {
  const isActive = !!value;
  const activeLabel = options.find((o) => o.value === value)?.label;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "0.25rem 0.5rem",
        fontSize: "0.8rem",
        borderRadius: "20px",
        border: isActive ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: isActive ? "var(--primary-bg, rgba(59,130,246,0.08))" : "var(--card-bg, #fff)",
        color: isActive ? "var(--primary, #3b82f6)" : "var(--text-secondary)",
        fontWeight: isActive ? 600 : 400,
        cursor: "pointer",
        outline: "none",
        appearance: "none",
        WebkitAppearance: "none",
        paddingRight: "1.25rem",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.4rem center",
        backgroundSize: "8px",
      }}
      title={isActive ? `${label}: ${activeLabel}` : label}
    >
      <option value="">{label}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Grouped table view — mimics Airtable's grouped-by-type layout
// ---------------------------------------------------------------------------

const EQUIPMENT_STYLES = `
  .eq-row { transition: background-color 0.15s ease, transform 0.1s ease; }
  .eq-row:hover { background-color: var(--muted-bg, #f9fafb); transform: translateX(2px); }
  .eq-row[data-selected="true"] { background-color: var(--primary-bg, rgba(59,130,246,0.06)); border-left: 3px solid var(--primary, #3b82f6); }
  .eq-row[data-selected="true"]:hover { background-color: var(--primary-bg, rgba(59,130,246,0.1)); }
  .eq-group-header { position: sticky; top: 0; z-index: 2; }
  .eq-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 6px; position: relative; flex-shrink: 0; }
  .eq-dot--pulse::before {
    content: ""; position: absolute; top: 50%; left: 50%; width: 100%; height: 100%;
    background: inherit; border-radius: 50%; transform: translate(-50%, -50%);
    animation: eq-pulse 2s infinite ease-out;
  }
  @keyframes eq-pulse {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
    100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .eq-dot--pulse::before { animation: none; } }
`;

function StatusDot({ status, dueDate }: { status: string; dueDate?: string | null }) {
  const isOverdue = dueDate && new Date(dueDate) < new Date();
  const needsPulse = status === "missing" || isOverdue;
  const color = status === "missing" ? "var(--danger-text)"
    : isOverdue ? "var(--danger-text)"
    : status === "checked_out" ? "var(--warning-text)"
    : status === "available" ? "var(--success-text)"
    : "var(--muted)";

  return (
    <span
      className={`eq-dot${needsPulse ? " eq-dot--pulse" : ""}`}
      style={{ background: color }}
    />
  );
}

function GroupedEquipmentView({
  equipment,
  selectedId,
  onSelect,
  onAction,
}: {
  equipment: VEquipmentInventoryRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAction: (equipmentId: string, action: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, { items: VEquipmentInventoryRow[]; category: string }>();
    for (const item of equipment) {
      const key = item.type_display_name || item.legacy_type || "Other";
      if (!map.has(key)) map.set(key, { items: [], category: item.type_category || "" });
      map.get(key)!.items.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "Other") return 1;
      if (b[0] === "Other") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [equipment]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (groups.length === 0) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>No equipment found</div>;
  }

  return (
    <>
      <style>{EQUIPMENT_STYLES}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {groups.map(([typeName, { items, category }]) => {
          const isCollapsed = collapsed.has(typeName);
          const catStyle = getCategoryStyle(category);
          const availCount = items.filter((i) => i.custody_status === "available").length;
          const outCount = items.filter((i) => i.custody_status === "checked_out" || i.custody_status === "in_field").length;
          return (
            <div key={typeName}>
              {/* Group header — sticky, with category color strip */}
              <button
                className="eq-group-header"
                onClick={() => toggleGroup(typeName)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  border: "none",
                  borderLeft: `4px solid ${catStyle.text}`,
                  background: "var(--card-bg, #fff)",
                  borderBottom: "1px solid var(--border-light, #f0f0f0)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{
                  fontSize: "0.65rem",
                  color: "var(--muted)",
                  transition: "transform 0.15s",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  lineHeight: 1,
                }}>
                  &#9660;
                </span>
                <span style={{
                  fontSize: "0.8rem",
                  padding: "0.125rem 0.5rem",
                  borderRadius: "4px",
                  background: catStyle.bg,
                  color: catStyle.text,
                  fontWeight: 600,
                }}>
                  {typeName}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>
                  {items.length}
                </span>
                {/* Inline availability summary */}
                <span style={{ fontSize: "0.7rem", color: "var(--muted)", marginLeft: "auto" }}>
                  {availCount > 0 && <span style={{ color: "var(--success-text)" }}>{availCount} avail</span>}
                  {availCount > 0 && outCount > 0 && <span> · </span>}
                  {outCount > 0 && <span style={{ color: "var(--warning-text)" }}>{outCount} out</span>}
                </span>
              </button>

              {/* Items table */}
              {!isCollapsed && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <tbody>
                    {items.map((item) => {
                      const custodyStyle = getCustodyStyle(item.custody_status);
                      const isSelected = item.equipment_id === selectedId;
                      const isOut = item.custody_status === "checked_out" || item.custody_status === "in_field";
                      const dueDate = item.current_due_date || item.expected_return_date;
                      const isOverdue = dueDate && new Date(dueDate) < new Date();
                      const fallbackIcon = CATEGORY_ICONS[item.type_category || ""] || "wrench";
                      return (
                        <tr
                          key={item.equipment_id}
                          className="eq-row"
                          data-selected={isSelected || undefined}
                          onClick={() => onSelect(item.equipment_id)}
                          style={{
                            cursor: "pointer",
                            borderBottom: "1px solid var(--border-light, #f0f0f0)",
                            borderLeft: isOverdue
                              ? "3px solid var(--danger-text)"
                              : isSelected
                                ? undefined // handled by data-selected CSS
                                : "3px solid transparent",
                          }}
                        >
                          {/* Photo */}
                          <td style={{ width: 44, padding: "0.375rem 0.5rem" }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: "4px", overflow: "hidden",
                              background: "var(--muted-bg, #f3f4f6)", border: "1px solid var(--border-light, #e5e7eb)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {item.photo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <Icon name={fallbackIcon} size={16} color="var(--muted)" />
                              )}
                            </div>
                          </td>
                          {/* Name */}
                          <td style={{ padding: "0.375rem 0.5rem", fontWeight: 500 }}>
                            {item.display_name}
                          </td>
                          {/* Barcode */}
                          <td style={{ padding: "0.375rem 0.5rem", fontFamily: "monospace", color: "var(--muted)", fontSize: "0.8rem" }}>
                            {item.barcode || "—"}
                          </td>
                          {/* Status with dot */}
                          <td style={{ padding: "0.375rem 0.5rem" }}>
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <StatusDot status={item.custody_status} dueDate={dueDate} />
                              <span style={{
                                fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
                                background: custodyStyle.bg, color: custodyStyle.text, fontWeight: 600,
                              }}>
                                {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, item.custody_status)}
                              </span>
                            </span>
                          </td>
                          {/* Functional status */}
                          <td style={{ padding: "0.375rem 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                            {item.functional_status && item.functional_status !== "functional" ? (
                              <span style={{
                                fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
                                background: "var(--warning-bg)", color: "var(--warning-text)", fontWeight: 500,
                              }}>
                                {getLabel(EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS, item.functional_status)}
                              </span>
                            ) : "—"}
                          </td>
                          {/* Custodian */}
                          <td style={{ padding: "0.375rem 0.5rem", fontSize: "0.8rem", color: isOut ? "var(--text-primary)" : "var(--muted)" }}>
                            {item.custodian_name || item.current_holder_name || "—"}
                          </td>
                          {/* Due date */}
                          <td style={{
                            padding: "0.375rem 0.5rem", fontSize: "0.8rem",
                            color: isOverdue ? "var(--danger-text)" : "var(--muted)",
                            fontWeight: isOverdue ? 600 : 400,
                          }}>
                            {dueDate
                              ? new Date(dueDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
                              : "—"
                            }
                          </td>
                          {/* Actions */}
                          <td style={{ padding: "0.375rem 0.25rem", width: 36 }} onClick={(e) => e.stopPropagation()}>
                            <RowActionMenu actions={[
                              ...(item.custody_status === "available" ? [{ label: "Check Out", onClick: () => onAction(item.equipment_id, "check_out") }] : []),
                              ...(item.custody_status === "checked_out" ? [{ label: "Check In", onClick: () => onAction(item.equipment_id, "check_in") }] : []),
                              ...(item.custody_status !== "missing" ? [{ label: "Report Missing", onClick: () => onAction(item.equipment_id, "reported_missing"), variant: "danger" as const, dividerBefore: true }] : []),
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
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
    { defaultSort: "type_display_name", defaultSortDir: "asc", defaultPageSize: 50 }
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

  // Show grouped view when no search is active
  const isSearching = !!filters.search;

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
      const raw = await fetch(`/api/equipment?${params}`).then(r => r.json());
      setTotal(raw.meta?.total || data.equipment?.length || 0);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load equipment");
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.category, filters.custody_status, filters.condition_status, filters.functional_status, filters.type_key, apiParams, showError]);

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

  // DataTable columns (flat view for search mode)
  const columns = useMemo<ColumnDef<VEquipmentInventoryRow, unknown>[]>(() => [
    {
      id: "photo",
      header: "",
      cell: ({ row }) => {
        const url = row.original.photo_url;
        return (
          <div style={{
            width: 36, height: 36, borderRadius: "4px", overflow: "hidden",
            background: "var(--muted-bg, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>—</span>
            )}
          </div>
        );
      },
      meta: { minWidth: "44px", hideOnMobile: true },
    },
    {
      accessorKey: "display_name",
      header: "Name",
      meta: { sortKey: "display_name", minWidth: "140px" },
    },
    {
      accessorKey: "barcode",
      header: "Barcode",
      cell: ({ row }) => (
        <span style={{ fontFamily: "monospace", fontWeight: 500, fontSize: "0.85rem" }}>{row.original.barcode || "—"}</span>
      ),
      meta: { sortKey: "barcode", minWidth: "70px" },
    },
    {
      accessorKey: "type_display_name",
      header: "Type",
      cell: ({ row }) => {
        const item = row.original;
        const typeName = item.type_display_name || item.legacy_type;
        const catStyle = getCategoryStyle(item.type_category || "");
        return (
          <span style={{
            fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
            background: catStyle.bg, color: catStyle.text, fontWeight: 500,
          }}>
            {typeName}
          </span>
        );
      },
      meta: { sortKey: "type_display_name" },
    },
    {
      accessorKey: "custody_status",
      header: "Status",
      cell: ({ row }) => {
        const val = row.original.custody_status;
        const style = getCustodyStyle(val);
        return (
          <span style={{
            fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
            background: style.bg, color: style.text, fontWeight: 600,
          }}>
            {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, val)}
          </span>
        );
      },
      meta: { sortKey: "custody_status" },
    },
    {
      accessorKey: "custodian_name",
      header: "Holder",
      cell: ({ row }) => row.original.custodian_name || row.original.current_holder_name || "—",
      meta: { sortKey: "custodian_name", hideOnMobile: true },
    },
    {
      id: "due_date",
      header: "Due",
      cell: ({ row }) => {
        const d = row.original.current_due_date || row.original.expected_return_date;
        if (!d) return "—";
        return new Date(d).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
      },
      meta: { hideOnMobile: true },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const item = row.original;
        return (
          <RowActionMenu actions={[
            ...(item.custody_status === "available" ? [{ label: "Check Out", onClick: () => handleQuickAction(item.equipment_id, "check_out") }] : []),
            ...(item.custody_status === "checked_out" ? [{ label: "Check In", onClick: () => handleQuickAction(item.equipment_id, "check_in") }] : []),
            ...(item.custody_status !== "missing" ? [{ label: "Report Missing", onClick: () => handleQuickAction(item.equipment_id, "reported_missing"), variant: "danger" as const, dividerBefore: true }] : []),
          ]} />
        );
      },
    },
  ], [handleQuickAction]);

  const hasActiveFilters = filters.category || filters.custody_status || filters.condition_status || filters.functional_status || filters.type_key;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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

      {/* Sync status */}
      {syncStatus && syncStatus.last_sync_at && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.375rem",
          padding: "0.25rem 0.625rem", marginBottom: "0.75rem", borderRadius: "20px",
          fontSize: "0.75rem",
          background: syncStatus.is_stale ? "var(--warning-bg)" : "var(--muted-bg, #f3f4f6)",
          color: syncStatus.is_stale ? "var(--warning-text)" : "var(--muted)",
        }}>
          {syncStatus.is_stale
            ? `Sync delayed (${formatMinutesAgo(syncStatus.minutes_ago)})`
            : `Synced ${formatMinutesAgo(syncStatus.minutes_ago)}`
          }
        </div>
      )}

      {/* Stats — compact row */}
      {stats && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <MiniStat label="Available" value={stats.available} color="var(--success-text)" />
          <MiniStat label="Out" value={stats.checked_out} color="var(--warning-text)" />
          {stats.missing > 0 && <MiniStat label="Missing" value={stats.missing} color="var(--danger-text)" />}
          {stats.needs_repair > 0 && <MiniStat label="Needs Repair" value={stats.needs_repair} color="var(--warning-text)" />}
          {stats.overdue > 0 && <MiniStat label="Overdue" value={stats.overdue} color="var(--danger-text)" />}
        </div>
      )}

      {/* Compact filter bar */}
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search..."
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          style={{
            padding: "0.25rem 0.625rem", fontSize: "0.8rem", borderRadius: "20px",
            border: "1px solid var(--border)", width: "160px", outline: "none",
          }}
        />
        <FilterPill label="Type" value={filters.type_key} options={types.map((t) => ({ value: t.type_key, label: t.display_name }))} onChange={(v) => setFilter("type_key", v)} />
        <FilterPill label="Status" value={filters.custody_status} options={EQUIPMENT_CUSTODY_STATUS_OPTIONS} onChange={(v) => setFilter("custody_status", v)} />
        <FilterPill label="Category" value={filters.category} options={EQUIPMENT_CATEGORY_OPTIONS} onChange={(v) => setFilter("category", v)} />
        <FilterPill label="Functional" value={filters.functional_status} options={EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS} onChange={(v) => setFilter("functional_status", v)} />
        {(hasActiveFilters || filters.search) && (
          <button
            onClick={clearFilters}
            style={{
              padding: "0.25rem 0.5rem", fontSize: "0.75rem", borderRadius: "20px",
              background: "transparent", border: "1px solid var(--border)", cursor: "pointer",
              color: "var(--muted)",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Main content */}
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
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
        ) : isSearching ? (
          /* Flat DataTable when searching */
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
            pageSizeOptions={[25, 50, 100]}
            aria-label="Equipment search results"
          />
        ) : (
          /* Grouped view — default */
          <>
            <GroupedEquipmentView
              equipment={equipment}
              selectedId={filters.selected}
              onSelect={(id) => setFilter("selected", id)}
              onAction={handleQuickAction}
            />
            {total > equipment.length && (
              <div style={{ padding: "0.75rem", textAlign: "center", fontSize: "0.8rem", color: "var(--muted)" }}>
                Showing {equipment.length} of {total} — use search or filters to narrow results
              </div>
            )}
          </>
        )}
      </ListDetailLayout>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini stat pill
// ---------------------------------------------------------------------------
function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem",
      fontSize: "0.8rem", color: "var(--muted)",
    }}>
      <span style={{ fontWeight: 700, color, fontSize: "0.9rem" }}>{value}</span>
      {label}
    </span>
  );
}
