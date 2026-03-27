"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { TrapperTierBadge } from "@/components/badges/TrapperBadge";
import { formatPhone, formatRelativeTime, getActivityColor } from "@/lib/formatters";
import { generateCsv, downloadCsv } from "@/lib/csv-export";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { TrapperPreviewContent } from "@/components/preview/TrapperPreviewContent";
import { EditTrapperDrawer } from "@/components/trappers/EditTrapperDrawer";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { FilterBar, SearchInput, ToggleButtonGroup, FilterDivider } from "@/components/filters";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";

interface AssignedRequest {
  request_id: string;
  address: string;
  status: string;
}

interface Trapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
  role_status: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  felv_positive_rate_pct: number | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
  email: string | null;
  phone: string | null;
  tier: string | null;
  has_signed_contract: boolean;
  availability_status: string;
  contract_signed_date: string | null;
  profile_created_at: string | null;
  assigned_request_summaries: AssignedRequest[] | null;
}

interface AggregateStats {
  total_active_trappers: number;
  ffsc_trappers: number;
  community_trappers: number;
  inactive_trappers: number;
  all_clinic_cats: number;
  all_clinic_days: number;
  avg_cats_per_day_all: number;
  felv_positive_rate_pct_all: number | null;
  all_site_visits: number;
  first_visit_success_rate_pct_all: number | null;
  all_cats_caught: number;
  available_trappers?: number;
  busy_trappers?: number;
  on_leave_trappers?: number;
}

interface TrappersResponse {
  trappers: Trapper[];
  aggregates: AggregateStats;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}


function ContactInfo({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return <span style={{ color: "var(--text-tertiary)" }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      {phone && (
        <a
          href={`tel:${phone}`}
          style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {formatPhone(phone)}
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textDecoration: "none" }}
          title={email}
          onClick={(e) => e.stopPropagation()}
        >
          {email.length > 24 ? email.slice(0, 22) + "..." : email}
        </a>
      )}
    </div>
  );
}

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  on_leave: "On Leave",
};

const AVAILABILITY_STYLES: Record<string, { bg: string; color: string }> = {
  available: { bg: "var(--success-bg)", color: "var(--success-text)" },
  busy: { bg: "var(--warning-bg)", color: "var(--warning-text)" },
  on_leave: { bg: "var(--bg-secondary)", color: "var(--text-primary)" },
};

function AvailabilityBadge({
  status,
  onClick,
}: {
  status: string;
  onClick?: () => void;
}) {
  const style = AVAILABILITY_STYLES[status] || AVAILABILITY_STYLES.available;
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: style.bg,
        color: style.color,
        cursor: onClick ? "pointer" : "default",
      }}
      title={onClick ? "Click to change availability" : undefined}
    >
      {AVAILABILITY_LABELS[status] || status}
    </span>
  );
}

interface ConfirmAction {
  personId: string;
  personName: string;
  field: "type" | "status" | "availability";
  oldValue: string;
  newValue: string;
}

const FIELD_LABELS: Record<string, Record<string, string>> = {
  type: {
    coordinator: "Coordinator",
    head_trapper: "Head Trapper",
    ffsc_trapper: "FFSC Trapper",
    community_trapper: "Community",
  },
  status: {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
    revoked: "Revoked",
  },
  availability: AVAILABILITY_LABELS,
};

