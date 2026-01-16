"use client";

import { useState, useEffect } from "react";

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
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    new: { bg: "#0d6efd", color: "#fff" },
    triaged: { bg: "#6610f2", color: "#fff" },
    scheduled: { bg: "#198754", color: "#fff" },
    in_progress: { bg: "#fd7e14", color: "#000" },
    completed: { bg: "#20c997", color: "#000" },
    cancelled: { bg: "#6c757d", color: "#fff" },
    on_hold: { bg: "#ffc107", color: "#000" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#dc3545", color: "#fff" },
    high: { bg: "#fd7e14", color: "#000" },
    normal: { bg: "#6c757d", color: "#fff" },
    low: { bg: "#adb5bd", color: "#000" },
  };
  const style = colors[priority] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}
    >
      {priority}
    </span>
  );
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

function RequestCard({ request }: { request: Request }) {
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

          {/* Requester & Date */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "8px",
            }}
          >
            <span>{request.requester_name || "Unknown requester"}</span>
            <span>{new Date(request.source_created_at || request.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [sortBy, setSortBy] = useState<"created" | "status" | "priority" | "type">("status");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [groupBy, setGroupBy] = useState<"" | "status" | "type">("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const fetchRequests = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (debouncedSearch) params.set("q", debouncedSearch);
        params.set("sort_by", sortBy);
        params.set("sort_order", sortOrder);
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
  }, [statusFilter, debouncedSearch, sortBy, sortOrder]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1>Requests</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="/requests/print"
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

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        {/* Search Bar */}
        <div style={{ position: "relative", flex: "1 1 250px", maxWidth: "400px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search requests..."
            style={{ width: "100%", paddingLeft: "2.5rem" }}
          />
          <span
            style={{
              position: "absolute",
              left: "0.75rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          >
            🔍
          </span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: "0.5rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "0.25rem",
              }}
            >
              ✕
            </button>
          )}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ minWidth: "150px" }}
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="triaged">Triaged</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="on_hold">On Hold</option>
        </select>

        {/* Sort controls */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "created" | "status" | "priority" | "type")}
          style={{ minWidth: "130px" }}
        >
          <option value="status">Sort by Status</option>
          <option value="created">Sort by Date</option>
          <option value="priority">Sort by Priority</option>
          <option value="type">Sort by Type</option>
        </select>

        {/* Group by */}
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as "" | "status" | "type")}
          style={{ minWidth: "120px" }}
        >
          <option value="">No grouping</option>
          <option value="status">Group by Status</option>
          <option value="type">Group by Type</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            background: "transparent",
            cursor: "pointer",
          }}
          title={sortOrder === "desc" ? "Newest first" : "Oldest first"}
        >
          {sortOrder === "desc" ? "↓" : "↑"}
        </button>

        {/* View Toggle */}
        <div style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
          <button
            onClick={() => setViewMode("cards")}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--card-border)",
              borderRadius: "4px 0 0 4px",
              background: viewMode === "cards" ? "var(--foreground)" : "transparent",
              color: viewMode === "cards" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode("table")}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--card-border)",
              borderLeft: "none",
              borderRadius: "0 4px 4px 0",
              background: viewMode === "table" ? "var(--foreground)" : "transparent",
              color: viewMode === "table" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Table
          </button>
        </div>
      </div>

      {/* Helper to group requests */}
      {(() => {
        // Group requests if groupBy is set
        const groupedRequests = groupBy
          ? requests.reduce((acc, req) => {
              const key = groupBy === "type"
                ? (req.is_legacy_request ? "Legacy (Airtable)" : "Native (Atlas)")
                : req.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              if (!acc[key]) acc[key] = [];
              acc[key].push(req);
              return acc;
            }, {} as Record<string, Request[]>)
          : { "": requests };

        // Sort group keys
        const groupOrder = groupBy === "type"
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
        ) : viewMode === "cards" ? (
          <div>
            {sortedGroups.map(([groupName, groupRequests]) => (
              <div key={groupName || "all"} style={{ marginBottom: "2rem" }}>
                {groupBy && (
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
                    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                    gap: "1rem",
                  }}
                >
                  {groupRequests.map((req) => (
                    <RequestCard key={req.request_id} request={req} />
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
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Location</th>
                <th>Title</th>
                <th>Cats</th>
                <th>Requester</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.request_id}>
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
                  <td>
                    {req.requester_name ? (
                      <span>{req.requester_name}</span>
                    ) : (
                      <span className="text-muted">Unknown</span>
                    )}
                  </td>
                  <td className="text-sm text-muted">
                    {new Date(req.source_created_at || req.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}
