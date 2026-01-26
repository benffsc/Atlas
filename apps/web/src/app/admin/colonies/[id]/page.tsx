"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import AddressAutocomplete from "@/components/AddressAutocomplete";

interface PlaceSelectResult {
  place_id: string;
  formatted_address: string;
}

interface ColonyDetail {
  colony_id: string;
  colony_name: string;
  status: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  place_count: number;
  request_count: number;
  total_linked_cats: number;
  linked_community_cats: number;
  linked_owned_cats: number;
  linked_community_altered: number;
  linked_community_unaltered: number;
  observation_total_cats: number | null;
  total_cats_confidence: string | null;
  observation_fixed_cats: number | null;
  fixed_cats_confidence: string | null;
  latest_observation_date: string | null;
  has_count_discrepancy: boolean;
  discrepancy_amount: number | null;
  places: LinkedPlace[];
  requests: LinkedRequest[];
  observations: Observation[];
}

interface LinkedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  relationship_type: string;
  is_primary: boolean;
  added_by: string;
  added_at: string;
}

interface LinkedRequest {
  request_id: string;
  requester_name: string | null;
  formatted_address: string;
  status: string;
  estimated_cat_count: number | null;
  added_by: string;
  added_at: string;
}

interface Observation {
  observation_id: string;
  observation_date: string;
  total_cats: number | null;
  total_cats_confidence: string | null;
  fixed_cats: number | null;
  fixed_cats_confidence: string | null;
  unfixed_cats: number | null;
  notes: string | null;
  observed_by: string;
  created_at: string;
}

interface LinkedCat {
  cat_id: string;
  cat_name: string | null;
  microchip: string | null;
  sex: string | null;
  is_altered: boolean;
  place_address: string | null;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="detail-section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "#198754",
    monitored: "#0d6efd",
    resolved: "#6c757d",
    inactive: "#dc3545",
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.25rem 0.75rem",
        borderRadius: "4px",
        fontSize: "0.8rem",
        fontWeight: 500,
        background: `${colors[status] || "#6c757d"}20`,
        color: colors[status] || "#6c757d",
      }}
    >
      {status}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const colors: Record<string, string> = {
    verified: "#198754",
    high: "#0d6efd",
    medium: "#ffc107",
    low: "#dc3545",
  };

  return (
    <span
      style={{
        fontSize: "0.7rem",
        padding: "0.1rem 0.4rem",
        borderRadius: "3px",
        background: `${colors[confidence] || "#6c757d"}20`,
        color: colors[confidence] || "#6c757d",
        marginLeft: "0.5rem",
      }}
    >
      {confidence}
    </span>
  );
}