function ConfirmModal({
  action,
  onConfirm,
  onCancel,
}: {
  action: ConfirmAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fieldName = action.field === "type" ? "trapper type" : action.field === "status" ? "role status" : "availability";
  const labels = FIELD_LABELS[action.field] || {};
  const oldLabel = labels[action.oldValue] || action.oldValue;
  const newLabel = labels[action.newValue] || action.newValue;

  const isDangerous =
    (action.field === "status" && ["suspended", "revoked"].includes(action.newValue)) ||
    (action.field === "type" && action.oldValue.startsWith("ffsc") && !action.newValue.startsWith("ffsc"));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--background)",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "420px",
          width: "90%",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>
          {isDangerous ? "Warning" : "Confirm Change"}
        </h3>
        <p style={{ margin: "0 0 1rem", color: "var(--text-primary)", lineHeight: 1.5 }}>
          Change <strong>{action.personName}</strong>&apos;s {fieldName} from{" "}
          <span
            style={{
              padding: "0.1rem 0.4rem",
              borderRadius: "4px",
              background: "var(--bg-secondary)",
              fontWeight: 500,
            }}
          >
            {oldLabel}
          </span>{" "}
          to{" "}
          <span
            style={{
              padding: "0.1rem 0.4rem",
              borderRadius: "4px",
              background: isDangerous ? "var(--danger-bg)" : "var(--success-bg)",
              fontWeight: 500,
              color: isDangerous ? "var(--danger-text)" : "var(--success-text)",
            }}
          >
            {newLabel}
          </span>
          ?
        </p>
        {isDangerous && (
          <p
            style={{
              margin: "0 0 1rem",
              padding: "0.5rem 0.75rem",
              background: "var(--danger-bg)",
              borderRadius: "6px",
              fontSize: "0.85rem",
              color: "var(--danger-text)",
            }}
          >
            This action has significant implications for trapper permissions and attribution.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border-light)",
              background: "var(--card-bg)",
              color: "var(--foreground)",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "6px",
              border: "none",
              background: isDangerous ? "#dc2626" : "var(--primary, #2563eb)",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.875rem",
            }}
          >
            {isDangerous ? "Yes, Change" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActiveAssignmentsBadge({ count }: { count: number }) {
  const color = count === 0 ? "var(--success-text)" : count <= 2 ? "var(--warning-text)" : "var(--danger-text)";
  const bg = count === 0 ? "var(--success-bg)" : count <= 2 ? "var(--warning-bg)" : "var(--danger-bg)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "1.5rem",
        padding: "0.1rem 0.4rem",
        borderRadius: "10px",
        fontSize: "0.75rem",
        fontWeight: 600,
        color,
        background: bg,
      }}
    >
      {count}
    </span>
  );
}

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#059669", "#4f46e5", "#be185d"];

