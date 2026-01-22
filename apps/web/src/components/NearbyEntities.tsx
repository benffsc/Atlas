"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface NearbyRequest {
  request_id: string;
  summary: string | null;
  status: string;
  priority: string;
  place_address: string | null;
  estimated_cat_count: number | null;
  distance_m: number;
  created_at: string;
}

interface NearbyPlace {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  distance_m: number;
  cat_count: number;
  has_active_request: boolean;
}

interface NearbyPerson {
  person_id: string;
  display_name: string;
  place_name: string | null;
  relationship_type: string | null;
  distance_m: number;
  cat_count: number;
}

interface NearbyCat {
  cat_id: string;
  display_name: string;
  microchip: string | null;
  place_name: string | null;
  distance_m: number;
  altered_status: string | null;
}

interface NearbyResponse {
  request_id: string;
  center: { lat: number; lng: number } | null;
  nearby: {
    requests: NearbyRequest[];
    places: NearbyPlace[];
    people: NearbyPerson[];
    cats: NearbyCat[];
  };
  summary: {
    total_requests: number;
    total_places: number;
    total_people: number;
    total_cats: number;
    radius_meters: number;
  };
  message?: string;
}

interface NearbyEntitiesProps {
  requestId: string;
  onCountsLoaded?: (counts: { requests: number; places: number; people: number; cats: number }) => void;
}

type TabId = "requests" | "places" | "people" | "cats";

const tabConfig: { id: TabId; label: string; icon: string }[] = [
  { id: "requests", label: "Requests", icon: "📋" },
  { id: "places", label: "Places", icon: "📍" },
  { id: "people", label: "People", icon: "👤" },
  { id: "cats", label: "Cats", icon: "🐱" },
];

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
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
      style={{
        background: style.bg,
        color: style.color,
        fontSize: "0.7rem",
        padding: "0.15rem 0.4rem",
        borderRadius: "4px",
        fontWeight: 500,
      }}
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
      style={{
        background: style.bg,
        color: style.color,
        fontSize: "0.65rem",
        padding: "0.1rem 0.35rem",
        borderRadius: "3px",
      }}
    >
      {priority}
    </span>
  );
}

function AlteredBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    altered: { bg: "#198754", color: "#fff" },
    intact: { bg: "#dc3545", color: "#fff" },
    unknown: { bg: "#6c757d", color: "#fff" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        fontSize: "0.65rem",
        padding: "0.1rem 0.35rem",
        borderRadius: "3px",
      }}
    >
      {status}
    </span>
  );
}