export default function ColonyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [colony, setColony] = useState<ColonyDetail | null>(null);
  const [cats, setCats] = useState<LinkedCat[]>([]);
  const [ownedCats, setOwnedCats] = useState<LinkedCat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Add place modal
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedPlaceAddress, setSelectedPlaceAddress] = useState("");
  const [addingPlace, setAddingPlace] = useState(false);

  // Add observation modal
  const [showAddObservation, setShowAddObservation] = useState(false);
  const [obsDate, setObsDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [obsTotalCats, setObsTotalCats] = useState("");
  const [obsTotalConfidence, setObsTotalConfidence] = useState("medium");
  const [obsFixedCats, setObsFixedCats] = useState("");
  const [obsFixedConfidence, setObsFixedConfidence] = useState("medium");
  const [obsNotes, setObsNotes] = useState("");
  const [addingObs, setAddingObs] = useState(false);
  const [obsWarning, setObsWarning] = useState<string | null>(null);

  const fetchColony = useCallback(async () => {
    try {
      const response = await fetch(`/api/colonies/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError("Colony not found");
          return;
        }
        throw new Error("Failed to fetch colony");
      }
      const data = await response.json();
      setColony(data);

      // Initialize edit form
      setEditName(data.colony_name);
      setEditStatus(data.status);
      setEditNotes(data.notes || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchCats = useCallback(async () => {
    try {
      const response = await fetch(`/api/colonies/${id}/cats`);
      if (response.ok) {
        const data = await response.json();
        setCats(data.cats || []);
        setOwnedCats(data.owned_cats || []);
      }
    } catch (err) {
      console.error("Failed to fetch cats:", err);
    }
  }, [id]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchColony(), fetchCats()]);
      setLoading(false);
    };
    loadData();
  }, [fetchColony, fetchCats]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/colonies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colony_name: editName,
          status: editStatus,
          notes: editNotes || null,
        }),
      });

      if (!response.ok) throw new Error("Failed to update colony");

      await fetchColony();
      setShowEditModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleAddPlace = async () => {
    if (!selectedPlaceId) return;

    setAddingPlace(true);
    try {
      const response = await fetch(`/api/colonies/${id}/places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: selectedPlaceId,
          is_primary: colony?.places.length === 0,
          added_by: "staff",
        }),
      });

      if (!response.ok) throw new Error("Failed to add place");

      await Promise.all([fetchColony(), fetchCats()]);
      setShowAddPlace(false);
      setSelectedPlaceId(null);
      setSelectedPlaceAddress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add place");
    } finally {
      setAddingPlace(false);
    }
  };

  const handleRemovePlace = async (placeId: string) => {
    if (!confirm("Remove this place from the colony?")) return;

    try {
      const response = await fetch(
        `/api/colonies/${id}/places?placeId=${placeId}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to remove place");

      await Promise.all([fetchColony(), fetchCats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove place");
    }
  };

  const handleAddObservation = async (override = false) => {
    setAddingObs(true);
    setObsWarning(null);

    try {
      const response = await fetch(`/api/colonies/${id}/observations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_date: obsDate,
          total_cats: obsTotalCats ? parseInt(obsTotalCats) : null,
          total_cats_confidence: obsTotalConfidence,
          fixed_cats: obsFixedCats ? parseInt(obsFixedCats) : null,
          fixed_cats_confidence: obsFixedConfidence,
          notes: obsNotes || null,
          observed_by: "staff",
          override_discrepancy: override,
        }),
      });

      const data = await response.json();

      if (data.warning && !override) {
        setObsWarning(data.message);
        setAddingObs(false);
        return;
      }

      if (!response.ok) throw new Error(data.error || "Failed to add observation");

      await fetchColony();
      setShowAddObservation(false);
      setObsTotalCats("");
      setObsFixedCats("");
      setObsNotes("");
      setObsWarning(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add observation");
    } finally {
      setAddingObs(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading colony...</div>;
  }

  if (error || !colony) {
    return (
      <div>
        <BackButton fallbackHref="/admin/colonies" />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error || "Colony not found"}</h2>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackButton fallbackHref="/admin/colonies" />

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginTop: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0 }}>{colony.colony_name}</h1>
            <StatusBadge status={colony.status} />
          </div>
          {colony.notes && (
            <p className="text-muted" style={{ marginTop: "0.5rem" }}>
              {colony.notes}
            </p>
          )}
        </div>
        <button onClick={() => setShowEditModal(true)}>Edit</button>
      </div>

      {/* Stats Summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "var(--card-bg)",
          borderRadius: "8px",
        }}
      >
        <div>
          <div className="text-muted text-sm">Places</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            {colony.place_count}
          </div>
        </div>
        <div>
          <div className="text-muted text-sm">Community Cats</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            {colony.linked_community_cats}
          </div>
        </div>
        <div>
          <div className="text-muted text-sm">Altered</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#198754" }}>
            {colony.linked_community_altered}
          </div>
        </div>
        <div>
          <div className="text-muted text-sm">Unaltered</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#dc3545" }}>
            {colony.linked_community_unaltered}
          </div>
        </div>
        {colony.linked_owned_cats > 0 && (
          <div>
            <div className="text-muted text-sm">Owned (excluded)</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
              {colony.linked_owned_cats}
            </div>
          </div>
        )}
      </div>

      {/* Discrepancy Warning */}
      {colony.has_count_discrepancy && (
        <div
          style={{
            padding: "1rem",
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: "8px",
            marginBottom: "1.5rem",
          }}
        >
          <strong>Discrepancy Detected:</strong> Staff observation (
          {colony.observation_total_cats} cats) is less than linked community
          cats ({colony.linked_community_cats}). Review the observation or check
          if some cats have left the colony.
        </div>
      )}

      {/* Linked Places */}
      <Section
        title="Linked Places"
        action={<button onClick={() => setShowAddPlace(true)}>+ Add Place</button>}
      >
        {colony.places.length === 0 ? (
          <p className="text-muted">No places linked yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Type</th>
                <th>Primary</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {colony.places.map((place) => (
                <tr key={place.place_id}>
                  <td>
                    <a href={`/places/${place.place_id}`}>
                      {place.display_name || place.formatted_address}
                    </a>
                  </td>
                  <td>{place.relationship_type}</td>
                  <td>{place.is_primary ? "Yes" : ""}</td>
                  <td>
                    <button
                      onClick={() => handleRemovePlace(place.place_id)}
                      style={{
                        background: "transparent",
                        color: "#dc3545",
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.8rem",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Cats */}
      <Section title={`Community Cats (${cats.length})`}>
        {cats.length === 0 ? (
          <p className="text-muted">
            No cats linked yet. Add places to see linked cats.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Microchip</th>
                <th>Sex</th>
                <th>Altered</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {cats.slice(0, 50).map((cat) => (
                <tr key={cat.cat_id}>
                  <td>
                    <a href={`/cats/${cat.cat_id}`}>{cat.cat_name || "Unknown"}</a>
                  </td>
                  <td>
                    <code style={{ fontSize: "0.8rem" }}>{cat.microchip}</code>
                  </td>
                  <td>{cat.sex}</td>
                  <td>{cat.is_altered ? "Yes" : "No"}</td>
                  <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                    {cat.place_address}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cats.length > 50 && (
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Showing first 50 of {cats.length} cats
          </p>
        )}
      </Section>

      {/* Observations */}
      <Section
        title="Staff Observations"
        action={
          <button onClick={() => setShowAddObservation(true)}>
            + Add Observation
          </button>
        }
      >
        {colony.observations.length === 0 ? (
          <p className="text-muted">No observations recorded yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Total Cats</th>
                <th>Fixed Cats</th>
                <th>Notes</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {colony.observations.map((obs) => (
                <tr key={obs.observation_id}>
                  <td>{new Date(obs.observation_date).toLocaleDateString()}</td>
                  <td>
                    {obs.total_cats ?? "-"}
                    <ConfidenceBadge confidence={obs.total_cats_confidence} />
                  </td>
                  <td>
                    {obs.fixed_cats ?? "-"}
                    <ConfidenceBadge confidence={obs.fixed_cats_confidence} />
                  </td>
                  <td className="text-muted">{obs.notes || "-"}</td>
                  <td className="text-muted">{obs.observed_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Edit Modal */}
      {showEditModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0" }}>Edit Colony</h2>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Status
              </label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="active">Active</option>
                <option value="monitored">Monitored</option>
                <option value="resolved">Resolved</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Notes
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setShowEditModal(false)}
                style={{ background: "transparent", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Place Modal */}
      {showAddPlace && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowAddPlace(false)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0" }}>Add Place to Colony</h2>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Search Address
              </label>
              <AddressAutocomplete
                value={selectedPlaceAddress}
                onChange={setSelectedPlaceAddress}
                onPlaceSelect={(place: PlaceSelectResult | null) => {
                  setSelectedPlaceId(place?.place_id || null);
                  setSelectedPlaceAddress(place?.formatted_address || "");
                }}
                placeholder="Type an address..."
              />
            </div>

            {selectedPlaceId && (
              <div
                style={{
                  padding: "0.75rem",
                  background: "rgba(25,135,84,0.1)",
                  borderRadius: "4px",
                  marginBottom: "1rem",
                }}
              >
                Selected: {selectedPlaceAddress}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleAddPlace} disabled={!selectedPlaceId || addingPlace}>
                {addingPlace ? "Adding..." : "Add Place"}
              </button>
              <button
                onClick={() => {
                  setShowAddPlace(false);
                  setSelectedPlaceId(null);
                  setSelectedPlaceAddress("");
                }}
                style={{ background: "transparent", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Observation Modal */}
      {showAddObservation && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => {
            setShowAddObservation(false);
            setObsWarning(null);
          }}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0" }}>Add Observation</h2>

            {obsWarning && (
              <div
                style={{
                  padding: "0.75rem",
                  background: "#fff3cd",
                  border: "1px solid #ffc107",
                  borderRadius: "4px",
                  marginBottom: "1rem",
                  fontSize: "0.9rem",
                }}
              >
                <strong>Warning:</strong> {obsWarning}
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    onClick={() => handleAddObservation(true)}
                    style={{ fontSize: "0.85rem", marginRight: "0.5rem" }}
                  >
                    Save Anyway
                  </button>
                  <button
                    onClick={() => setObsWarning(null)}
                    style={{
                      fontSize: "0.85rem",
                      background: "transparent",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Edit Values
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Observation Date
              </label>
              <input
                type="date"
                value={obsDate}
                onChange={(e) => setObsDate(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Total Cats
                </label>
                <input
                  type="number"
                  value={obsTotalCats}
                  onChange={(e) => setObsTotalCats(e.target.value)}
                  min="0"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Confidence
                </label>
                <select
                  value={obsTotalConfidence}
                  onChange={(e) => setObsTotalConfidence(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="verified">Verified (counted)</option>
                  <option value="high">High (reliable feeder)</option>
                  <option value="medium">Medium (estimate)</option>
                  <option value="low">Low (rough guess)</option>
                </select>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Fixed Cats
                </label>
                <input
                  type="number"
                  value={obsFixedCats}
                  onChange={(e) => setObsFixedCats(e.target.value)}
                  min="0"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Confidence
                </label>
                <select
                  value={obsFixedConfidence}
                  onChange={(e) => setObsFixedConfidence(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="verified">Verified (counted)</option>
                  <option value="high">High (reliable feeder)</option>
                  <option value="medium">Medium (estimate)</option>
                  <option value="low">Low (rough guess)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Notes
              </label>
              <textarea
                value={obsNotes}
                onChange={(e) => setObsNotes(e.target.value)}
                placeholder="Any additional context..."
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={() => handleAddObservation(false)} disabled={addingObs}>
                {addingObs ? "Saving..." : "Save Observation"}
              </button>
              <button
                onClick={() => {
                  setShowAddObservation(false);
                  setObsWarning(null);
                }}
                style={{ background: "transparent", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