function AvatarInitials({ name, id, size = 40 }: { name: string; id: string; size?: number }) {
  const hash = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 600, fontSize: size * 0.4,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

const NEW_THRESHOLD_DAYS = 14;

function isNewTrapper(trapper: Trapper): boolean {
  const refDate = trapper.contract_signed_date || trapper.profile_created_at;
  if (!refDate) return false;
  const daysSince = Math.floor((Date.now() - new Date(refDate).getTime()) / 86400000);
  return daysSince <= NEW_THRESHOLD_DAYS;
}

function NewBadge() {
  return (
    <span style={{
      fontSize: "0.6rem",
      padding: "0.1rem 0.4rem",
      borderRadius: "9999px",
      background: "var(--info-bg)",
      color: "var(--info-text)",
      fontWeight: 600,
    }}>
      NEW
    </span>
  );
}

function getTierLabel(tier: string | null): string {
  if (!tier) return "";
  if (tier.startsWith("Tier 1")) return "FFSC Official";
  if (tier.startsWith("Tier 2")) return "Community";
  return "Legacy";
}

function TrapperCard({
  trapper,
  onClick,
  isSelected,
}: {
  trapper: Trapper;
  onClick: () => void;
  isSelected?: boolean;
}) {
  const isInactive = trapper.role_status !== "active";
  const isDormant = !isInactive && (!trapper.last_activity_date ||
    Math.floor((Date.now() - new Date(trapper.last_activity_date).getTime()) / 86400000) > DORMANT_DAYS);
  const relTime = formatRelativeTime(trapper.last_activity_date);
  const actColor = getActivityColor(trapper.last_activity_date);
  const isNew = isNewTrapper(trapper);
  const assignments = trapper.assigned_request_summaries || [];
  const shownAssignments = assignments.slice(0, 3);
  const extraCount = assignments.length - 3;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "1rem",
        border: `1px solid ${isSelected ? "var(--primary)" : isDormant ? "var(--warning-border)" : "var(--card-border)"}`,
        borderLeft: isSelected ? "3px solid var(--primary)" : undefined,
        borderRadius: "8px",
        cursor: "pointer",
        opacity: isInactive ? 0.6 : 1,
        background: isSelected ? "var(--info-bg)" : isInactive ? "var(--bg-secondary)" : isDormant ? "var(--warning-bg)" : "var(--card-bg)",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--primary)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--card-border)"; }}
    >
      {/* Row 1: Avatar + Name + Tier + Badges */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <AvatarInitials name={trapper.display_name} id={trapper.person_id} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
            <a
              href={`/trappers/${trapper.person_id}`}
              style={{
                fontWeight: 600,
                fontSize: "0.95rem",
                color: isInactive ? "var(--text-tertiary)" : "var(--foreground)",
                textDecoration: "none",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {trapper.display_name}
            </a>
            <TrapperTierBadge tier={trapper.tier} />
            {isNew && <NewBadge />}
            {isDormant && (
              <span style={{
                fontSize: "0.6rem",
                padding: "0.1rem 0.3rem",
                borderRadius: "3px",
                background: "var(--warning-bg)",
                color: "var(--warning-text)",
                fontWeight: 500,
              }}>
                DORMANT
              </span>
            )}
            {!isInactive && trapper.availability_status !== "available" && (
              <AvailabilityBadge status={trapper.availability_status} />
            )}
            {trapper.role_status !== "active" && (
              <span style={{
                fontSize: "0.65rem",
                padding: "0.1rem 0.35rem",
                borderRadius: "4px",
                background: "var(--warning-bg)",
                color: "var(--warning-text)",
                fontWeight: 500,
              }}>
                {trapper.role_status}
              </span>
            )}
          </div>
          <div style={{ marginTop: "0.15rem" }}>
            <ContactInfo phone={trapper.phone} email={trapper.email} />
          </div>
        </div>
      </div>

      {/* Row 2: Active assignments + Last activity */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" }}>
          <span style={{ color: "var(--text-secondary)" }}>Active:</span>
          <ActiveAssignmentsBadge count={trapper.active_assignments} />
        </div>
        {relTime && (
          <span style={{ fontSize: "0.75rem", color: actColor || "var(--text-tertiary)" }}>
            {relTime}
          </span>
        )}
      </div>

      {/* Row 3: Assigned request summaries */}
      {shownAssignments.length > 0 && (
        <div style={{ marginBottom: "0.35rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          {shownAssignments.map((req) => {
            const statusColor = req.status === "in_progress" ? "var(--primary, #2563eb)"
              : req.status === "scheduled" ? "#7c3aed"
              : "#6b7280";
            return (
              <div key={req.request_id} style={{
                display: "flex", alignItems: "center", gap: "0.35rem",
                fontSize: "0.72rem", color: "var(--text-secondary)",
                padding: "0.15rem 0.4rem",
                background: "var(--section-bg)", borderRadius: "4px",
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {req.address.length > 40 ? req.address.slice(0, 38) + "..." : req.address}
                </span>
                <span style={{
                  fontSize: "0.6rem", padding: "0.05rem 0.3rem", borderRadius: "9999px",
                  background: statusColor + "18", color: statusColor, fontWeight: 500,
                }}>
                  {req.status.replace("_", " ")}
                </span>
              </div>
            );
          })}
          {extraCount > 0 && (
            <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", paddingLeft: "0.4rem" }}>
              +{extraCount} more
            </span>
          )}
        </div>
      )}

      {/* Row 4: Stats */}
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem", color: "var(--text-secondary)", alignItems: "center" }}>
        <span>
          <strong style={{ color: trapper.total_cats_caught > 0 ? "var(--success-text)" : "var(--text-tertiary)" }}>
            {trapper.total_cats_caught}
          </strong>{" "}
          cats fixed
        </span>
        {trapper.completed_assignments > 0 && (
          <span>{trapper.completed_assignments} completed</span>
        )}
        {trapper.has_signed_contract && (
          <span style={{ color: "var(--success-text)" }} title="Contract signed">{"\u2713"} Contract</span>
        )}
      </div>
    </div>
  );
}

const FILTER_DEFAULTS = {
  tier: "all",
  availability: "all",
  active: "true",
  dormant: "false",
  sort: "tier_sort",
  search: "",
  view: "cards",
  page: "0",
  selected: "",
};

const DORMANT_DAYS = 90;

function TrappersPageInner() {
  const { addToast } = useToast();
  const { filters, setFilter, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const router = useRouter();

  const [data, setData] = useState<TrappersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [searchInput, setSearchInput] = useState(filters.search);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<{
    field: "status" | "availability";
    value: string;
  } | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);

  // Preview panel + edit drawer state
  const [editDrawerTrapper, setEditDrawerTrapper] = useState<Trapper | null>(null);
  const selectedTrapper = data?.trappers.find((t) => t.person_id === filters.selected) || null;

  const selectTrapper = (id: string) => {
    setFilter("selected", filters.selected === id ? "" : id);
  };

  const limit = 25;
  const page = parseInt(filters.page) || 0;

  const fetchTrappers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.tier !== "all") params.set("tier", filters.tier);
    if (filters.active === "true") params.set("active", "true");
    params.set("sort", filters.sort);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));
    if (filters.search) params.set("search", filters.search);

    try {
      const result = await fetchApi<TrappersResponse>(`/api/trappers?${params.toString()}`);
      // Client-side filters (not in API to keep it simple)
      if (filters.availability !== "all") {
        result.trappers = result.trappers.filter(
          (t) => t.availability_status === filters.availability
        );
      }
      if (filters.dormant === "true") {
        result.trappers = result.trappers.filter((t) => {
          if (!t.last_activity_date) return true;
          const daysSince = Math.floor((Date.now() - new Date(t.last_activity_date).getTime()) / 86400000);
          return daysSince > DORMANT_DAYS;
        });
      }
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.tier, filters.active, filters.availability, filters.dormant, filters.sort, filters.search, page]);

  useEffect(() => {
    fetchTrappers();
  }, [fetchTrappers]);

  // Sync searchInput when URL filter changes externally
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  const requestChange = (
    trapper: Trapper,
    field: "type" | "status" | "availability",
    newValue: string
  ) => {
    const oldValue =
      field === "type" ? trapper.trapper_type
        : field === "status" ? trapper.role_status
        : trapper.availability_status;
    if (newValue === oldValue) return;
    setConfirmAction({
      personId: trapper.person_id,
      personName: trapper.display_name,
      field,
      oldValue,
      newValue,
    });
  };

  const executeChange = async () => {
    if (!confirmAction) return;
    setUpdating(confirmAction.personId);
    setConfirmAction(null);
    try {
      await postApi(
        "/api/trappers",
        { person_id: confirmAction.personId, action: confirmAction.field, value: confirmAction.newValue },
        { method: "PATCH" }
      );
      fetchTrappers();
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setUpdating(null);
    }
  };

  // Selection helpers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    if (selectedIds.size === data.trappers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.trappers.map((t) => t.person_id)));
    }
  };

  // Clear selection when data changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [data]);

  const executeBatchAction = async () => {
    if (!batchAction || selectedIds.size === 0) return;
    setBatchUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((personId) =>
        postApi(
          "/api/trappers",
          { person_id: personId, action: batchAction.field, value: batchAction.value },
          { method: "PATCH" }
        )
      );
      await Promise.all(promises);
      setBatchAction(null);
      setSelectedIds(new Set());
      fetchTrappers();
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Batch update failed" });
    } finally {
      setBatchUpdating(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const trappers = selectedIds.size > 0
      ? data.trappers.filter((t) => selectedIds.has(t.person_id))
      : data.trappers;

    const headers = [
      "Name", "Email", "Phone", "Type", "Tier", "Status", "Availability",
      "Cats Fixed", "Active Assignments", "Completed", "Last Activity",
    ];
    const rows = trappers.map((t) => [
      t.display_name,
      t.email,
      t.phone ? formatPhone(t.phone) : "",
      t.trapper_type,
      getTierLabel(t.tier) || t.tier || "",
      t.role_status,
      t.availability_status,
      t.total_cats_caught,
      t.active_assignments,
      t.completed_assignments,
      t.last_activity_date || "",
    ]);

    const csv = generateCsv(headers, rows);
    const date = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `trappers-${date}.csv`);
  };

  const getTrapperActions = (trapper: Trapper) => [
    { label: "View Profile", onClick: () => router.push(`/trappers/${trapper.person_id}`) },
    { label: "Edit", onClick: () => setEditDrawerTrapper(trapper) },
    ...(trapper.email ? [{ label: "Copy Email", onClick: () => navigator.clipboard.writeText(trapper.email!) }] : []),
    ...(trapper.phone ? [{ label: "Copy Phone", onClick: () => navigator.clipboard.writeText(trapper.phone!) }] : []),
    { label: "Set Available", onClick: () => requestChange(trapper, "availability", "available"), dividerBefore: true },
    { label: "Set Busy", onClick: () => requestChange(trapper, "availability", "busy") },
    { label: "Set On Leave", onClick: () => requestChange(trapper, "availability", "on_leave") },
  ];

  const agg = data?.aggregates;

  const pageContent = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Trappers</h1>
        <a
          href="https://form.jotform.com/260715379111151"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "#198754",
            color: "#fff",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          + New Community Trapper Agreement
        </a>
      </div>

      {/* Workload Dashboard — FFS-533 */}
      {agg && (
        <>
          {/* Row 1: Capacity overview */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <StatCard
              label="Active Trappers"
              value={agg.total_active_trappers}
              subtitle={`${agg.ffsc_trappers} FFSC, ${agg.community_trappers} Community`}
            />
            <StatCard
              label="Available"
              value={agg.available_trappers ?? agg.total_active_trappers}
              subtitle="ready for assignments"
            />
            <StatCard
              label="Busy"
              value={agg.busy_trappers ?? 0}
              subtitle="currently working"
            />
            <StatCard
              label="On Leave"
              value={agg.on_leave_trappers ?? 0}
              subtitle="temporarily unavailable"
            />
            <StatCard label="Inactive" value={agg.inactive_trappers} />
          </div>

          {/* Row 2: Workload distribution (computed from current page data) */}
          {data && data.trappers.length > 0 && (() => {
            const active = data.trappers.filter(t => t.role_status === "active");
            const overloaded = active.filter(t => t.active_assignments >= 3);
            const moderate = active.filter(t => t.active_assignments > 0 && t.active_assignments < 3);
            const free = active.filter(t => t.active_assignments === 0 && t.availability_status === "available");
            const noActivity90d = active.filter(t => {
              if (!t.last_activity_date) return true;
              const daysSince = Math.floor((Date.now() - new Date(t.last_activity_date).getTime()) / 86400000);
              return daysSince > 90;
            });

            return (
              <div style={{
                display: "flex",
                gap: "1.5rem",
                padding: "0.75rem 1rem",
                background: "var(--section-bg)",
                borderRadius: "8px",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                flexWrap: "wrap",
              }}>
                <span>
                  <strong style={{ color: "#16a34a" }}>{free.length}</strong>{" "}
                  <span style={{ color: "var(--text-secondary)" }}>free for assignment</span>
                </span>
                <span>
                  <strong style={{ color: "#f59e0b" }}>{moderate.length}</strong>{" "}
                  <span style={{ color: "var(--text-secondary)" }}>1-2 active</span>
                </span>
                <span>
                  <strong style={{ color: "#dc2626" }}>{overloaded.length}</strong>{" "}
                  <span style={{ color: "var(--text-secondary)" }}>3+ active (heavy load)</span>
                </span>
                {noActivity90d.length > 0 && (
                  <span>
                    <strong style={{ color: "var(--text-tertiary)" }}>{noActivity90d.length}</strong>{" "}
                    <span style={{ color: "var(--text-tertiary)" }}>no activity 90d+</span>
                  </span>
                )}
              </div>
            );
          })()}

          {/* Row 3: Performance stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <StatCard
              label="Cats Fixed"
              value={agg.all_cats_caught}
              subtitle="via request assignments"
            />
          </div>
        </>
      )}

      {/* Filter Bar */}
      <FilterBar>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(v) => setFilters({ search: v, page: "0" })}
          placeholder="Search by name..."
          size="sm"
        />
        <FilterDivider />
        {/* Tier Chips */}
        <ToggleButtonGroup
          options={[
            { value: "all", label: "All" },
            { value: "1", label: "FFSC Official", color: "#198754" },
            { value: "2", label: "Community", color: "#fd7e14" },
            { value: "3", label: "Legacy", color: "#6c757d" },
          ]}
          value={filters.tier}
          onChange={(v) => setFilters({ tier: v || "all", page: "0" })}
          allowDeselect
          defaultValue="all"
          size="sm"
          aria-label="Filter by tier"
        />
        <FilterDivider />
        {/* Availability Chips */}
        <ToggleButtonGroup
          options={[
            { value: "all", label: "All Status" },
            { value: "available", label: "Available" },
            { value: "busy", label: "Busy" },
            { value: "on_leave", label: "On Leave" },
          ]}
          value={filters.availability}
          onChange={(v) => setFilters({ availability: v || "all", page: "0" })}
          allowDeselect
          defaultValue="all"
          size="sm"
          aria-label="Filter by availability"
        />
        <FilterDivider />
        {/* Toggle Chips */}
        <ToggleButtonGroup
          options={[{ value: "true", label: "Active only" }]}
          value={filters.active}
          onChange={(v) => setFilters({ active: v || "false", page: "0" })}
          allowDeselect
          defaultValue="false"
          size="sm"
        />
        <ToggleButtonGroup
          options={[{ value: "true", label: "Dormant" }]}
          value={filters.dormant}
          onChange={(v) => setFilters({ dormant: v || "false", page: "0" })}
          allowDeselect
          defaultValue="false"
          size="sm"
        />
        <FilterDivider />
        {/* Sort */}
        <select
          value={filters.sort}
          onChange={(e) => setFilters({ sort: e.target.value, page: "0" })}
          style={{
            padding: "0.3rem 0.5rem",
            fontSize: "0.75rem",
            borderRadius: "9999px",
            border: "1px solid var(--border, #e5e7eb)",
            background: "var(--card-bg, #fff)",
            color: "var(--text-primary, #111827)",
            cursor: "pointer",
          }}
        >
          <option value="tier_sort">Tier</option>
          <option value="total_cats_caught">Cats Fixed</option>
          <option value="active_assignments">Active Assignments</option>
          <option value="completed_assignments">Completed</option>
          <option value="display_name">Name</option>
          <option value="last_activity_date">Last Activity</option>
        </select>
        {/* View Toggle */}
        <div style={{ display: "flex", gap: "2px", marginLeft: "auto", flexShrink: 0 }}>
          {([
            { key: "cards", label: "Cards" },
            { key: "table", label: "Table" },
          ] as const).map((v, i, arr) => (
            <button
              key={v.key}
              onClick={() => setFilter("view", v.key)}
              style={{
                padding: "0.25rem 0.6rem",
                fontSize: "0.75rem",
                border: "1px solid var(--card-border, #e5e7eb)",
                borderLeft: i > 0 ? "none" : undefined,
                borderRadius:
                  i === 0
                    ? "16px 0 0 16px"
                    : i === arr.length - 1
                      ? "0 16px 16px 0"
                      : "0",
                background: filters.view === v.key ? "var(--foreground)" : "transparent",
                color: filters.view === v.key ? "var(--background)" : "inherit",
                cursor: "pointer",
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </FilterBar>

      {/* Batch Toolbar + CSV Export */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}>
        {selectedIds.size > 0 && (
          <>
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
              {selectedIds.size} selected
            </span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  const [field, value] = e.target.value.split(":");
                  setBatchAction({ field: field as "status" | "availability", value });
                }
                e.target.value = "";
              }}
              style={{
                padding: "0.3rem 0.5rem",
                fontSize: "0.8rem",
                border: "1px solid var(--border-light)",
                borderRadius: "4px",
              }}
            >
              <option value="">Batch Change...</option>
              <optgroup label="Status">
                <option value="status:active">Set Active</option>
                <option value="status:inactive">Set Inactive</option>
              </optgroup>
              <optgroup label="Availability">
                <option value="availability:available">Set Available</option>
                <option value="availability:busy">Set Busy</option>
                <option value="availability:on_leave">Set On Leave</option>
              </optgroup>
            </select>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                background: "transparent",
                border: "1px solid var(--border-light)",
                borderRadius: "4px",
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
            >
              Clear
            </button>
            <div style={{ borderLeft: "1px solid var(--border-light)", height: "1.5rem", margin: "0 0.25rem" }} />
          </>
        )}
        <button
          onClick={exportCsv}
          disabled={!data || data.trappers.length === 0}
          style={{
            padding: "0.3rem 0.75rem",
            fontSize: "0.8rem",
            background: "transparent",
            border: "1px solid var(--border-light)",
            borderRadius: "4px",
            cursor: data && data.trappers.length > 0 ? "pointer" : "not-allowed",
            opacity: data && data.trappers.length > 0 ? 1 : 0.5,
            marginLeft: selectedIds.size > 0 ? "0" : "auto",
          }}
        >
          Export CSV{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
        </button>
      </div>

      {/* Batch Confirm Modal */}
      {batchAction && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setBatchAction(null)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "420px",
              width: "90%",
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>
              Batch Change — {selectedIds.size} Trappers
            </h3>
            <p style={{ margin: "0 0 1rem", color: "var(--text-primary)", lineHeight: 1.5 }}>
              Set <strong>{batchAction.field}</strong> to{" "}
              <span style={{
                padding: "0.1rem 0.4rem",
                borderRadius: "4px",
                background: "var(--success-bg)",
                fontWeight: 500,
                color: "var(--success-text)",
              }}>
                {(FIELD_LABELS[batchAction.field] || {})[batchAction.value] || batchAction.value}
              </span>
              {" "}for {selectedIds.size} selected trapper{selectedIds.size > 1 ? "s" : ""}?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                onClick={() => setBatchAction(null)}
                disabled={batchUpdating}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border-light)",
                  background: "var(--card-bg)",
                  color: "var(--foreground)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Cancel
              </button>
              <button
                onClick={executeBatchAction}
                disabled={batchUpdating}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--primary, #2563eb)",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "0.875rem",
                }}
              >
                {batchUpdating ? "Updating..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <ConfirmModal
          action={confirmAction}
          onConfirm={executeChange}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {loading && <div className="loading">Loading trappers...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          {data.trappers.length === 0 ? (
            <div className="empty">No trappers found.</div>
          ) : filters.view === "cards" ? (
            /* Card View */
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {data.trappers.map((trapper) => (
                <div key={trapper.person_id} style={{ position: "relative" }}>
                  <TrapperCard
                    trapper={trapper}
                    onClick={() => selectTrapper(trapper.person_id)}
                    isSelected={filters.selected === trapper.person_id}
                  />
                  <div style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}>
                    <RowActionMenu actions={getTrapperActions(trapper)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Table View */
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: "2rem", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={data.trappers.length > 0 && selectedIds.size === data.trappers.length}
                      onChange={toggleSelectAll}
                      title="Select all"
                    />
                  </th>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Tier</th>
                  <th style={{ textAlign: "center" }}>Contract</th>
                  <th>Availability</th>
                  <th style={{ textAlign: "right" }}>
                    <span title="Cats at request locations this trapper was assigned to">
                      Cats Fixed
                    </span>
                  </th>
                  <th style={{ textAlign: "right" }}>Active</th>
                  <th style={{ textAlign: "right" }}>Completed</th>
                  <th>Last Activity</th>
                  <th style={{ width: "2.5rem" }}></th>
                </tr>
              </thead>
              <tbody>
                {data.trappers.map((trapper) => {
                  const isInactive = trapper.role_status !== "active";
                  const isDormant = !isInactive && (!trapper.last_activity_date ||
                    Math.floor((Date.now() - new Date(trapper.last_activity_date).getTime()) / 86400000) > DORMANT_DAYS);
                  const isSelected = filters.selected === trapper.person_id;
                  const rowStyle: React.CSSProperties = isSelected
                    ? { background: "var(--info-bg)", borderLeft: "3px solid var(--primary)" }
                    : isInactive
                    ? { opacity: 0.6, background: "var(--bg-secondary)" }
                    : isDormant
                    ? { background: "var(--warning-bg)" }
                    : {};
                  const relTime = formatRelativeTime(trapper.last_activity_date);
                  const actColor = getActivityColor(trapper.last_activity_date);

                  return (
                    <tr
                      key={trapper.person_id}
                      style={{ ...rowStyle, cursor: "pointer" }}
                      onClick={() => selectTrapper(trapper.person_id)}
                    >
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(trapper.person_id)}
                          onChange={() => toggleSelection(trapper.person_id)}
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <AvatarInitials name={trapper.display_name} id={trapper.person_id} size={28} />
                          <div>
                            <a
                              href={`/trappers/${trapper.person_id}`}
                              style={{
                                fontWeight: 500,
                                color: isInactive ? "var(--text-tertiary)" : "var(--foreground)",
                                textDecoration: "none",
                              }}
                              onClick={(e) => {
                                if (!e.metaKey && !e.ctrlKey) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  selectTrapper(trapper.person_id);
                                }
                              }}
                            >
                              {trapper.display_name}
                            </a>
                            {isNewTrapper(trapper) && (
                              <span style={{ marginLeft: "0.35rem", verticalAlign: "middle" }}><NewBadge /></span>
                            )}
                            {isDormant && (
                              <span
                                title={`No activity in ${DORMANT_DAYS}+ days`}
                                style={{
                                  fontSize: "0.6rem",
                                  padding: "0.1rem 0.3rem",
                                  borderRadius: "3px",
                                  background: "var(--warning-bg)",
                                  color: "var(--warning-text)",
                                  fontWeight: 500,
                                  marginLeft: "0.35rem",
                                  verticalAlign: "middle",
                                }}
                              >
                                DORMANT
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <ContactInfo phone={trapper.phone} email={trapper.email} />
                      </td>
                      <td>
                        <select
                          value={trapper.trapper_type}
                          onChange={(e) => requestChange(trapper, "type", e.target.value)}
                          disabled={updating === trapper.person_id}
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border-light)",
                            background: isInactive ? "var(--bg-secondary)" : "var(--input-bg)",
                            color: "var(--foreground)",
                          }}
                        >
                          <option value="coordinator">Coordinator</option>
                          <option value="head_trapper">Head Trapper</option>
                          <option value="ffsc_trapper">FFSC Trapper</option>
                          <option value="community_trapper">Community</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={trapper.role_status}
                          onChange={(e) => requestChange(trapper, "status", e.target.value)}
                          disabled={updating === trapper.person_id}
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border-light)",
                            background: isInactive ? "var(--warning-bg)" : "var(--success-bg)",
                            color: isInactive ? "var(--warning-text)" : "var(--success-text)",
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="suspended">Suspended</option>
                          <option value="revoked">Revoked</option>
                        </select>
                      </td>
                      <td>
                        {trapper.tier ? (
                          <TrapperTierBadge tier={trapper.tier} />
                        ) : (
                          <span style={{ color: "var(--text-tertiary)", fontSize: "0.8rem" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {trapper.has_signed_contract ? (
                          <span style={{ color: "#16a34a", fontSize: "1.1rem" }} title="Contract signed">{"\u2713"}</span>
                        ) : (
                          <span style={{ color: "var(--border-light)" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={trapper.availability_status}
                          onChange={(e) => requestChange(trapper, "availability", e.target.value)}
                          disabled={updating === trapper.person_id || isInactive}
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border-light)",
                            background: AVAILABILITY_STYLES[trapper.availability_status]?.bg || "var(--input-bg)",
                            color: AVAILABILITY_STYLES[trapper.availability_status]?.color || "var(--foreground)",
                          }}
                        >
                          <option value="available">Available</option>
                          <option value="busy">Busy</option>
                          <option value="on_leave">On Leave</option>
                        </select>
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontWeight: 600,
                          color:
                            trapper.total_cats_caught > 0
                              ? "var(--success-text)"
                              : "var(--text-tertiary)",
                        }}
                      >
                        {trapper.total_cats_caught}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            trapper.active_assignments > 0
                              ? "#fd7e14"
                              : "var(--text-tertiary)",
                        }}
                      >
                        {trapper.active_assignments}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.completed_assignments}
                      </td>
                      <td style={{ fontSize: "0.875rem" }}>
                        {relTime ? (
                          <span style={{ color: actColor || "var(--text-secondary)" }}>{relTime}</span>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu actions={getTrapperActions(trapper)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          <Pagination
            offset={page * limit}
            limit={limit}
            hasMore={data.pagination.hasMore}
            onPrevious={() => setFilter("page", String(Math.max(0, page - 1)))}
            onNext={() => setFilter("page", String(page + 1))}
          />
        </>
      )}
    </div>
  );

  return (
    <>
      <ListDetailLayout
        detailPanel={
          selectedTrapper ? (
            <TrapperPreviewContent
              trapper={selectedTrapper}
              onClose={() => setFilter("selected", "")}
              onEdit={() => setEditDrawerTrapper(selectedTrapper)}
            />
          ) : null
        }
        isDetailOpen={!!selectedTrapper}
        onDetailClose={() => setFilter("selected", "")}
      >
        {pageContent}
      </ListDetailLayout>

      {/* Edit Drawer */}
      {editDrawerTrapper && (
        <EditTrapperDrawer
          isOpen={!!editDrawerTrapper}
          onClose={() => setEditDrawerTrapper(null)}
          trapper={editDrawerTrapper}
          onSaved={fetchTrappers}
        />
      )}
    </>
  );
}

export default function TrappersPage() {
  return (
    <Suspense fallback={<div className="loading">Loading trappers...</div>}>
      <TrappersPageInner />
    </Suspense>
  );
}
