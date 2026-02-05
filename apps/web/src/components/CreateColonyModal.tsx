"use client";

import { useState, useEffect } from "react";
import { formatPhone } from "@/lib/formatters";

interface CreateColonyModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId?: string;
  placeId?: string;
  staffName?: string;
  onSuccess?: (result: { colony_id: string; colony_name: string }) => void;
}

interface SuggestedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  distance_m: number;
  cat_count: number;
  person_count: number;
  has_active_request: boolean;
  google_entry_count: number;
  is_primary: boolean;
  relationship_type: string;
}

interface SuggestedPerson {
  person_id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  place_address: string | null;
  distance_m: number;
  relationship_to_place: string | null;
  suggested_role: string;
  role_confidence: number;
  role_evidence: string[];
}

interface GoogleContextEntry {
  entry_id: string;
  kml_name: string | null;
  ai_meaning: string | null;
  ai_summary: string | null;
  parsed_date: string | null;
}

interface SuggestionResponse {
  source_type: "request" | "place";
  source_id: string;
  center: { lat: number; lng: number } | null;
  suggested_name: string;
  name_alternatives: string[];
  suggested_places: SuggestedPlace[];
  suggested_people: SuggestedPerson[];
  google_context: GoogleContextEntry[];
  summary: {
    total_nearby_places: number;
    total_nearby_people: number;
    total_nearby_cats: number;
    has_disease_risk: boolean;
    has_watch_list: boolean;
    area_description: string;
  };
}

const COLONY_ROLES = [
  { value: "primary_feeder", label: "Primary Feeder" },
  { value: "feeder", label: "Feeder" },
  { value: "reporter", label: "Reporter" },
  { value: "contact", label: "Contact" },
  { value: "property_owner", label: "Property Owner" },
  { value: "trapper_assigned", label: "Assigned Trapper" },
  { value: "trapper_volunteer", label: "Volunteer Trapper" },
  { value: "coordinator", label: "Coordinator" },
  { value: "veterinary_contact", label: "Veterinary Contact" },
  { value: "other", label: "Other" },
];

const RELATIONSHIP_TYPES = [
  { value: "primary_location", label: "Primary Location" },
  { value: "nearby_location", label: "Nearby Location" },
  { value: "feeding_station", label: "Feeding Station" },
  { value: "expansion_area", label: "Expansion Area" },
];

