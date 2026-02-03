"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { formatDateLocal } from "@/lib/formatters";
import { SavedFilters, RequestFilters } from "@/components/SavedFilters";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useIsMobile } from "@/hooks/useIsMobile";

interface Request {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  scheduled_date: string | null;
  assigned_to: string | null;
  created_at: string;
  source_created_at: string | null; // Original Airtable date for legacy data
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_name: string | null;
  latitude: number | null;
  longitude: number | null;
  is_legacy_request: boolean;
  // SC_001: Data quality columns
  active_trapper_count: number;
  place_has_location: boolean;
  data_quality_flags: string[];
  // SC_002: Trapper visibility columns
  no_trapper_reason: string | null;
  primary_trapper_name: string | null;
  // SC_004: Assignment status (maintained field)
  assignment_status: string;
}


function ColonySizeBadge({ count }: { count: number | null }) {
  const catCount = count ?? 0;
  let style: { bg: string; color: string; label: string };

  if (catCount >= 20) {
    style = { bg: "#dc3545", color: "#fff", label: `${catCount}+ cats` };
  } else if (catCount >= 7) {
    style = { bg: "#fd7e14", color: "#000", label: `${catCount} cats` };
  } else if (catCount >= 2) {
    style = { bg: "#0d6efd", color: "#fff", label: `${catCount} cats` };
  } else {
    style = { bg: "#6c757d", color: "#fff", label: catCount ? `${catCount} cat` : "?" };
  }

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.75rem" }}
    >
      {style.label}
    </span>
  );
}

const FLAG_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  no_trapper: { label: "Needs trapper", bg: "#fef3c7", color: "#92400e" },
  client_trapping: { label: "Client trapping", bg: "#d1fae5", color: "#065f46" },
  no_geometry: { label: "No map pin", bg: "#dbeafe", color: "#1e40af" },
  stale_30d: { label: "Stale 30d", bg: "#fee2e2", color: "#991b1b" },
  no_requester: { label: "No requester", bg: "#e0e7ff", color: "#3730a3" },
};