export function NearbyEntities({ requestId, onCountsLoaded }: NearbyEntitiesProps) {
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("requests");
  const [radius, setRadius] = useState(5000); // Default 5km

  useEffect(() => {
    async function fetchNearby() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/requests/${requestId}/nearby?radius=${radius}`);
        if (!response.ok) {
          throw new Error("Failed to load nearby entities");
        }
        const result = await response.json();
        setData(result);

        // Notify parent of counts
        if (onCountsLoaded && result.summary) {
          onCountsLoaded({
            requests: result.summary.total_requests,
            places: result.summary.total_places,
            people: result.summary.total_people,
            cats: result.summary.total_cats,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading nearby entities");
      } finally {
        setLoading(false);
      }
    }

    fetchNearby();
  }, [requestId, radius, onCountsLoaded]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
        Loading nearby entities...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", background: "var(--danger-bg)", borderRadius: "8px", color: "var(--danger-text)" }}>
        {error}
      </div>
    );
  }

  if (!data?.center) {
    return (
      <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-secondary)" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📍</div>
        <div style={{ fontWeight: 500, marginBottom: "0.5rem" }}>No Location Available</div>
        <div style={{ fontSize: "0.85rem" }}>
          This request doesn&apos;t have a place with coordinates. Add a place with an address to see nearby entities.
        </div>
      </div>
    );
  }

  const { nearby, summary } = data;

  // Get count for each tab
  const counts: Record<TabId, number> = {
    requests: summary.total_requests,
    places: summary.total_places,
    people: summary.total_people,
    cats: summary.total_cats,
  };

  return (
    <div>
      {/* Radius Selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
          padding: "0.75rem 1rem",
          background: "var(--section-bg)",
          borderRadius: "8px",
        }}
      >
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          Showing entities within {formatDistance(radius)} of request location
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[1000, 2000, 5000, 10000].map((r) => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.8rem",
                borderRadius: "4px",
                border: radius === r ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: radius === r ? "var(--primary)" : "var(--background)",
                color: radius === r ? "white" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              {formatDistance(r)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Bar */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid var(--border)",
          marginBottom: "1rem",
        }}
      >
        {tabConfig.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: "-1px",
              color: activeTab === tab.id ? "var(--primary)" : "var(--text-secondary)",
              fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            <span
              style={{
                background: counts[tab.id] > 0 ? "var(--primary)" : "var(--border)",
                color: counts[tab.id] > 0 ? "white" : "var(--text-secondary)",
                fontSize: "0.7rem",
                padding: "0.1rem 0.4rem",
                borderRadius: "10px",
                fontWeight: 600,
              }}
            >
              {counts[tab.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "requests" && (
          <NearbyRequestsList requests={nearby.requests} />
        )}
        {activeTab === "places" && (
          <NearbyPlacesList places={nearby.places} />
        )}
        {activeTab === "people" && (
          <NearbyPeopleList people={nearby.people} />
        )}
        {activeTab === "cats" && (
          <NearbyCatsList cats={nearby.cats} />
        )}
      </div>
    </div>
  );
}

function NearbyRequestsList({ requests }: { requests: NearbyRequest[] }) {
  if (requests.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
        No other requests found nearby
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {requests.map((req) => (
        <Link
          key={req.request_id}
          href={`/requests/${req.request_id}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "inherit",
            transition: "background 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--section-bg)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--background)";
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <StatusBadge status={req.status} />
              <PriorityBadge priority={req.priority} />
              {req.estimated_cat_count && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  ~{req.estimated_cat_count} cats
                </span>
              )}
            </div>
            <div style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--primary)" }}>
              {req.summary || "Untitled Request"}
            </div>
            {req.place_address && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                {req.place_address}
              </div>
            )}
          </div>
          <div
            style={{
              textAlign: "right",
              flexShrink: 0,
              marginLeft: "1rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
              {formatDistance(req.distance_m)}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
              {new Date(req.created_at).toLocaleDateString()}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function NearbyPlacesList({ places }: { places: NearbyPlace[] }) {
  if (places.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
        No places found nearby
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {places.map((place) => (
        <Link
          key={place.place_id}
          href={`/places/${place.place_id}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "inherit",
            transition: "background 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--section-bg)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--background)";
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              {place.has_active_request && (
                <span
                  style={{
                    background: "#dc3545",
                    color: "white",
                    fontSize: "0.65rem",
                    padding: "0.1rem 0.35rem",
                    borderRadius: "3px",
                    fontWeight: 500,
                  }}
                >
                  Active Request
                </span>
              )}
              {place.cat_count > 0 && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  {place.cat_count} cats linked
                </span>
              )}
            </div>
            <div style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--primary)" }}>
              {place.display_name}
            </div>
            {place.formatted_address && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                {place.formatted_address}
              </div>
            )}
          </div>
          <div
            style={{
              textAlign: "right",
              flexShrink: 0,
              marginLeft: "1rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
              {formatDistance(place.distance_m)}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function NearbyPeopleList({ people }: { people: NearbyPerson[] }) {
  if (people.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
        No people found nearby
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {people.map((person) => (
        <Link
          key={person.person_id}
          href={`/people/${person.person_id}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "inherit",
            transition: "background 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--section-bg)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--background)";
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              {person.relationship_type && (
                <span
                  style={{
                    background: "var(--section-bg)",
                    border: "1px solid var(--border)",
                    fontSize: "0.65rem",
                    padding: "0.1rem 0.35rem",
                    borderRadius: "3px",
                  }}
                >
                  {person.relationship_type}
                </span>
              )}
              {person.cat_count > 0 && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  {person.cat_count} cats
                </span>
              )}
            </div>
            <div style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--primary)" }}>
              {person.display_name}
            </div>
            {person.place_name && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                {person.place_name}
              </div>
            )}
          </div>
          <div
            style={{
              textAlign: "right",
              flexShrink: 0,
              marginLeft: "1rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
              {formatDistance(person.distance_m)}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function NearbyCatsList({ cats }: { cats: NearbyCat[] }) {
  if (cats.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
        No cats found nearby
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {cats.map((cat) => (
        <Link
          key={cat.cat_id}
          href={`/cats/${cat.cat_id}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "inherit",
            transition: "background 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--section-bg)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--background)";
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <AlteredBadge status={cat.altered_status} />
              {cat.microchip && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                  ...{cat.microchip.slice(-6)}
                </span>
              )}
            </div>
            <div style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--primary)" }}>
              {cat.display_name}
            </div>
            {cat.place_name && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                {cat.place_name}
              </div>
            )}
          </div>
          <div
            style={{
              textAlign: "right",
              flexShrink: 0,
              marginLeft: "1rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
              {formatDistance(cat.distance_m)}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
