"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { TrapperBadge } from "@/components/badges/TrapperBadge";
import { formatPhone, formatRelativeTime, getActivityColor } from "@/lib/formatters";

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

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "1rem",
        background: "#f8f9fa",
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "1.75rem", fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#666" }}>{label}</div>
      {sublabel && (
        <div style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.25rem" }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

function ContactInfo({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return <span style={{ color: "#999" }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      {phone && (
        <a
          href={`tel:${phone}`}
          style={{ fontSize: "0.8rem", color: "#0d6efd", textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {formatPhone(phone)}
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          style={{ fontSize: "0.75rem", color: "#6c757d", textDecoration: "none" }}
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
  available: { bg: "#d1fae5", color: "#065f46" },
  busy: { bg: "#fef3c7", color: "#92400e" },
  on_leave: { bg: "#e5e7eb", color: "#374151" },
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
          background: "#fff",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "420px",
          width: "90%",
          boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>
          {isDangerous ? "Warning" : "Confirm Change"}
        </h3>
        <p style={{ margin: "0 0 1rem", color: "#374151", lineHeight: 1.5 }}>
          Change <strong>{action.personName}</strong>&apos;s {fieldName} from{" "}
          <span
            style={{
              padding: "0.1rem 0.4rem",
              borderRadius: "4px",
              background: "#f3f4f6",
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
              background: isDangerous ? "#fef2f2" : "#ecfdf5",
              fontWeight: 500,
              color: isDangerous ? "#991b1b" : "#065f46",
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
              background: "#fef2f2",
              borderRadius: "6px",
              fontSize: "0.85rem",
              color: "#991b1b",
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
              border: "1px solid #d1d5db",
              background: "#fff",
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
              background: isDangerous ? "#dc2626" : "#2563eb",
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
  const color = count === 0 ? "#198754" : count <= 2 ? "#fd7e14" : "#dc3545";
  const bg = count === 0 ? "#d1fae5" : count <= 2 ? "#fff3cd" : "#f8d7da";
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

function TrapperCard({
  trapper,
  onClick,
}: {
  trapper: Trapper;
  onClick: () => void;
}) {
  const isInactive = trapper.role_status !== "active";
  const isDormant = !isInactive && (!trapper.last_activity_date ||
    Math.floor((Date.now() - new Date(trapper.last_activity_date).getTime()) / 86400000) > DORMANT_DAYS);
  const relTime = formatRelativeTime(trapper.last_activity_date);
  const actColor = getActivityColor(trapper.last_activity_date);

  return (
    <div
      onClick={onClick}
      style={{
        padding: "1rem",
        border: `1px solid ${isDormant ? "#fbbf24" : "var(--card-border, #e5e7eb)"}`,
        borderRadius: "8px",
        cursor: "pointer",
        opacity: isInactive ? 0.6 : 1,
        background: isInactive ? "#f9fafb" : isDormant ? "#fffbeb" : "var(--card-bg, #fff)",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#0d6efd")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--card-border, #e5e7eb)")}
    >
      {/* Row 1: Name + Badge + Status */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <a
          href={`/trappers/${trapper.person_id}`}
          style={{
            fontWeight: 600,
            fontSize: "0.95rem",
            color: isInactive ? "#9ca3af" : "var(--foreground)",
            textDecoration: "none",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {trapper.display_name}
        </a>
        <TrapperBadge trapperType={trapper.trapper_type} size="sm" inactive={isInactive} />
        {isDormant && (
          <span style={{
            fontSize: "0.6rem",
            padding: "0.1rem 0.3rem",
            borderRadius: "3px",
            background: "#fef3c7",
            color: "#92400e",
            fontWeight: 500,
          }}>
            DORMANT
          </span>
        )}
        {!isInactive && trapper.availability_status !== "available" && (
          <AvailabilityBadge status={trapper.availability_status} />
        )}
        {trapper.role_status !== "active" && (
          <span
            style={{
              fontSize: "0.65rem",
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
              background: "#fef3c7",
              color: "#92400e",
              fontWeight: 500,
            }}
          >
            {trapper.role_status}
          </span>
        )}
      </div>

      {/* Row 2: Contact */}
      <div style={{ marginBottom: "0.5rem" }}>
        <ContactInfo phone={trapper.phone} email={trapper.email} />
      </div>

      {/* Row 3: Active assignments + Last activity */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" }}>
          <span style={{ color: "#666" }}>Active:</span>
          <ActiveAssignmentsBadge count={trapper.active_assignments} />
        </div>
        {relTime && (
          <span style={{ fontSize: "0.75rem", color: actColor || "#999" }}>
            {relTime}
          </span>
        )}
      </div>

      {/* Row 4: Stats */}
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem", color: "#666" }}>
        <span>
          <strong style={{ color: trapper.total_cats_caught > 0 ? "#198754" : "#999" }}>
            {trapper.total_cats_caught}
          </strong>{" "}
          caught
        </span>
        <span>{trapper.completed_assignments} completed</span>
      </div>
    </div>
  );
}

const FILTER_DEFAULTS = {
  type: "all",
  tier: "all",
  availability: "all",
  active: "true",
  dormant: "false",
  sort: "total_cats_caught",
  search: "",
  view: "table",
  page: "0",
};

const DORMANT_DAYS = 90;

function TrappersPageInner() {
  const { filters, setFilter, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const router = useRouter();

  const [data, setData] = useState<TrappersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [searchInput, setSearchInput] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limit = 25;
  const page = parseInt(filters.page) || 0;

  const fetchTrappers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.type !== "all") params.set("type", filters.type);
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
  }, [filters.type, filters.tier, filters.active, filters.availability, filters.dormant, filters.sort, filters.search, page]);

  useEffect(() => {
    fetchTrappers();
  }, [fetchTrappers]);

  // Sync searchInput when URL filter changes externally
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilters({ search: value, page: "0" });
    }, 300);
  };

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
      alert(`Error: ${err instanceof Error ? err.message : "Update failed"}`);
    } finally {
      setUpdating(null);
    }
  };

  const agg = data?.aggregates;

  return (
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
              sublabel={`${agg.ffsc_trappers} FFSC, ${agg.community_trappers} Community`}
            />
            <StatCard
              label="Available"
              value={agg.available_trappers ?? agg.total_active_trappers}
              sublabel="ready for assignments"
            />
            <StatCard
              label="Busy"
              value={agg.busy_trappers ?? 0}
              sublabel="currently working"
            />
            <StatCard
              label="On Leave"
              value={agg.on_leave_trappers ?? 0}
              sublabel="temporarily unavailable"
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
                background: "#f8f9fa",
                borderRadius: "8px",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                flexWrap: "wrap",
              }}>
                <span>
                  <strong style={{ color: "#16a34a" }}>{free.length}</strong>{" "}
                  <span style={{ color: "#666" }}>free for assignment</span>
                </span>
                <span>
                  <strong style={{ color: "#f59e0b" }}>{moderate.length}</strong>{" "}
                  <span style={{ color: "#666" }}>1-2 active</span>
                </span>
                <span>
                  <strong style={{ color: "#dc2626" }}>{overloaded.length}</strong>{" "}
                  <span style={{ color: "#666" }}>3+ active (heavy load)</span>
                </span>
                {noActivity90d.length > 0 && (
                  <span>
                    <strong style={{ color: "#9ca3af" }}>{noActivity90d.length}</strong>{" "}
                    <span style={{ color: "#999" }}>no activity 90d+</span>
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
              label="Total Cats Caught"
              value={agg.all_cats_caught}
              sublabel="via request assignments"
            />
            <StatCard
              label="Direct Bookings"
              value={agg.all_clinic_cats}
              sublabel="self-booked appointments"
            />
            <StatCard label="Clinic Days" value={agg.all_clinic_days} />
            <StatCard
              label="Avg Cats/Day"
              value={agg.avg_cats_per_day_all || "\u2014"}
            />
            <StatCard
              label="FeLV Rate"
              value={
                agg.felv_positive_rate_pct_all !== null
                  ? `${agg.felv_positive_rate_pct_all}%`
                  : "\u2014"
              }
            />
          </div>
        </>
      )}

      {/* Filters + Search + View Toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <select
          value={filters.type}
          onChange={(e) => setFilters({ type: e.target.value, page: "0" })}
        >
          <option value="all">All Trappers</option>
          <option value="ffsc">FFSC Trappers</option>
          <option value="community">Community Trappers</option>
        </select>

        <select
          value={filters.tier}
          onChange={(e) => setFilters({ tier: e.target.value, page: "0" })}
        >
          <option value="all">All Tiers</option>
          <option value="1">Tier 1: FFSC</option>
          <option value="2">Tier 2: Contract</option>
          <option value="3">Tier 3: Informal</option>
        </select>

        <select
          value={filters.availability}
          onChange={(e) => setFilters({ availability: e.target.value, page: "0" })}
        >
          <option value="all">All Availability</option>
          <option value="available">Available</option>
          <option value="busy">Busy</option>
          <option value="on_leave">On Leave</option>
        </select>

        <label style={{
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.8rem",
          cursor: "pointer",
          userSelect: "none",
        }}>
          <input
            type="checkbox"
            checked={filters.active === "true"}
            onChange={(e) => setFilters({ active: e.target.checked ? "true" : "false", page: "0" })}
          />
          Active only
        </label>

        <label style={{
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.8rem",
          cursor: "pointer",
          userSelect: "none",
          color: filters.dormant === "true" ? "#dc2626" : "inherit",
        }}>
          <input
            type="checkbox"
            checked={filters.dormant === "true"}
            onChange={(e) => setFilters({ dormant: e.target.checked ? "true" : "false", page: "0" })}
          />
          Dormant (90d+)
        </label>

        <select
          value={filters.sort}
          onChange={(e) => setFilters({ sort: e.target.value, page: "0" })}
        >
          <option value="total_cats_caught">Sort by Total Caught</option>
          <option value="total_clinic_cats">Sort by Direct Bookings</option>
          <option value="active_assignments">Sort by Active Assignments</option>
          <option value="completed_assignments">Sort by Completed</option>
          <option value="avg_cats_per_day">Sort by Avg Cats/Day</option>
          <option value="display_name">Sort by Name</option>
          <option value="last_activity_date">Sort by Last Activity</option>
        </select>

        <input
          type="text"
          placeholder="Search by name..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            padding: "0.35rem 0.75rem",
            border: "1px solid #ddd",
            borderRadius: "6px",
            fontSize: "0.875rem",
            minWidth: "180px",
          }}
        />

        {/* View Toggle */}
        <div style={{ display: "flex", gap: "2px", marginLeft: "auto", flexShrink: 0 }}>
          {([
            { key: "table", label: "Table" },
            { key: "cards", label: "Cards" },
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
      </div>

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
                <TrapperCard
                  key={trapper.person_id}
                  trapper={trapper}
                  onClick={() => router.push(`/trappers/${trapper.person_id}`)}
                />
              ))}
            </div>
          ) : (
            /* Table View */
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Tier</th>
                  <th style={{ textAlign: "center" }}>Contract</th>
                  <th>Availability</th>
                  <th style={{ textAlign: "right" }}>
                    <span title="Cats attributed via request assignments - the primary performance metric">
                      Total Caught
                    </span>
                  </th>
                  <th style={{ textAlign: "right" }}>
                    <span title="Appointments booked directly under trapper's email">
                      Direct
                    </span>
                  </th>
                  <th style={{ textAlign: "right" }}>Clinic Days</th>
                  <th style={{ textAlign: "right" }}>Cats/Day</th>
                  <th style={{ textAlign: "right" }}>Active</th>
                  <th style={{ textAlign: "right" }}>Completed</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.trappers.map((trapper) => {
                  const isInactive = trapper.role_status !== "active";
                  const isDormant = !isInactive && (!trapper.last_activity_date ||
                    Math.floor((Date.now() - new Date(trapper.last_activity_date).getTime()) / 86400000) > DORMANT_DAYS);
                  const rowStyle = isInactive
                    ? { opacity: 0.6, background: "#f9fafb" }
                    : isDormant
                    ? { background: "#fffbeb" }
                    : {};
                  const relTime = formatRelativeTime(trapper.last_activity_date);
                  const actColor = getActivityColor(trapper.last_activity_date);

                  return (
                    <tr key={trapper.person_id} style={rowStyle}>
                      <td>
                        <a
                          href={`/trappers/${trapper.person_id}`}
                          style={{
                            fontWeight: 500,
                            color: isInactive ? "#9ca3af" : "var(--foreground)",
                            textDecoration: "none",
                          }}
                        >
                          {trapper.display_name}
                        </a>
                        {isDormant && (
                          <span
                            title={`No activity in ${DORMANT_DAYS}+ days`}
                            style={{
                              fontSize: "0.6rem",
                              padding: "0.1rem 0.3rem",
                              borderRadius: "3px",
                              background: "#fef3c7",
                              color: "#92400e",
                              fontWeight: 500,
                              marginLeft: "0.35rem",
                              verticalAlign: "middle",
                            }}
                          >
                            DORMANT
                          </span>
                        )}
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
                            border: "1px solid #ddd",
                            background: isInactive ? "#e5e7eb" : "#fff",
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
                            border: "1px solid #ddd",
                            background: isInactive ? "#fef3c7" : "#d1fae5",
                            color: isInactive ? "#92400e" : "#065f46",
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
                          <span style={{
                            display: "inline-block",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            background: trapper.tier.startsWith("Tier 1") ? "#dcfce7"
                              : trapper.tier.startsWith("Tier 2") ? "#fef3c7"
                              : "#f3f4f6",
                            color: trapper.tier.startsWith("Tier 1") ? "#166534"
                              : trapper.tier.startsWith("Tier 2") ? "#92400e"
                              : "#6b7280",
                          }}>
                            {trapper.tier.startsWith("Tier 1") ? "Tier 1"
                              : trapper.tier.startsWith("Tier 2") ? "Tier 2"
                              : "Tier 3"}
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {trapper.has_signed_contract ? (
                          <span style={{ color: "#16a34a", fontSize: "1.1rem" }} title="Contract signed">{"\u2713"}</span>
                        ) : (
                          <span style={{ color: "#d1d5db" }}>{"\u2014"}</span>
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
                            border: "1px solid #ddd",
                            background: AVAILABILITY_STYLES[trapper.availability_status]?.bg || "#fff",
                            color: AVAILABILITY_STYLES[trapper.availability_status]?.color || "#333",
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
                              ? "#198754"
                              : "#999",
                        }}
                      >
                        {trapper.total_cats_caught}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: "#6c757d",
                          fontSize: "0.9em",
                        }}
                        title="Appointments booked directly under their email"
                      >
                        {trapper.total_clinic_cats}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.unique_clinic_days}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.avg_cats_per_day}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            trapper.active_assignments > 0
                              ? "#fd7e14"
                              : "#999",
                        }}
                      >
                        {trapper.active_assignments}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.completed_assignments}
                      </td>
                      <td style={{ fontSize: "0.875rem" }}>
                        {relTime ? (
                          <span style={{ color: actColor || "#666" }}>{relTime}</span>
                        ) : (
                          <span style={{ color: "#999" }}>{"\u2014"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              marginTop: "1.5rem",
            }}
          >
            <button
              onClick={() => setFilter("page", String(Math.max(0, page - 1)))}
              disabled={page === 0}
            >
              Previous
            </button>
            <span style={{ display: "flex", alignItems: "center", color: "#666" }}>
              Page {page + 1}
            </span>
            <button
              onClick={() => setFilter("page", String(page + 1))}
              disabled={!data.pagination.hasMore}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function TrappersPage() {
  return (
    <Suspense fallback={<div className="loading">Loading trappers...</div>}>
      <TrappersPageInner />
    </Suspense>
  );
}