export function CreateColonyModal({
  isOpen,
  onClose,
  requestId,
  placeId,
  staffName,
  onSuccess,
}: CreateColonyModalProps) {
  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggestion data
  const [suggestions, setSuggestions] = useState<SuggestionResponse | null>(null);

  // Form state
  const [colonyName, setColonyName] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPlaces, setSelectedPlaces] = useState<
    Map<string, { is_primary: boolean; relationship_type: string }>
  >(new Map());
  const [selectedPeople, setSelectedPeople] = useState<
    Map<string, { role_type: string; notes: string }>
  >(new Map());

  // UI state
  const [activeTab, setActiveTab] = useState<"places" | "people" | "context">("places");
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);

  // Fetch suggestions when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchSuggestions = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (requestId) params.set("request_id", requestId);
        else if (placeId) params.set("place_id", placeId);

        const response = await fetch(`/api/colonies/suggest-details?${params}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to fetch suggestions");
        }

        const data: SuggestionResponse = await response.json();
        setSuggestions(data);

        // Pre-fill form with suggestions
        setColonyName(data.suggested_name);

        // Select primary place and nearby places with activity
        const placesMap = new Map<
          string,
          { is_primary: boolean; relationship_type: string }
        >();
        data.suggested_places.forEach((place) => {
          if (place.is_primary || place.cat_count > 0 || place.google_entry_count > 0) {
            placesMap.set(place.place_id, {
              is_primary: place.is_primary,
              relationship_type: place.relationship_type,
            });
          }
        });
        setSelectedPlaces(placesMap);

        // Select people with high confidence roles
        const peopleMap = new Map<string, { role_type: string; notes: string }>();
        data.suggested_people.forEach((person) => {
          if (person.role_confidence >= 0.7) {
            peopleMap.set(person.person_id, {
              role_type: person.suggested_role,
              notes: "",
            });
          }
        });
        setSelectedPeople(peopleMap);

        // Generate initial notes if there's context
        if (data.summary.has_disease_risk || data.summary.has_watch_list) {
          const notesParts: string[] = [];
          if (data.summary.has_disease_risk) {
            notesParts.push("Disease risk noted in historical data.");
          }
          if (data.summary.has_watch_list) {
            notesParts.push("On watch list.");
          }
          setNotes(notesParts.join(" "));
        } else {
          setNotes("");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load suggestions");
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [isOpen, requestId, placeId]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSuggestions(null);
      setColonyName("");
      setNotes("");
      setSelectedPlaces(new Map());
      setSelectedPeople(new Map());
      setActiveTab("places");
      setExpandedPerson(null);
      setError(null);
    }
  }, [isOpen]);

  const togglePlace = (placeId: string, place: SuggestedPlace) => {
    setSelectedPlaces((prev) => {
      const next = new Map(prev);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.set(placeId, {
          is_primary: place.is_primary,
          relationship_type: place.relationship_type,
        });
      }
      return next;
    });
  };

  const updatePlaceRelationship = (placeId: string, relationship: string) => {
    setSelectedPlaces((prev) => {
      const next = new Map(prev);
      const current = next.get(placeId);
      if (current) {
        next.set(placeId, { ...current, relationship_type: relationship });
      }
      return next;
    });
  };

  const togglePerson = (personId: string, person: SuggestedPerson) => {
    setSelectedPeople((prev) => {
      const next = new Map(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.set(personId, {
          role_type: person.suggested_role,
          notes: "",
        });
      }
      return next;
    });
  };

  const updatePersonRole = (personId: string, role: string) => {
    setSelectedPeople((prev) => {
      const next = new Map(prev);
      const current = next.get(personId);
      if (current) {
        next.set(personId, { ...current, role_type: role });
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!colonyName.trim()) {
      setError("Colony name is required");
      return;
    }

    if (selectedPlaces.size === 0) {
      setError("At least one place must be selected");
      return;
    }

    setSubmitting(true);

    try {
      // Create colony
      const createResponse = await fetch("/api/colonies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colony_name: colonyName.trim(),
          status: "active",
          notes: notes.trim() || null,
          created_by: staffName || "Unknown",
        }),
      });

      if (!createResponse.ok) {
        const data = await createResponse.json();
        throw new Error(data.error || "Failed to create colony");
      }

      const { colony_id } = await createResponse.json();

      // Add places
      for (const [place_id, { is_primary, relationship_type }] of selectedPlaces) {
        await fetch(`/api/colonies/${colony_id}/places`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            place_id,
            is_primary,
            relationship_type,
            added_by: staffName || "Unknown",
          }),
        });
      }

      // Add people
      for (const [person_id, { role_type, notes: personNotes }] of selectedPeople) {
        await fetch(`/api/colonies/${colony_id}/people`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person_id,
            role_type,
            notes: personNotes || null,
            assigned_by: staffName || "Unknown",
          }),
        });
      }

      // Link request if applicable
      if (requestId) {
        await fetch(`/api/colonies/${colony_id}/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_id: requestId,
            added_by: staffName || "Unknown",
          }),
        });
      }

      onSuccess?.({ colony_id, colony_name: colonyName.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create colony");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "720px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--card-border, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>Create Colony</div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {suggestions?.summary.area_description || "Loading suggestions..."}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "var(--text-muted)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Loading State */}
        {loading ? (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "var(--muted)",
            }}
          >
            <div style={{ fontSize: "1.5rem", marginBottom: "12px" }}>Loading...</div>
            <div>Analyzing nearby data and generating suggestions</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Error Banner */}
            {error && (
              <div
                style={{
                  background: "#f8d7da",
                  border: "1px solid #f5c6cb",
                  color: "#721c24",
                  padding: "12px 20px",
                  fontSize: "0.9rem",
                }}
              >
                {error}
              </div>
            )}

            {/* Warnings */}
            {suggestions?.summary.has_disease_risk && (
              <div
                style={{
                  background: "#fff3cd",
                  borderBottom: "1px solid #ffc107",
                  color: "#856404",
                  padding: "10px 20px",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>⚠️</span>
                Disease risk noted in historical data for this area
              </div>
            )}

            {/* Colony Name Section */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--card-border, #e5e7eb)" }}>
              <label style={labelStyle}>
                Colony Name <span style={{ color: "#dc3545" }}>*</span>
              </label>
              <input
                type="text"
                value={colonyName}
                onChange={(e) => setColonyName(e.target.value)}
                style={inputStyle}
                placeholder="Enter colony name..."
                autoFocus
                required
              />
              {suggestions?.name_alternatives && suggestions.name_alternatives.length > 1 && (
                <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Suggestions:</span>
                  {suggestions.name_alternatives.slice(0, 4).map((alt) => (
                    <button
                      key={alt}
                      type="button"
                      onClick={() => setColonyName(alt)}
                      style={{
                        padding: "4px 10px",
                        background: colonyName === alt ? "#e3f2fd" : "var(--section-bg, #f5f5f5)",
                        border: "1px solid var(--border, #ddd)",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                      }}
                    >
                      {alt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tabs */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--card-border, #e5e7eb)",
                padding: "0 20px",
              }}
            >
              {[
                { id: "places", label: `Places (${selectedPlaces.size})` },
                { id: "people", label: `People (${selectedPeople.size})` },
                { id: "context", label: "Context" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  style={{
                    padding: "12px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: activeTab === tab.id ? "2px solid var(--primary, #0d6efd)" : "2px solid transparent",
                    fontWeight: activeTab === tab.id ? 600 : 400,
                    cursor: "pointer",
                    color: activeTab === tab.id ? "var(--primary, #0d6efd)" : "var(--muted)",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
              {/* Places Tab */}
              {activeTab === "places" && (
                <div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "12px" }}>
                    Select locations to include in this colony. The primary location is highlighted.
                  </div>
                  {suggestions?.suggested_places.map((place) => {
                    const isSelected = selectedPlaces.has(place.place_id);
                    const selection = selectedPlaces.get(place.place_id);

                    return (
                      <div
                        key={place.place_id}
                        style={{
                          padding: "12px",
                          marginBottom: "8px",
                          background: isSelected
                            ? place.is_primary
                              ? "#d4edda"
                              : "#e3f2fd"
                            : "var(--section-bg, #f9f9f9)",
                          border: `1px solid ${isSelected ? (place.is_primary ? "#c3e6cb" : "#90caf9") : "var(--border, #ddd)"}`,
                          borderRadius: "8px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePlace(place.place_id, place)}
                            style={{ marginTop: "4px", width: "18px", height: "18px" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500 }}>
                              {place.display_name || place.formatted_address.split(",")[0]}
                              {place.is_primary && (
                                <span
                                  style={{
                                    marginLeft: "8px",
                                    background: "#198754",
                                    color: "#fff",
                                    padding: "2px 8px",
                                    borderRadius: "10px",
                                    fontSize: "0.7rem",
                                  }}
                                >
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                              {place.formatted_address}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "4px" }}>
                              {place.distance_m}m away
                              {place.cat_count > 0 && ` • ${place.cat_count} cats`}
                              {place.person_count > 0 && ` • ${place.person_count} people`}
                              {place.google_entry_count > 0 && ` • ${place.google_entry_count} historical notes`}
                              {place.has_active_request && " • Active request"}
                            </div>

                            {isSelected && (
                              <div style={{ marginTop: "8px" }}>
                                <select
                                  value={selection?.relationship_type || "nearby_location"}
                                  onChange={(e) => updatePlaceRelationship(place.place_id, e.target.value)}
                                  style={{ ...inputStyle, padding: "6px 8px", fontSize: "0.8rem" }}
                                >
                                  {RELATIONSHIP_TYPES.map((rt) => (
                                    <option key={rt.value} value={rt.value}>
                                      {rt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!suggestions?.suggested_places || suggestions.suggested_places.length === 0) && (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                      No nearby places found
                    </div>
                  )}
                </div>
              )}

              {/* People Tab */}
              {activeTab === "people" && (
                <div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "12px" }}>
                    Select people involved with this colony and assign their roles.
                  </div>
                  {suggestions?.suggested_people.map((person) => {
                    const isSelected = selectedPeople.has(person.person_id);
                    const selection = selectedPeople.get(person.person_id);
                    const isExpanded = expandedPerson === person.person_id;

                    return (
                      <div
                        key={person.person_id}
                        style={{
                          padding: "12px",
                          marginBottom: "8px",
                          background: isSelected ? "#e3f2fd" : "var(--section-bg, #f9f9f9)",
                          border: `1px solid ${isSelected ? "#90caf9" : "var(--border, #ddd)"}`,
                          borderRadius: "8px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePerson(person.person_id, person)}
                            style={{ marginTop: "4px", width: "18px", height: "18px" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontWeight: 500 }}>{person.display_name}</span>
                              <span
                                style={{
                                  background:
                                    person.role_confidence >= 0.8
                                      ? "#198754"
                                      : person.role_confidence >= 0.6
                                      ? "#ffc107"
                                      : "#6c757d",
                                  color: person.role_confidence >= 0.6 && person.role_confidence < 0.8 ? "#000" : "#fff",
                                  padding: "2px 8px",
                                  borderRadius: "10px",
                                  fontSize: "0.7rem",
                                }}
                              >
                                {COLONY_ROLES.find((r) => r.value === person.suggested_role)?.label || person.suggested_role}
                              </span>
                            </div>

                            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                              {person.primary_phone && <span>{formatPhone(person.primary_phone)}</span>}
                              {person.primary_phone && person.primary_email && " • "}
                              {person.primary_email && <span>{person.primary_email}</span>}
                            </div>

                            {person.place_address && (
                              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "2px" }}>
                                {person.place_address} ({person.distance_m}m)
                              </div>
                            )}

                            {/* Role Evidence */}
                            {person.role_evidence.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpandedPerson(isExpanded ? null : person.person_id)}
                                style={{
                                  marginTop: "6px",
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  fontSize: "0.75rem",
                                  color: "var(--primary, #0d6efd)",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                {isExpanded ? "Hide evidence" : "Show role evidence"}
                              </button>
                            )}

                            {isExpanded && (
                              <div
                                style={{
                                  marginTop: "8px",
                                  padding: "8px",
                                  background: "rgba(0,0,0,0.05)",
                                  borderRadius: "4px",
                                  fontSize: "0.75rem",
                                }}
                              >
                                {person.role_evidence.map((ev, i) => (
                                  <div key={i} style={{ marginBottom: "4px" }}>
                                    • {ev}
                                  </div>
                                ))}
                              </div>
                            )}

                            {isSelected && (
                              <div style={{ marginTop: "10px" }}>
                                <select
                                  value={selection?.role_type || person.suggested_role}
                                  onChange={(e) => updatePersonRole(person.person_id, e.target.value)}
                                  style={{ ...inputStyle, padding: "6px 8px", fontSize: "0.8rem" }}
                                >
                                  {COLONY_ROLES.map((role) => (
                                    <option key={role.value} value={role.value}>
                                      {role.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!suggestions?.suggested_people || suggestions.suggested_people.length === 0) && (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                      No nearby people found
                    </div>
                  )}
                </div>
              )}

              {/* Context Tab */}
              {activeTab === "context" && (
                <div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "12px" }}>
                    Historical Google Maps data for this area. Review for disease risks or special notes.
                  </div>

                  {suggestions?.google_context.map((entry) => (
                    <div
                      key={entry.entry_id}
                      style={{
                        padding: "12px",
                        marginBottom: "8px",
                        background:
                          entry.ai_meaning === "disease_risk" || entry.ai_meaning === "felv_colony" || entry.ai_meaning === "fiv_colony"
                            ? "#fff3cd"
                            : entry.ai_meaning === "watch_list"
                            ? "#f3e8ff"
                            : "var(--section-bg, #f9f9f9)",
                        border: `1px solid ${
                          entry.ai_meaning === "disease_risk" || entry.ai_meaning === "felv_colony" || entry.ai_meaning === "fiv_colony"
                            ? "#ffc107"
                            : entry.ai_meaning === "watch_list"
                            ? "#8b5cf6"
                            : "var(--border, #ddd)"
                        }`,
                        borderRadius: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div style={{ fontWeight: 500 }}>{entry.kml_name || "Historical Note"}</div>
                        {entry.ai_meaning && (
                          <span
                            style={{
                              background:
                                entry.ai_meaning === "disease_risk" || entry.ai_meaning === "felv_colony" || entry.ai_meaning === "fiv_colony"
                                  ? "#ea580c"
                                  : entry.ai_meaning === "watch_list"
                                  ? "#8b5cf6"
                                  : "#6b7280",
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              fontSize: "0.7rem",
                            }}
                          >
                            {entry.ai_meaning.replace(/_/g, " ").toUpperCase()}
                          </span>
                        )}
                      </div>
                      {entry.parsed_date && (
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "4px" }}>
                          {new Date(entry.parsed_date).toLocaleDateString()}
                        </div>
                      )}
                      {entry.ai_summary && (
                        <div style={{ fontSize: "0.85rem", marginTop: "8px", lineHeight: 1.4 }}>
                          {entry.ai_summary}
                        </div>
                      )}
                    </div>
                  ))}

                  {(!suggestions?.google_context || suggestions.google_context.length === 0) && (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                      No historical context found for this area
                    </div>
                  )}

                  {/* Notes field */}
                  <div style={{ marginTop: "20px" }}>
                    <label style={labelStyle}>Colony Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical" }}
                      placeholder="Add any additional notes about this colony..."
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid var(--card-border, #e5e7eb)",
                display: "flex",
                gap: "12px",
                background: "var(--card-bg, #fff)",
              }}
            >
              <button type="button" onClick={onClose} disabled={submitting} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button type="submit" disabled={submitting || selectedPlaces.size === 0} style={primaryButtonStyle(submitting)}>
                {submitting ? "Creating..." : `Create Colony (${selectedPlaces.size} places, ${selectedPeople.size} people)`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Styles
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 500,
  marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--card-border, #e5e7eb)",
  borderRadius: "8px",
  fontSize: "0.9rem",
  background: "var(--background, #fff)",
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "14px",
  background: disabled ? "#9ca3af" : "var(--primary, #198754)",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 600,
  fontSize: "0.95rem",
});

const secondaryButtonStyle: React.CSSProperties = {
  flex: 0,
  padding: "14px 24px",
  background: "var(--bg-tertiary, #f5f5f5)",
  color: "var(--text, #333)",
  border: "1px solid var(--border, #ddd)",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: "0.95rem",
};

export default CreateColonyModal;
