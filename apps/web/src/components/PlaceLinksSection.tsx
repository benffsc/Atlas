"use client";

import { useState, useEffect, useCallback } from "react";
import { EntityLink } from "./EntityLink";

interface PlaceEdge {
  edge_id: string;
  place_id_a: string;
  place_id_b: string;
  relationship_type_id: string;
  relationship_code: string;
  relationship_label: string;
  direction: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  related_place_id: string;
  related_place_address: string | null;
  related_place_name: string | null;
}

interface RelationshipType {
  id: string;
  code: string;
  label: string;
  description: string | null;
}

interface PlaceSearchResult {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  locality: string | null;
}

interface PlaceLinksSectionProps {
  placeId: string;
  placeName: string;
}

export function PlaceLinksSection({ placeId, placeName }: PlaceLinksSectionProps) {
  const [edges, setEdges] = useState<PlaceEdge[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add link modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSearchResult | null>(null);
  const [selectedRelType, setSelectedRelType] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete confirmation
  const [deletingEdge, setDeletingEdge] = useState<string | null>(null);

  const fetchEdges = useCallback(async () => {
    try {
      const response = await fetch(`/api/places/${placeId}/edges`);
      if (!response.ok) {
        throw new Error("Failed to fetch place links");
      }
      const data = await response.json();
      setEdges(data.edges || []);
      setRelationshipTypes(data.relationshipTypes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    fetchEdges();
  }, [fetchEdges]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/places?q=${encodeURIComponent(searchQuery)}&limit=10`);
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            // Filter out the current place and already linked places
            const linkedPlaceIds = new Set(edges.map(e => e.related_place_id));
            const filtered = (result.data.places || []).filter(
              (p: PlaceSearchResult) => p.place_id !== placeId && !linkedPlaceIds.has(p.place_id)
            );
            setSearchResults(filtered);
          }
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, placeId, edges]);

  const handleAddLink = async () => {
    if (!selectedPlace || !selectedRelType) {
      setSaveError("Please select a place and relationship type");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(`/api/places/${placeId}/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          related_place_id: selectedPlace.place_id,
          relationship_type: selectedRelType,
          note: linkNote || null,
          created_by: "web_user",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveError(result.error || "Failed to create link");
        return;
      }

      // Reset and close modal
      setShowAddModal(false);
      setSelectedPlace(null);
      setSelectedRelType("");
      setLinkNote("");
      setSearchQuery("");
      setSearchResults([]);

      // Refresh edges
      await fetchEdges();
    } catch (err) {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLink = async (edgeId: string) => {
    try {
      const response = await fetch(`/api/places/${placeId}/edges`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edge_id: edgeId,
          deleted_by: "web_user",
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        console.error("Delete failed:", result.error);
        return;
      }

      // Refresh edges
      await fetchEdges();
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setDeletingEdge(null);
    }
  };

  const relationshipColors: Record<string, string> = {
    same_colony_site: "#198754",
    adjacent_to: "#0d6efd",
    nearby_cluster: "#6f42c1",
  };

  if (loading) {
    return <p className="text-muted">Loading linked places...</p>;
  }

  if (error) {
    return <p style={{ color: "#dc3545" }}>{error}</p>;
  }

  return (
    <div>
      {/* Existing Links */}
      {edges.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
          {edges.map((edge) => (
            <div
              key={edge.edge_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "#f8f9fa",
                borderRadius: "8px",
                border: "1px solid #dee2e6",
              }}
            >
              <EntityLink
                href={`/places/${edge.related_place_id}`}
                label={edge.related_place_name || edge.related_place_address || "Unknown Place"}
                badge={edge.relationship_label}
                badgeColor={relationshipColors[edge.relationship_code] || "#6c757d"}
              />

              {edge.note && (
                <span className="text-muted text-sm" style={{ flex: 1 }}>
                  {edge.note}
                </span>
              )}

              {/* Delete button */}
              {deletingEdge === edge.edge_id ? (
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <button
                    onClick={() => handleDeleteLink(edge.edge_id)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.75rem",
                      background: "#dc3545",
                      color: "white",
                      border: "none",
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setDeletingEdge(null)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.75rem",
                      background: "transparent",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeletingEdge(edge.edge_id)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "#6c757d",
                  }}
                  title="Remove link"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted" style={{ marginBottom: "1rem" }}>
          No linked places. Link related sites (same colony, adjacent property) to combine colony data.
        </p>
      )}

      {/* Add Link Button */}
      {!showAddModal && (
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            padding: "0.5rem 1rem",
            background: "transparent",
            border: "1px solid var(--border)",
          }}
        >
          + Link to Another Place
        </button>
      )}

      {/* Add Link Modal */}
      {showAddModal && (
        <div
          style={{
            padding: "1rem",
            background: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: "8px",
            marginTop: "0.5rem",
          }}
        >
          <h4 style={{ marginTop: 0, marginBottom: "1rem" }}>Link {placeName} to Another Place</h4>

          {/* Search for place */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
              Search for a place
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type address or place name..."
              style={{ width: "100%" }}
              autoFocus
            />

            {/* Search results */}
            {searching && <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>Searching...</p>}

            {searchResults.length > 0 && !selectedPlace && (
              <div
                style={{
                  marginTop: "0.5rem",
                  border: "1px solid #dee2e6",
                  borderRadius: "6px",
                  maxHeight: "200px",
                  overflowY: "auto",
                  background: "white",
                }}
              >
                {searchResults.map((place) => (
                  <button
                    key={place.place_id}
                    onClick={() => {
                      setSelectedPlace(place);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "0.75rem 1rem",
                      border: "none",
                      borderBottom: "1px solid #dee2e6",
                      background: "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong>{place.display_name}</strong>
                    {place.formatted_address && place.formatted_address !== place.display_name && (
                      <span className="text-muted" style={{ display: "block", fontSize: "0.875rem" }}>
                        {place.formatted_address}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && !searching && !selectedPlace && (
              <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                No matching places found
              </p>
            )}
          </div>

          {/* Selected place */}
          {selectedPlace && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "#e8f5e9",
                border: "1px solid #4caf50",
                borderRadius: "6px",
                marginBottom: "1rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{selectedPlace.display_name}</strong>
                {selectedPlace.formatted_address && selectedPlace.formatted_address !== selectedPlace.display_name && (
                  <span className="text-muted" style={{ display: "block", fontSize: "0.875rem" }}>
                    {selectedPlace.formatted_address}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedPlace(null)}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.75rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                Change
              </button>
            </div>
          )}

          {/* Relationship type */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
              Relationship Type *
            </label>
            <select
              value={selectedRelType}
              onChange={(e) => setSelectedRelType(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select relationship...</option>
              {relationshipTypes.map((rt) => (
                <option key={rt.id} value={rt.code}>
                  {rt.label} {rt.description && `- ${rt.description}`}
                </option>
              ))}
            </select>
            {selectedRelType === "same_colony_site" && (
              <p className="text-sm" style={{ marginTop: "0.25rem", color: "#198754" }}>
                Use for multi-parcel operations (dairies, ranches) where cats move between addresses
              </p>
            )}
          </div>

          {/* Note */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
              Note (optional)
            </label>
            <input
              type="text"
              value={linkNote}
              onChange={(e) => setLinkNote(e.target.value)}
              placeholder="e.g., Single dairy operation spanning two parcels"
              style={{ width: "100%" }}
            />
          </div>

          {/* Error */}
          {saveError && (
            <p style={{ color: "#dc3545", marginBottom: "1rem" }}>{saveError}</p>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleAddLink}
              disabled={saving || !selectedPlace || !selectedRelType}
              style={{
                padding: "0.5rem 1rem",
                opacity: (!selectedPlace || !selectedRelType) ? 0.5 : 1,
              }}
            >
              {saving ? "Saving..." : "Create Link"}
            </button>
            <button
              onClick={() => {
                setShowAddModal(false);
                setSelectedPlace(null);
                setSelectedRelType("");
                setLinkNote("");
                setSearchQuery("");
                setSearchResults([]);
                setSaveError(null);
              }}
              disabled={saving}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                border: "1px solid var(--border)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlaceLinksSection;
