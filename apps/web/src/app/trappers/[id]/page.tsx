"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { TrapperBadge } from "@/components/badges";
import { TrapperStatsCard } from "@/components/cards";
import { BackButton } from "@/components/common";
import PlaceResolver, { type ResolvedPlace } from "@/components/forms/PlaceResolver";
import { fetchApi, postApi, ApiError } from "@/lib/api-client";

interface TrapperStats {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_site_visits: number;
  assessment_visits: number;
  first_visit_success_rate_pct: number | null;
  cats_from_visits: number;
  cats_from_assignments: number;
  cats_altered_from_assignments: number;
  manual_catches: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  spayed_count: number;
  neutered_count: number;
  total_altered: number;
  felv_tested_count: number;
  felv_positive_count: number;
  felv_positive_rate_pct: number | null;
  first_clinic_date: string | null;
  last_clinic_date: string | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

interface ManualCatch {
  catch_id: string;
  cat_id: string | null;
  microchip: string | null;
  catch_date: string;
  catch_location: string | null;
  notes: string | null;
  cat_name: string | null;
  created_at: string;
}

interface ServiceArea {
  id: string;
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  service_type: string;
  notes: string | null;
  source_system: string | null;
  created_at: string;
}

interface TrapperProfile {
  person_id: string;
  trapper_type: string | null;
  rescue_name: string | null;
  is_active: boolean;
  certified_date: string | null;
  notes: string | null;
  has_signed_contract: boolean;
  contract_signed_date: string | null;
  contract_areas: string[] | null;
  is_legacy_informal: boolean;
  tier: string | null;
  source_system: string | null;
}

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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="detail-section">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export default function TrapperDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [stats, setStats] = useState<TrapperStats | null>(null);
  const [manualCatches, setManualCatches] = useState<ManualCatch[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [profile, setProfile] = useState<TrapperProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Service area form state
  const [showAddArea, setShowAddArea] = useState(false);
  const [newAreaPlace, setNewAreaPlace] = useState<ResolvedPlace | null>(null);
  const [newAreaType, setNewAreaType] = useState("regular");
  const [addingArea, setAddingArea] = useState(false);

  // Add catch form state
  const [showAddCatch, setShowAddCatch] = useState(false);
  const [newMicrochip, setNewMicrochip] = useState("");
  const [newCatchDate, setNewCatchDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [newNotes, setNewNotes] = useState("");
  const [addingCatch, setAddingCatch] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [editProfile, setEditProfile] = useState<{
    notes: string;
    rescue_name: string;
    has_signed_contract: boolean;
    contract_signed_date: string;
    contract_areas: string;
  }>({ notes: "", rescue_name: "", has_signed_contract: false, contract_signed_date: "", contract_areas: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await fetchApi<TrapperStats>(`/api/people/${id}/trapper-stats`);
      setStats(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 404) {
        setError("Not a trapper or trapper not found");
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchManualCatches = useCallback(async () => {
    try {
      const data = await fetchApi<{ catches: ManualCatch[] }>(`/api/people/${id}/trapper-cats`);
      setManualCatches(data.catches || []);
    } catch (err) {
      console.error("Failed to fetch manual catches:", err);
    }
  }, [id]);

  const fetchServiceAreas = useCallback(async () => {
    try {
      const data = await fetchApi<{ areas: ServiceArea[] }>(`/api/people/${id}/service-areas`);
      setServiceAreas(data.areas || []);
    } catch (err) {
      console.error("Failed to fetch service areas:", err);
    }
  }, [id]);

  const fetchProfile = useCallback(async () => {
    try {
      const data = await fetchApi<{ profile: TrapperProfile | null }>(`/api/people/${id}/trapper-profile`);
      setProfile(data.profile);
    } catch (err) {
      console.error("Failed to fetch trapper profile:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchStats(), fetchManualCatches(), fetchServiceAreas(), fetchProfile()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchStats, fetchManualCatches, fetchServiceAreas, fetchProfile]);

  const handleAddServiceArea = async () => {
    if (!newAreaPlace) return;
    setAddingArea(true);
    try {
      await postApi(`/api/people/${id}/service-areas`, {
        place_id: newAreaPlace.place_id,
        service_type: newAreaType,
      });
      await fetchServiceAreas();
      setNewAreaPlace(null);
      setNewAreaType("regular");
      setShowAddArea(false);
    } catch (err) {
      console.error("Failed to add service area:", err);
    } finally {
      setAddingArea(false);
    }
  };

  const handleRemoveServiceArea = async (areaId: string) => {
    try {
      await postApi(`/api/people/${id}/service-areas`, { area_id: areaId }, { method: "DELETE" });
      await fetchServiceAreas();
    } catch (err) {
      console.error("Failed to remove service area:", err);
    }
  };

  const handleAddCatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMicrochip.trim()) {
      setAddError("Microchip is required");
      return;
    }

    setAddingCatch(true);
    setAddError(null);

    try {
      await postApi(`/api/people/${id}/trapper-cats`, {
        microchip: newMicrochip.trim(),
        catch_date: newCatchDate,
        notes: newNotes.trim() || null,
      });

      // Refresh data
      await Promise.all([fetchStats(), fetchManualCatches()]);

      // Reset form
      setNewMicrochip("");
      setNewNotes("");
      setShowAddCatch(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Network error");
    } finally {
      setAddingCatch(false);
    }
  };

  const startEditProfile = () => {
    if (!profile) return;
    setEditProfile({
      notes: profile.notes || "",
      rescue_name: profile.rescue_name || "",
      has_signed_contract: profile.has_signed_contract,
      contract_signed_date: profile.contract_signed_date || "",
      contract_areas: (profile.contract_areas || []).join(", "),
    });
    setEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const areas = editProfile.contract_areas
        .split(",")
        .map(a => a.trim())
        .filter(Boolean);

      await postApi(`/api/people/${id}/trapper-profile`, {
        notes: editProfile.notes || null,
        rescue_name: editProfile.rescue_name || null,
        has_signed_contract: editProfile.has_signed_contract,
        contract_signed_date: editProfile.contract_signed_date || null,
        contract_areas: areas.length > 0 ? areas : null,
      }, { method: "PATCH" });

      await fetchProfile();
      setEditingProfile(false);
    } catch (err) {
      console.error("Failed to save profile:", err);
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading trapper details...</div>;
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/trappers" />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Person ID: <code>{id}</code>
          </p>
          <a href={`/people/${id}`} style={{ marginTop: "1rem" }}>
            View as person record instead
          </a>
        </div>
      </div>
    );
  }

  if (!stats) {
    return <div className="empty">Trapper not found</div>;
  }

  return (
    <div>
      <BackButton fallbackHref="/trappers" />

      {/* Header */}
      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0 }}>{stats.display_name}</h1>
          <TrapperBadge trapperType={stats.trapper_type} />
        </div>
        <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
          <a href={`/people/${id}`}>View person record</a>
        </p>
      </div>

      {/* Contract & Profile — FFS-532 */}
      {profile && (
        <Section title="Contract & Profile">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
            {!editingProfile ? (
              <button
                onClick={startEditProfile}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.35rem 0.75rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Edit Profile
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}
                >
                  {savingProfile ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditingProfile(false)}
                  disabled={savingProfile}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.35rem 0.75rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {!editingProfile ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
                {/* Contract Status */}
                <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Contract
                  </div>
                  <span style={{
                    display: "inline-block",
                    padding: "0.25rem 0.75rem",
                    borderRadius: "9999px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    background: profile.has_signed_contract ? "#dcfce7" : "#fee2e2",
                    color: profile.has_signed_contract ? "#166534" : "#b91c1c",
                  }}>
                    {profile.has_signed_contract ? "Signed" : "Not Signed"}
                  </span>
                  {profile.contract_signed_date && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                      {new Date(profile.contract_signed_date).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Tier */}
                <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Classification
                  </div>
                  <div style={{ fontWeight: 500 }}>
                    {profile.tier || "—"}
                  </div>
                  {profile.is_legacy_informal && (
                    <div style={{ fontSize: "0.8rem", color: "#b45309", marginTop: "0.25rem" }}>
                      Legacy informal
                    </div>
                  )}
                  {profile.rescue_name && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      Rescue: {profile.rescue_name}
                    </div>
                  )}
                </div>

                {/* Status */}
                <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Status
                  </div>
                  <span style={{
                    display: "inline-block",
                    padding: "0.25rem 0.75rem",
                    borderRadius: "9999px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    background: profile.is_active ? "#dcfce7" : "#fee2e2",
                    color: profile.is_active ? "#166534" : "#b91c1c",
                  }}>
                    {profile.is_active ? "Active" : "Inactive"}
                  </span>
                  {profile.certified_date && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                      Certified: {new Date(profile.certified_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Notes / Availability */}
              {profile.notes && (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Notes & Availability
                  </div>
                  <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>
                    {profile.notes}
                  </div>
                </div>
              )}

              {/* Contract Areas */}
              {profile.contract_areas && profile.contract_areas.length > 0 && (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Contracted Areas
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {profile.contract_areas.map((area, i) => (
                      <span key={i} style={{
                        padding: "0.25rem 0.5rem",
                        background: "#e2e8f0",
                        borderRadius: "4px",
                        fontSize: "0.85rem",
                      }}>
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Edit mode form */
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Contract signed */}
              <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editProfile.has_signed_contract}
                    onChange={(e) => setEditProfile(prev => ({ ...prev, has_signed_contract: e.target.checked }))}
                  />
                  <span style={{ fontWeight: 500 }}>Contract Signed</span>
                </label>
                {editProfile.has_signed_contract && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                      Date Signed
                    </label>
                    <input
                      type="date"
                      value={editProfile.contract_signed_date}
                      onChange={(e) => setEditProfile(prev => ({ ...prev, contract_signed_date: e.target.value }))}
                      style={{ padding: "0.4rem", width: "200px" }}
                    />
                  </div>
                )}
              </div>

              {/* Contract Areas */}
              <div>
                <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  Contract Areas
                </label>
                <textarea
                  value={editProfile.contract_areas}
                  onChange={(e) => setEditProfile(prev => ({ ...prev, contract_areas: e.target.value }))}
                  placeholder="Comma-separated areas (e.g. Santa Rosa, Petaluma, Rohnert Park)"
                  rows={2}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  Separate multiple areas with commas
                </div>
              </div>

              {/* Rescue Name */}
              <div>
                <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  Rescue Name
                </label>
                <input
                  type="text"
                  value={editProfile.rescue_name}
                  onChange={(e) => setEditProfile(prev => ({ ...prev, rescue_name: e.target.value }))}
                  placeholder="e.g. Cat Rescue of Cloverdale"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Notes */}
              <div>
                <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  Notes & Availability
                </label>
                <textarea
                  value={editProfile.notes}
                  onChange={(e) => setEditProfile(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Availability, preferences, special notes..."
                  rows={4}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Statistics */}
      <Section title="Statistics">
        <TrapperStatsCard personId={id} />
      </Section>

      {/* Service Areas — FFS-530 */}
      <Section title="Service Areas">
        <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          Places this trapper regularly covers or has worked.
        </p>

        {!showAddArea ? (
          <button
            onClick={() => setShowAddArea(true)}
            style={{ marginBottom: "1rem" }}
          >
            + Add Service Area
          </button>
        ) : (
          <div style={{
            padding: "1rem",
            background: "#f8f9fa",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}>
            <div style={{ marginBottom: "0.75rem" }}>
              <PlaceResolver
                value={newAreaPlace}
                onChange={setNewAreaPlace}
                placeholder="Search for a place..."
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Coverage Type
              </label>
              <select
                value={newAreaType}
                onChange={(e) => setNewAreaType(e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                <option value="primary_territory">Primary Territory</option>
                <option value="regular">Regular</option>
                <option value="occasional">Occasional</option>
                <option value="home_rescue">Home Rescue</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleAddServiceArea} disabled={!newAreaPlace || addingArea}>
                {addingArea ? "Adding..." : "Add"}
              </button>
              <button
                onClick={() => { setShowAddArea(false); setNewAreaPlace(null); }}
                style={{ background: "transparent", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {serviceAreas.filter(a => a.service_type !== "historical").length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {serviceAreas
              .filter((a) => a.service_type !== "historical")
              .map((area) => (
                <div
                  key={area.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 1rem",
                    background: "#f8f9fa",
                    borderRadius: "8px",
                    borderLeft: `4px solid ${SERVICE_TYPE_COLORS[area.service_type] || "#6c757d"}`,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <a href={`/places/${area.place_id}`} style={{ fontWeight: 500 }}>
                        {area.place_name}
                      </a>
                      <span style={{
                        fontSize: "0.7rem",
                        padding: "0.125rem 0.5rem",
                        background: SERVICE_TYPE_COLORS[area.service_type] || "#6c757d",
                        color: "#fff",
                        borderRadius: "4px",
                      }}>
                        {SERVICE_TYPE_LABELS[area.service_type] || area.service_type}
                      </span>
                    </div>
                    {area.formatted_address && (
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                        {area.formatted_address}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveServiceArea(area.id)}
                    title="Remove service area"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "1.1rem",
                      padding: "0.25rem",
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-muted">No active service areas.</p>
        )}

        {/* Historical areas (collapsed) */}
        {serviceAreas.filter(a => a.service_type === "historical").length > 0 && (
          <details style={{ marginTop: "1rem" }}>
            <summary className="text-muted text-sm" style={{ cursor: "pointer" }}>
              {serviceAreas.filter(a => a.service_type === "historical").length} historical area(s)
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              {serviceAreas
                .filter((a) => a.service_type === "historical")
                .map((area) => (
                  <div
                    key={area.id}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "#f1f3f5",
                      borderRadius: "6px",
                      opacity: 0.7,
                      fontSize: "0.9rem",
                    }}
                  >
                    <a href={`/places/${area.place_id}`}>{area.place_name}</a>
                    {area.formatted_address && (
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>
                        — {area.formatted_address}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </details>
        )}
      </Section>

      {/* Manual Catches */}
      <Section title="Manual Catches">
        <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          Track cats caught outside of formal FFR requests by entering their
          microchip numbers.
        </p>

        {!showAddCatch ? (
          <button
            onClick={() => setShowAddCatch(true)}
            style={{ marginBottom: "1rem" }}
          >
            + Add Manual Catch
          </button>
        ) : (
          <form
            onSubmit={handleAddCatch}
            style={{
              padding: "1rem",
              background: "#f8f9fa",
              borderRadius: "8px",
              marginBottom: "1rem",
            }}
          >
            {addError && (
              <div
                style={{
                  color: "#dc3545",
                  marginBottom: "0.75rem",
                  padding: "0.5rem",
                  background: "#f8d7da",
                  borderRadius: "4px",
                  fontSize: "0.875rem",
                }}
              >
                {addError}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.25rem",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                  }}
                >
                  Microchip *
                </label>
                <input
                  type="text"
                  value={newMicrochip}
                  onChange={(e) => setNewMicrochip(e.target.value)}
                  placeholder="900000001234567"
                  style={{ width: "100%" }}
                  required
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.25rem",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                  }}
                >
                  Catch Date
                </label>
                <input
                  type="date"
                  value={newCatchDate}
                  onChange={(e) => setNewCatchDate(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontWeight: 500,
                  fontSize: "0.875rem",
                }}
              >
                Notes (optional)
              </label>
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Where caught, circumstances, etc."
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" disabled={addingCatch}>
                {addingCatch ? "Adding..." : "Add Catch"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddCatch(false);
                  setAddError(null);
                }}
                disabled={addingCatch}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {manualCatches.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cat</th>
                <th>Microchip</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {manualCatches.map((c) => (
                <tr key={c.catch_id}>
                  <td>{new Date(c.catch_date).toLocaleDateString()}</td>
                  <td>
                    {c.cat_id ? (
                      <a href={`/cats/${c.cat_id}`}>{c.cat_name || "Unknown"}</a>
                    ) : (
                      <span className="text-muted">Not linked</span>
                    )}
                  </td>
                  <td>
                    <code style={{ fontSize: "0.8rem" }}>{c.microchip}</code>
                  </td>
                  <td className="text-muted">{c.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No manual catches recorded.</p>
        )}
      </Section>
    </div>
  );
}