function DataQualityFlags({
  flags,
  requestId,
  onTrapperAction,
  actionMenuOpen,
  onToggleMenu,
}: {
  flags: string[];
  requestId?: string;
  onTrapperAction?: (requestId: string, reason: string) => void;
  actionMenuOpen?: boolean;
  onToggleMenu?: (requestId: string | null) => void;
}) {
  if (!flags || flags.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
      {flags.map((flag) => {
        const cfg = FLAG_CONFIG[flag] || { label: flag, bg: "#e5e7eb", color: "#374151" };
        const isClickable = flag === "no_trapper" && requestId && onTrapperAction;

        return (
          <span
            key={flag}
            style={{
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "4px",
              background: cfg.bg,
              color: cfg.color,
              fontWeight: 500,
              lineHeight: "1.4",
              cursor: isClickable ? "pointer" : undefined,
              position: isClickable ? "relative" : undefined,
            }}
            onClick={isClickable ? (e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleMenu?.(actionMenuOpen ? null : requestId);
            } : undefined}
          >
            {cfg.label}{isClickable ? " \u25BE" : ""}
            {isClickable && actionMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: "4px",
                  background: "var(--card-bg, #fff)",
                  border: "1px solid var(--border-default, #e5e7eb)",
                  borderRadius: "6px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  zIndex: 50,
                  minWidth: "160px",
                  overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => onTrapperAction(requestId, "client_trapping")}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary, #111)",
                    fontSize: "0.8rem",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #f3f4f6)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Client trapping
                </button>
                <button
                  onClick={() => onTrapperAction(requestId, "not_needed")}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary, #111)",
                    fontSize: "0.8rem",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #f3f4f6)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Not needed
                </button>
                <a
                  href={`/requests/${requestId}`}
                  style={{
                    display: "block",
                    padding: "8px 12px",
                    borderTop: "1px solid var(--border-default, #e5e7eb)",
                    color: "var(--primary, #0d6efd)",
                    fontSize: "0.8rem",
                    textDecoration: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #f3f4f6)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Assign trapper &rarr;
                </a>
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}

function RequestMapPreview({ requestId, latitude, longitude }: {
  requestId: string;
  latitude: number | null;
  longitude: number | null;
}) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [nearbyCount, setNearbyCount] = useState<number>(0);

  useEffect(() => {
    if (!latitude || !longitude) return;

    const fetchMap = async () => {
      try {
        const response = await fetch(`/api/requests/${requestId}/map?width=400&height=200&zoom=15&scale=2`);
        if (response.ok) {
          const data = await response.json();
          setMapUrl(data.map_url);
          setNearbyCount(data.nearby_count);
        }
      } catch (err) {
        console.error("Failed to fetch map:", err);
      }
    };

    fetchMap();
  }, [requestId, latitude, longitude]);

  if (!latitude || !longitude) {
    return (
      <div
        style={{
          width: "100%",
          height: "180px",
          background: "var(--card-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
          color: "var(--text-muted)",
          fontSize: "0.875rem",
        }}
      >
        No location
      </div>
    );
  }

  if (!mapUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "180px",
          background: "var(--card-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
        }}
      >
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <img
        src={mapUrl}
        alt="Location map"
        style={{
          width: "100%",
          height: "180px",
          objectFit: "cover",
          borderRadius: "8px",
        }}
      />
      {nearbyCount > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            padding: "2px 8px",
            borderRadius: "4px",
            fontSize: "0.75rem",
          }}
        >
          {nearbyCount} nearby
        </div>
      )}
    </div>
  );
}

function RequestCard({ request, onTrapperAction, actionMenuId, onToggleMenu }: {
  request: Request;
  onTrapperAction?: (requestId: string, reason: string) => void;
  actionMenuId?: string | null;
  onToggleMenu?: (id: string | null) => void;
}) {
  return (
    <a
      href={`/requests/${request.request_id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        className="card"
        style={{
          border: "1px solid var(--card-border)",
          borderRadius: "12px",
          overflow: "hidden",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "none";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {/* Map Preview */}
        <RequestMapPreview
          requestId={request.request_id}
          latitude={request.latitude}
          longitude={request.longitude}
        />

        {/* Card Content */}
        <div style={{ padding: "12px" }}>
          {/* Status & Priority Row */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            <StatusBadge status={request.status} />
            <PriorityBadge priority={request.priority} />
            <ColonySizeBadge count={request.estimated_cat_count} />
            {request.has_kittens && (
              <span
                className="badge"
                style={{ background: "#fd7e14", color: "#000", fontSize: "0.7rem" }}
              >
                +kittens
              </span>
            )}
          </div>

          {/* Data Quality Flags */}
          <DataQualityFlags
            flags={request.data_quality_flags}
            requestId={request.request_id}
            onTrapperAction={onTrapperAction}
            actionMenuOpen={actionMenuId === request.request_id}
            onToggleMenu={onToggleMenu}
          />

          {/* Summary */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "1rem",
              marginBottom: "4px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {request.summary || "Untitled Request"}
          </div>

          {/* Location */}
          {request.place_name && (
            <div
              style={{
                fontSize: "0.875rem",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {request.place_name}
              {request.place_city && ` • ${request.place_city}`}
            </div>
          )}

          {/* Trapper */}
          {request.primary_trapper_name && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#065f46",
                marginTop: "4px",
              }}
            >
              Trapper: {request.primary_trapper_name}
              {request.active_trapper_count > 1 && ` +${request.active_trapper_count - 1}`}
            </div>
          )}

          {/* Requester & Date */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "4px",
            }}
          >
            <span>{request.requester_name || "Unknown requester"}</span>
            <span>{formatDateLocal(request.source_created_at || request.created_at)}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

const FILTER_DEFAULTS = {
  status: "",
  trapper: "",
  q: "",
  sort: "status",
  order: "asc",
  group: "",
  view: "cards",
};

function RequestsPageContent() {
  const { filters, setFilter, setFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const isMobile = useIsMobile();

  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<string>("");

  // Current staff for SavedFilters
  const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);

  // Fetch current staff info
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && data.staff) {
          setCurrentStaffId(data.staff.staff_id);
        }
      })
      .catch(() => {});
  }, []);

  // Build current filters object for SavedFilters component
  const currentFilters: RequestFilters = {
    status: filters.status ? [filters.status] : undefined,
    trapperStatus: filters.trapper || undefined,
  };

  // Handle applying saved filters
  const handleApplyFilters = useCallback((applied: RequestFilters) => {
    if (applied.status && applied.status.length > 0) {
      setFilter("status", applied.status[0]);
    } else {
      setFilter("status", "");
    }
    if (applied.trapperStatus) {
      setFilter("trapper", applied.trapperStatus);
    } else {
      setFilter("trapper", "");
    }
  }, [setFilter]);

  // Quick trapper action from badge popover on request cards
  const handleQuickTrapperAction = async (requestId: string, reason: string) => {
    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ no_trapper_reason: reason }),
      });
      if (response.ok) {
        setActionMenuId(null);
        setRefreshTrigger((n) => n + 1);
        // Log to journal as system entry
        fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_id: requestId,
            entry_kind: "system",
            tags: ["trapper_action"],
            body: reason === "client_trapping"
              ? "Marked as client trapping (trapper not needed)"
              : reason === "not_needed"
              ? "Marked as trapper not needed"
              : `Trapper status updated: ${reason}`,
          }),
        }).catch(() => {}); // fire-and-forget
      }
    } catch (err) {
      console.error("Failed to update trapper reason:", err);
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === requests.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(requests.map((r) => r.request_id)));
    }
  };

  const handleBulkStatusUpdate = async () => {
    if (selectedIds.size === 0 || !bulkStatusTarget) return;
    if (!confirm(`Update ${selectedIds.size} requests to "${bulkStatusTarget.replace(/_/g, " ")}"?`)) return;

    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        fetch(`/api/requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: bulkStatusTarget }),
        })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setBulkStatusTarget("");
      // Refresh the list
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.trapper) params.set("trapper", filters.trapper);
      if (filters.q) params.set("q", filters.q);
      params.set("sort_by", filters.sort);
      params.set("sort_order", filters.order);
      params.set("limit", "100");
      const response = await fetch(`/api/requests?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setRequests(data.requests || []);
      }
    } catch (err) {
      alert("Error updating requests");
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleExportSelected = () => {
    const selectedRequests = requests.filter((r) => selectedIds.has(r.request_id));
    const csv = [
      ["ID", "Status", "Priority", "Summary", "Location", "City", "Requester", "Cats", "Created"],
      ...selectedRequests.map((r) => [
        r.request_id,
        r.status,
        r.priority,
        r.summary || "",
        r.place_name || "",
        r.place_city || "",
        r.requester_name || "",
        r.estimated_cat_count?.toString() || "",
        r.source_created_at || r.created_at,
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `requests-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Debounce search input → sync to URL param
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.q) {
        setFilter("q", searchInput);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select card view on mobile
  useEffect(() => {
    if (isMobile && filters.view === "table") {
      setFilter("view", "cards");
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fetchRequests = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.status) params.set("status", filters.status);
        if (filters.trapper) params.set("trapper", filters.trapper);
        if (filters.q) params.set("q", filters.q);
        params.set("sort_by", filters.sort);
        params.set("sort_order", filters.order);
        params.set("limit", "100");

        const response = await fetch(`/api/requests?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setRequests(data.requests || []);
        }
      } catch (err) {
        console.error("Failed to fetch requests:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, [filters.status, filters.trapper, filters.q, filters.sort, filters.order, refreshTrigger]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1>Requests</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="/intake/call-sheet"
            style={{
              padding: "0.5rem 1rem",
              background: "#0d6efd",
              color: "#fff",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.9rem",
            }}
          >
            Enter Call Sheet
          </a>
          <a
            href="/requests/print/full"
            style={{
              padding: "0.5rem 1rem",
              background: "#27ae60",
              color: "#fff",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.9rem",
            }}
          >
            Print Call Sheet
          </a>
          <a
            href="/requests/new"
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            + New Request
          </a>
        </div>
      </div>

      {/* Saved Filters */}
      <div style={{ marginBottom: "0.75rem" }}>
        <SavedFilters
          currentFilters={currentFilters}
          onApplyFilter={handleApplyFilters}
          currentStaffId={currentStaffId}
        />
      </div>

      {/* Search + Compact Filter Bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        {/* Search Bar */}
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: "320px" }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search..."
            style={{
              width: "100%",
              paddingLeft: "2rem",
              padding: "0.3rem 0.6rem 0.3rem 2rem",
              fontSize: "0.8rem",
              borderRadius: "16px",
              border: "1px solid var(--border)",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "0.6rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
              fontSize: "0.75rem",
            }}
          >
            🔍
          </span>
          {searchInput && (
            <button
              onClick={() => { setSearchInput(""); setFilter("q", ""); }}
              style={{
                position: "absolute",
                right: "0.4rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "2px",
                fontSize: "0.7rem",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Pill selects */}
        {[
          {
            value: filters.status,
            onChange: (v: string) => setFilter("status", v),
            options: [
              { value: "", label: "Status" },
              { value: "new", label: "New" },
              { value: "triaged", label: "Triaged" },
              { value: "scheduled", label: "Scheduled" },
              { value: "in_progress", label: "In Progress" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
              { value: "on_hold", label: "On Hold" },
            ],
          },
          {
            value: filters.trapper,
            onChange: (v: string) => setFilter("trapper", v),
            options: [
              { value: "", label: "Assignment" },
              { value: "assigned", label: "Assigned" },
              { value: "pending", label: "Needs Trapper" },
              { value: "client_trapping", label: "Client Trapping" },
            ],
          },
          {
            value: filters.sort,
            onChange: (v: string) => setFilter("sort", v),
            options: [
              { value: "status", label: "By Status" },
              { value: "created", label: "By Date" },
              { value: "priority", label: "By Priority" },
              { value: "type", label: "By Type" },
            ],
          },
          {
            value: filters.group,
            onChange: (v: string) => setFilter("group", v),
            options: [
              { value: "", label: "Group" },
              { value: "status", label: "By Status" },
              { value: "type", label: "By Type" },
            ],
          },
        ].map((sel, i) => (
          <select
            key={i}
            value={sel.value}
            onChange={(e) => sel.onChange(e.target.value)}
            style={{
              padding: "0.3rem 1.4rem 0.3rem 0.6rem",
              fontSize: "0.8rem",
              borderRadius: "16px",
              border: `1px solid ${sel.value && sel.value !== "status" ? "var(--primary)" : "var(--border)"}`,
              background: sel.value && sel.value !== "status" ? "var(--info-bg, #eff6ff)" : "var(--background)",
              color: "var(--foreground)",
              cursor: "pointer",
              WebkitAppearance: "none",
              MozAppearance: "none",
              appearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%236b7280'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 0.5rem center",
            }}
          >
            {sel.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ))}

        {/* Order toggle */}
        <button
          onClick={() => setFilter("order", filters.order === "asc" ? "desc" : "asc")}
          style={{
            padding: "0.3rem 0.5rem",
            fontSize: "0.8rem",
            borderRadius: "16px",
            border: "1px solid var(--border)",
            background: "var(--background)",
            cursor: "pointer",
            lineHeight: 1,
          }}
          title={filters.order === "desc" ? "Newest first" : "Oldest first"}
        >
          {filters.order === "desc" ? "↓" : "↑"}
        </button>

        {/* Needs Trapper toggle */}
        <button
          onClick={() => setFilter("trapper", filters.trapper === "pending" ? "" : "pending")}
          style={{
            padding: "0.3rem 0.75rem",
            fontSize: "0.8rem",
            fontWeight: 500,
            borderRadius: "16px",
            border: filters.trapper === "pending" ? "1px solid #f97316" : "1px solid var(--border)",
            background: filters.trapper === "pending" ? "#f97316" : "var(--background)",
            color: filters.trapper === "pending" ? "white" : "var(--foreground)",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          Needs Trapper
        </button>

        {/* View Toggle */}
        <div style={{ display: "flex", gap: "2px", marginLeft: "auto" }}>
          <button
            onClick={() => setFilter("view", "cards")}
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.75rem",
              border: "1px solid var(--card-border)",
              borderRadius: "16px 0 0 16px",
              background: filters.view === "cards" ? "var(--foreground)" : "transparent",
              color: filters.view === "cards" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Cards
          </button>
          <button
            onClick={() => setFilter("view", "table")}
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.75rem",
              border: "1px solid var(--card-border)",
              borderLeft: "none",
              borderRadius: "0 16px 16px 0",
              background: filters.view === "table" ? "var(--foreground)" : "transparent",
              color: filters.view === "table" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Table
          </button>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#dbeafe",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontWeight: 500, color: "#1e40af" }}>
            {selectedIds.size} request{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={bulkStatusTarget}
              onChange={(e) => setBulkStatusTarget(e.target.value)}
              style={{ minWidth: "140px", padding: "0.4rem 0.5rem", fontSize: "0.875rem" }}
            >
              <option value="">Change status to...</option>
              <option value="new">New</option>
              <option value="triaged">Triaged</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button
              onClick={handleBulkStatusUpdate}
              disabled={!bulkStatusTarget || bulkUpdating}
              style={{
                padding: "0.4rem 0.75rem",
                border: "none",
                borderRadius: "6px",
                background: bulkStatusTarget ? "#2563eb" : "#94a3b8",
                color: "white",
                cursor: bulkStatusTarget && !bulkUpdating ? "pointer" : "not-allowed",
                fontSize: "0.875rem",
              }}
            >
              {bulkUpdating ? "Updating..." : "Apply"}
            </button>
            <button
              onClick={handleExportSelected}
              style={{
                padding: "0.4rem 0.75rem",
                border: "1px solid #2563eb",
                borderRadius: "6px",
                background: "transparent",
                color: "#2563eb",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Export CSV
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                padding: "0.4rem 0.75rem",
                border: "1px solid #64748b",
                borderRadius: "6px",
                background: "transparent",
                color: "#64748b",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Helper to group requests */}
      {(() => {
        // Group requests if groupBy is set
        const groupedRequests = filters.group
          ? requests.reduce((acc, req) => {
              const key = filters.group === "type"
                ? (req.is_legacy_request ? "Legacy (Airtable)" : "Native (Atlas)")
                : req.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              if (!acc[key]) acc[key] = [];
              acc[key].push(req);
              return acc;
            }, {} as Record<string, Request[]>)
          : { "": requests };

        // Sort group keys
        const groupOrder = filters.group === "type"
          ? ["Native (Atlas)", "Legacy (Airtable)"]
          : ["New", "Triaged", "Scheduled", "In Progress", "On Hold", "Completed", "Cancelled"];

        const sortedGroups = Object.entries(groupedRequests).sort(([a], [b]) => {
          const aIdx = groupOrder.indexOf(a);
          const bIdx = groupOrder.indexOf(b);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });

        return loading ? (
          <div className="loading">Loading requests...</div>
        ) : requests.length === 0 ? (
          <div className="empty">
            <p>No requests found</p>
            <a href="/requests/new">Create your first request</a>
          </div>
        ) : filters.view === "cards" ? (
          <div>
            {sortedGroups.map(([groupName, groupRequests]) => (
              <div key={groupName || "all"} style={{ marginBottom: "2rem" }}>
                {filters.group && (
                  <h3 style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    marginBottom: "0.75rem",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem"
                  }}>
                    {groupName}
                    <span style={{
                      fontSize: "0.8rem",
                      fontWeight: 400,
                      color: "var(--muted)",
                    }}>
                      ({groupRequests.length})
                    </span>
                  </h3>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  {groupRequests.map((req) => (
                    <RequestCard
                      key={req.request_id}
                      request={req}
                      onTrapperAction={handleQuickTrapperAction}
                      actionMenuId={actionMenuId}
                      onToggleMenu={setActionMenuId}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === requests.length && requests.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Location</th>
                <th>Title</th>
                <th>Cats</th>
                <th>Trapper</th>
                <th>Requester</th>
                <th>Flags</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr
                  key={req.request_id}
                  style={{
                    background: selectedIds.has(req.request_id) ? "#dbeafe" : undefined,
                  }}
                >
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(req.request_id)}
                      onChange={() => toggleSelect(req.request_id)}
                    />
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: req.is_legacy_request ? "#6c757d" : "#198754",
                        color: "#fff",
                        fontSize: "0.7rem",
                      }}
                    >
                      {req.is_legacy_request ? "Legacy" : "Native"}
                    </span>
                  </td>
                  <td>
                    <a href={`/requests/${req.request_id}`}>
                      <StatusBadge status={req.status} />
                    </a>
                  </td>
                  <td>
                    <PriorityBadge priority={req.priority} />
                  </td>
                  <td>
                    {req.place_name ? (
                      <div>
                        <div style={{ fontWeight: 500 }}>{req.place_name}</div>
                        {req.place_city && (
                          <div className="text-muted text-sm">{req.place_city}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">No location</span>
                    )}
                  </td>
                  <td>
                    <a href={`/requests/${req.request_id}`}>
                      {req.summary || <span className="text-muted">No summary</span>}
                    </a>
                  </td>
                  <td className="text-sm">
                    {req.estimated_cat_count ?? "?"}
                    {req.has_kittens && (
                      <span style={{ marginLeft: "0.25rem", color: "#fd7e14" }}>+kittens</span>
                    )}
                  </td>
                  <td className="text-sm">
                    {req.primary_trapper_name ? (
                      <div>
                        <span>{req.primary_trapper_name}</span>
                        {req.active_trapper_count > 1 && (
                          <span className="text-muted"> +{req.active_trapper_count - 1}</span>
                        )}
                      </div>
                    ) : req.no_trapper_reason === "client_trapping" ? (
                      <span style={{ color: "#065f46", fontSize: "0.75rem" }}>Client</span>
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </td>
                  <td>
                    {req.requester_name ? (
                      <span>{req.requester_name}</span>
                    ) : (
                      <span className="text-muted">Unknown</span>
                    )}
                  </td>
                  <td>
                    <DataQualityFlags
                      flags={req.data_quality_flags}
                      requestId={req.request_id}
                      onTrapperAction={handleQuickTrapperAction}
                      actionMenuOpen={actionMenuId === req.request_id}
                      onToggleMenu={setActionMenuId}
                    />
                  </td>
                  <td className="text-sm text-muted">
                    {formatDateLocal(req.source_created_at || req.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}

      {/* Click outside to close trapper action menu */}
      {actionMenuId && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
          onClick={() => setActionMenuId(null)}
        />
      )}
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<div className="loading">Loading requests...</div>}>
      <RequestsPageContent />
    </Suspense>
  );
}
