"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { TabBar } from "@/components/ui/TabBar";
import { Icon } from "@/components/ui/Icon";
import { getLabel, EQUIPMENT_EVENT_TYPE_OPTIONS, EQUIPMENT_CHECKOUT_TYPE_OPTIONS } from "@/lib/form-options";
import { getEventStyle, getCategoryStyle } from "@/lib/equipment-styles";
import type { EquipmentActivityRow } from "@/lib/types/view-contracts";
import Link from "next/link";

// FilterPill — compact dropdown chip (same pattern as equipment/page.tsx)
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
      title={label}
    >
      <option value="">{label}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

const TIME_TABS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "all", label: "All" },
];

export default function ActivityPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonTable rows={10} columns={4} /></div>}>
      <ActivityPageContent />
    </Suspense>
  );
}

function ActivityPageContent() {
  const { error: showError } = useToast();
  const { filters, setFilter, clearFilters } = useUrlFilters({
    since: "today",
    event_type: "",
    checkout_type: "",
  });

  const [events, setEvents] = useState<EquipmentActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.since) params.set("since", filters.since);
      if (filters.event_type) params.set("event_type", filters.event_type);
      if (filters.checkout_type) params.set("checkout_type", filters.checkout_type);
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));

      const raw = await fetch(`/api/equipment/activity?${params}`).then((r) => r.json());
      const data = raw.data || raw;
      setEvents(data.events || []);
      setTotal(raw.meta?.total || data.events?.length || 0);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [filters.since, filters.event_type, filters.checkout_type, page, showError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filters.since, filters.event_type, filters.checkout_type]);

  const hasActiveFilters = filters.event_type || filters.checkout_type;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "0.75rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Equipment Activity</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
          {total} events{filters.since ? ` — ${TIME_TABS.find((t) => t.id === filters.since)?.label || filters.since}` : ""}
        </p>
      </div>

      {/* Time range tabs */}
      <TabBar
        tabs={TIME_TABS}
        activeTab={filters.since || "all"}
        onTabChange={(id) => setFilter("since", id === "all" ? "" : id)}
      />

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.375rem", margin: "0.75rem 0", flexWrap: "wrap", alignItems: "center" }}>
        <FilterPill
          label="Event Type"
          value={filters.event_type}
          options={EQUIPMENT_EVENT_TYPE_OPTIONS}
          onChange={(v) => setFilter("event_type", v)}
        />
        <FilterPill
          label="Checkout Type"
          value={filters.checkout_type}
          options={EQUIPMENT_CHECKOUT_TYPE_OPTIONS}
          onChange={(v) => setFilter("checkout_type", v)}
        />
        {hasActiveFilters && (
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

      {/* Event list */}
      {loading ? (
        <SkeletonTable rows={10} columns={4} />
      ) : events.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No activity found"
          description={filters.since ? "Try expanding the time range or clearing filters." : "No equipment events recorded yet."}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {events.map((ev) => {
            const evStyle = getEventStyle(ev.event_type);
            const catStyle = getCategoryStyle(ev.equipment_category);
            return (
              <div
                key={ev.event_id}
                style={{
                  padding: "0.625rem 0.75rem",
                  borderRadius: "6px",
                  borderLeft: `3px solid ${evStyle.border}`,
                  background: "var(--card-bg, #fff)",
                  border: "1px solid var(--border-light, #f0f0f0)",
                  borderLeftWidth: "3px",
                  borderLeftColor: evStyle.border,
                  fontSize: "0.85rem",
                }}
              >
                {/* Row 1: event type + equipment + timestamp */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px",
                      background: evStyle.bg, color: evStyle.text, fontWeight: 600, flexShrink: 0,
                    }}>
                      {getLabel(EQUIPMENT_EVENT_TYPE_OPTIONS, ev.event_type)}
                    </span>
                    <Link
                      href={`/equipment/${ev.equipment_id}`}
                      style={{
                        fontWeight: 600, color: "var(--text-primary)", textDecoration: "none",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {ev.equipment_name}
                    </Link>
                    {ev.equipment_barcode && (
                      <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--muted)", flexShrink: 0 }}>
                        #{ev.equipment_barcode}
                      </span>
                    )}
                    <span style={{
                      fontSize: "0.65rem", padding: "0.0625rem 0.375rem", borderRadius: "4px",
                      background: catStyle.bg, color: catStyle.text, fontWeight: 500, flexShrink: 0,
                    }}>
                      {ev.equipment_type_name}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)", flexShrink: 0 }}>
                    {new Date(ev.created_at).toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                </div>

                {/* Row 2: details */}
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--text-secondary)", flexWrap: "wrap" }}>
                  {ev.actor_name && (
                    <span>
                      <Icon name="user" size={12} color="var(--muted)" />{" "}
                      <span style={{ fontWeight: 500 }}>{ev.actor_name}</span>
                    </span>
                  )}
                  {ev.custodian_name && (
                    <span>
                      {ev.event_type === "check_out" ? "To: " : ev.event_type === "check_in" ? "From: " : ""}
                      <span style={{ fontWeight: 500 }}>{ev.custodian_name}</span>
                    </span>
                  )}
                  {ev.checkout_type && (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {getLabel(EQUIPMENT_CHECKOUT_TYPE_OPTIONS, ev.checkout_type)}
                    </span>
                  )}
                  {ev.deposit_amount != null && ev.deposit_amount > 0 && (
                    <span style={{ fontSize: "0.75rem", color: "var(--success-text)" }}>
                      ${ev.deposit_amount} deposit
                    </span>
                  )}
                </div>

                {/* Row 3: notes, condition */}
                {(ev.notes || (ev.condition_before && ev.condition_after)) && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--muted)" }}>
                    {ev.condition_before && ev.condition_after && (
                      <span>Condition: {ev.condition_before} → {ev.condition_after} </span>
                    )}
                    {ev.notes && <span>{ev.notes}</span>}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem",
              padding: "0.75rem 0", fontSize: "0.8rem", color: "var(--muted)",
            }}>
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                style={{
                  padding: "0.25rem 0.5rem", borderRadius: "4px", border: "1px solid var(--border)",
                  background: "var(--card-bg)", cursor: page === 0 ? "not-allowed" : "pointer",
                  opacity: page === 0 ? 0.5 : 1,
                }}
              >
                Previous
              </button>
              <span>Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  padding: "0.25rem 0.5rem", borderRadius: "4px", border: "1px solid var(--border)",
                  background: "var(--card-bg)", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                  opacity: page >= totalPages - 1 ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
