"use client";

import { useState, useEffect } from "react";

interface MovementEvent {
  movement_id: string;
  from_place_name: string | null;
  from_address: string | null;
  to_place_id: string;
  to_place_name: string | null;
  to_address: string | null;
  event_date: string;
  days_since_previous: number | null;
  distance_meters: number | null;
  distance_category: string | null;
  movement_type: string;
  source_type: string;
  notes: string | null;
}

interface MovementPattern {
  total_movements: number;
  unique_places: number;
  first_seen: string;
  last_seen: string;
  tracking_duration_days: number;
  avg_days_between_visits: number | null;
  avg_distance_meters: number | null;
  max_distance_meters: number | null;
  movement_pattern: string;
  primary_place_name: string | null;
  primary_address: string | null;
}

interface Reunification {
  reunification_id: string;
  original_owner_name: string | null;
  current_caretaker_name: string | null;
  original_address: string | null;
  found_at_address: string | null;
  reunification_status: string;
  reunification_date: string | null;
  how_identified: string | null;
  notes: string | null;
  recorded_at: string;
}

interface CatMovementSectionProps {
  catId: string;
}

const patternColors: Record<string, { bg: string; label: string }> = {
  stationary: { bg: "#198754", label: "Stationary" },
  two_homes: { bg: "#6f42c1", label: "Two Homes" },
  local_mover: { bg: "#0d6efd", label: "Local Mover" },
  mobile: { bg: "#fd7e14", label: "Mobile" },
  wide_roamer: { bg: "#dc3545", label: "Wide Roamer" },
};

const movementTypeLabels: Record<string, string> = {
  first_recorded: "First seen",
  same_location: "Same location",
  return_visit: "Return visit",
  new_location: "New location",
};

