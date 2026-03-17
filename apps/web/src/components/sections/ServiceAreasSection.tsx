"use client";

import { useState } from "react";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { postApi } from "@/lib/api-client";
import type { SectionProps } from "@/lib/person-roles/types";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  primary_territory: "Primary",
  regular: "Regular",
  occasional: "Occasional",
  home_rescue: "Home Rescue",
  historical: "Historical",
};

const SERVICE_TYPE_COLORS: Record<string, string> = {
  primary_territory: "#198754",
  regular: "#0d6efd",
  occasional: "#6c757d",
  home_rescue: "#6f42c1",
  historical: "#adb5bd",
};

interface AreaConflict {
  person_id: string;
  person_name: string;
  service_type: string;
  place_name: string;
  match_type: string;
}

/**
 * Service areas section for trapper detail.
 * Shows active/historical areas, add/remove with conflict detection.
 */
export function ServiceAreasSection({ personId, data, onDataChange }: SectionProps) {
  const { serviceAreas } = data;

  const [showAddArea, setShowAddArea] = useState(false);
  const [newAreaPlace, setNewAreaPlace] = useState<ResolvedPlace | null>(null);
  const [newAreaType, setNewAreaType] = useState("regular");
  const [addingArea, setAddingArea] = useState(false);
  const [areaConflicts, setAreaConflicts] = useState<AreaConflict[]>([]);

  const handleAddServiceArea = async () => {
    if (!newAreaPlace) return;
    setAddingArea(true);
    try {
      const result = await postApi<{ id: string; action: string; conflicts: AreaConflict[] }>(
        `/api/people/${personId}/service-areas`,
        { place_id: newAreaPlace.place_id, service_type: newAreaType }
      );
      if (result.conflicts && result.conflicts.length > 0) {
        setAreaConflicts(result.conflicts);
      } else {
        setAreaConflicts([]);
      }
      setNewAreaPlace(null);
      setNewAreaType("regular");
      setShowAddArea(false);
      onDataChange?.("trapper");
    } catch (err) {
      console.error("Failed to add service area:", err);
    } finally {
      setAddingArea(false);
    }
  };

  const handleRemoveServiceArea = async (areaId: string) => {
    try {
      await postApi(`/api/people/${personId}/service-areas`, { area_id: areaId }, { method: "DELETE" });
      onDataChange?.("trapper");
    } catch (err) {
      console.error("Failed to remove service area:", err);
    }
  };

  return (
    <>
      <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
        Places this trapper regularly covers or has worked.
      </p>

      {!showAddArea ? (
        <button onClick={() => setShowAddArea(true)} style={{ marginBottom: "1rem" }}>+ Add Service Area</button>
      ) : (
        <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px", marginBottom: "1rem" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <PlaceResolver value={newAreaPlace} onChange={setNewAreaPlace} placeholder="Search for a place..." />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Coverage Type</label>
            <select value={newAreaType} onChange={(e) => setNewAreaType(e.target.value)} style={{ width: "100%", padding: "0.5rem" }}>
              <option value="primary_territory">Primary Territory</option>
              <option value="regular">Regular</option>
              <option value="occasional">Occasional</option>
              <option value="home_rescue">Home Rescue</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={handleAddServiceArea} disabled={!newAreaPlace || addingArea}>{addingArea ? "Adding..." : "Add"}</button>
            <button onClick={() => { setShowAddArea(false); setNewAreaPlace(null); }} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Conflict warnings */}
      {areaConflicts.length > 0 && (
        <div style={{ padding: "0.75rem 1rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#92400e", marginBottom: "0.5rem" }}>Territory Overlap Detected</div>
          <div style={{ fontSize: "0.8rem", color: "#78350f" }}>
            {areaConflicts.map((c, i) => (
              <div key={i} style={{ marginBottom: "0.25rem" }}>
                <a href={`/trappers/${c.person_id}`} style={{ fontWeight: 500 }}>{c.person_name}</a>
                {" "}has <strong>{SERVICE_TYPE_LABELS[c.service_type] || c.service_type}</strong> coverage
                {c.match_type === "family" ? " at a related place" : " at the same place"}
              </div>
            ))}
          </div>
          <button onClick={() => setAreaConflicts([])} style={{ marginTop: "0.5rem", fontSize: "0.75rem", background: "transparent", border: "none", color: "#92400e", cursor: "pointer", textDecoration: "underline" }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Active areas */}
      {serviceAreas.filter(a => a.service_type !== "historical").length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {serviceAreas.filter(a => a.service_type !== "historical").map((area) => (
            <div key={area.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0.75rem 1rem", background: "var(--section-bg)", borderRadius: "8px",
              borderLeft: `4px solid ${SERVICE_TYPE_COLORS[area.service_type] || "#6c757d"}`,
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <a href={`/places/${area.place_id}`} style={{ fontWeight: 500 }}>{area.place_name}</a>
                  <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", background: SERVICE_TYPE_COLORS[area.service_type] || "#6c757d", color: "#fff", borderRadius: "4px" }}>
                    {SERVICE_TYPE_LABELS[area.service_type] || area.service_type}
                  </span>
                </div>
                {area.formatted_address && (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>{area.formatted_address}</div>
                )}
              </div>
              <button onClick={() => handleRemoveServiceArea(area.id)} title="Remove service area" style={{
                background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem", padding: "0.25rem",
              }}>
                x
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted">No active service areas.</p>
      )}

      {/* Historical areas */}
      {serviceAreas.filter(a => a.service_type === "historical").length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary className="text-muted text-sm" style={{ cursor: "pointer" }}>
            {serviceAreas.filter(a => a.service_type === "historical").length} historical area(s)
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
            {serviceAreas.filter(a => a.service_type === "historical").map((area) => (
              <div key={area.id} style={{ padding: "0.5rem 1rem", background: "#f1f3f5", borderRadius: "6px", opacity: 0.7, fontSize: "0.9rem" }}>
                <a href={`/places/${area.place_id}`}>{area.place_name}</a>
                {area.formatted_address && <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>— {area.formatted_address}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