export function CatMovementSection({ catId }: CatMovementSectionProps) {
  const [timeline, setTimeline] = useState<MovementEvent[]>([]);
  const [pattern, setPattern] = useState<MovementPattern | null>(null);
  const [reunifications, setReunifications] = useState<Reunification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReunionForm, setShowReunionForm] = useState(false);
  const [reunionNotes, setReunionNotes] = useState("");
  const [reunionStatus, setReunionStatus] = useState("confirmed");
  const [savingReunion, setSavingReunion] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [movementRes, reunionRes] = await Promise.all([
          fetch(`/api/cats/${catId}/movements`),
          fetch(`/api/cats/${catId}/reunification`),
        ]);

        if (movementRes.ok) {
          const data = await movementRes.json();
          setTimeline(data.timeline || []);
          setPattern(data.pattern || null);
        }

        if (reunionRes.ok) {
          const data = await reunionRes.json();
          setReunifications(data.reunifications || []);
        }
      } catch (err) {
        console.error("Error fetching movement data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [catId]);

  const handleRecordReunion = async () => {
    setSavingReunion(true);
    try {
      const response = await fetch(`/api/cats/${catId}/reunification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reunification_status: reunionStatus,
          reunification_date: new Date().toISOString().split("T")[0],
          how_identified: "microchip_scan",
          notes: reunionNotes,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to record reunification");
      }

      // Refresh data
      const reunionRes = await fetch(`/api/cats/${catId}/reunification`);
      if (reunionRes.ok) {
        const data = await reunionRes.json();
        setReunifications(data.reunifications || []);
      }

      setShowReunionForm(false);
      setReunionNotes("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error recording reunification");
    } finally {
      setSavingReunion(false);
    }
  };

  if (loading) {
    return <div style={{ padding: "1rem", color: "#666" }}>Loading movement data...</div>;
  }

  const hasMovements = timeline.length > 0;
  const hasReunifications = reunifications.length > 0;

  return (
    <div>
      {/* Reunification Quick Action */}
      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {reunifications.some((r) => r.reunification_status === "confirmed") ? (
          <span
            style={{
              padding: "0.25rem 0.75rem",
              background: "#198754",
              color: "#fff",
              borderRadius: "4px",
              fontSize: "0.8rem",
            }}
          >
            Reunited with Owner
          </span>
        ) : (
          <button
            onClick={() => setShowReunionForm(true)}
            style={{
              padding: "0.5rem 0.75rem",
              background: "#198754",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Record Reunification
          </button>
        )}
      </div>

      {/* Reunification Form */}
      {showReunionForm && (
        <div
          style={{
            padding: "1rem",
            background: "#f8f9fa",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}
        >
          <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>Record Reunification</h4>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
              Status
            </label>
            <select
              value={reunionStatus}
              onChange={(e) => setReunionStatus(e.target.value)}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              <option value="confirmed">Confirmed - Returned to owner</option>
              <option value="pending">Pending - Awaiting confirmation</option>
              <option value="declined">Declined - Owner declined</option>
            </select>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
              Notes
            </label>
            <textarea
              value={reunionNotes}
              onChange={(e) => setReunionNotes(e.target.value)}
              placeholder="Details about the reunification..."
              rows={2}
              style={{ width: "100%", padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleRecordReunion}
              disabled={savingReunion}
              style={{
                padding: "0.5rem 1rem",
                background: "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              {savingReunion ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setShowReunionForm(false)}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reunification History */}
      {hasReunifications && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h4 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Reunification History</h4>
          {reunifications.map((r) => (
            <div
              key={r.reunification_id}
              style={{
                padding: "0.75rem",
                background: r.reunification_status === "confirmed" ? "#d4edda" : "#f8f9fa",
                borderRadius: "6px",
                marginBottom: "0.5rem",
                fontSize: "0.85rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>
                  {r.reunification_status === "confirmed"
                    ? "Reunited"
                    : r.reunification_status === "pending"
                    ? "Pending"
                    : "Declined"}
                </span>
                <span style={{ color: "#666", fontSize: "0.75rem" }}>
                  {new Date(r.recorded_at).toLocaleDateString()}
                </span>
              </div>
              {r.notes && (
                <div style={{ marginTop: "0.5rem", color: "#495057" }}>{r.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Movement Pattern Summary */}
      {pattern && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: "1rem",
            padding: "0.75rem",
            background: "#f8f9fa",
            borderRadius: "8px",
          }}
        >
          <div>
            <span
              style={{
                padding: "0.25rem 0.5rem",
                background: patternColors[pattern.movement_pattern]?.bg || "#6c757d",
                color: "#fff",
                borderRadius: "4px",
                fontSize: "0.75rem",
              }}
            >
              {patternColors[pattern.movement_pattern]?.label || pattern.movement_pattern}
            </span>
          </div>
          <div style={{ fontSize: "0.85rem" }}>
            <strong>{pattern.unique_places}</strong> locations visited
          </div>
          {pattern.primary_place_name && (
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              Primary: {pattern.primary_place_name}
            </div>
          )}
          {pattern.avg_distance_meters && pattern.avg_distance_meters > 0 && (
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              Avg distance: {Math.round(pattern.avg_distance_meters)}m
            </div>
          )}
        </div>
      )}

      {/* Movement Timeline */}
      {hasMovements ? (
        <div>
          <h4 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Location History</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {timeline.slice(0, 10).map((event) => (
              <div
                key={event.movement_id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.5rem",
                  background: "#fff",
                  borderLeft:
                    event.movement_type === "new_location"
                      ? "3px solid #fd7e14"
                      : event.movement_type === "return_visit"
                      ? "3px solid #6f42c1"
                      : "3px solid #6c757d",
                  borderRadius: "0 4px 4px 0",
                }}
              >
                <div style={{ fontSize: "0.75rem", color: "#666", minWidth: "70px" }}>
                  {new Date(event.event_date).toLocaleDateString()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.85rem" }}>
                    {event.to_place_name || event.to_address || "Unknown location"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#666" }}>
                    {movementTypeLabels[event.movement_type] || event.movement_type}
                    {event.days_since_previous && ` • ${event.days_since_previous} days since last`}
                    {event.distance_category &&
                      event.distance_category !== "same_area" &&
                      ` • ${event.distance_category}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {timeline.length > 10 && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#666" }}>
              + {timeline.length - 10} more locations
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: "#666", fontSize: "0.85rem" }}>
          No movement history recorded for this cat.
        </div>
      )}
    </div>
  );
}
