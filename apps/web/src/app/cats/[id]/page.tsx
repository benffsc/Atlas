"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
import { BackButton } from "@/components/BackButton";

interface Owner {
  person_id: string;
  display_name: string;
  role: string;
}

interface Place {
  place_id: string;
  label: string;
  place_kind: string | null;
  role: string;
}

interface Identifier {
  type: string;
  value: string;
  source: string | null;
}

interface ClinicVisit {
  visit_date: string;
  appt_number: string;
  client_name: string;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
}

interface CatVital {
  vital_id: string;
  recorded_at: string;
  temperature_f: number | null;
  weight_lbs: number | null;
  is_pregnant: boolean;
  is_lactating: boolean;
  is_in_heat: boolean;
}

interface CatCondition {
  condition_id: string;
  condition_type: string;
  severity: string | null;
  diagnosed_at: string;
  resolved_at: string | null;
  is_chronic: boolean;
}

interface CatTestResult {
  test_id: string;
  test_type: string;
  test_date: string;
  result: string;
  result_detail: string | null;
}

interface CatProcedure {
  procedure_id: string;
  procedure_type: string;
  procedure_date: string;
  status: string;
  performed_by: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  complications: string[] | null;
  post_op_notes: string | null;
}

interface CatVisit {
  appointment_id: string;
  visit_date: string;
  visit_category: string;
  service_types: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  vaccines: string[];
  treatments: string[];
}

interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  altered_by_clinic: boolean | null; // TRUE if we performed the spay/neuter
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  data_source: string | null; // clinichq, petlink, or legacy_import
  ownership_type: string | null; // Community Cat (Feral), Owned, etc.
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: Identifier[];
  owners: Owner[];
  places: Place[];
  clinic_history: ClinicVisit[];
  vitals: CatVital[];
  conditions: CatCondition[];
  tests: CatTestResult[];
  procedures: CatProcedure[];
  visits: CatVisit[];
  first_visit_date: string | null;
  total_visits: number;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

// Medical chart condition checklist item
// Medical chart condition/status indicator
// positive=true means "yes" is good (like spayed/neutered)
// positive=false means "yes" is bad (like has disease)
function ConditionCheck({
  label,
  status,
  date,
  severity,
  positive = false,
}: {
  label: string;
  status: "yes" | "no" | "unknown";
  date?: string;
  severity?: string;
  positive?: boolean;
}) {
  // For positive attributes (spayed, tested): yes=green, no=red
  // For negative attributes (diseases): yes=red, no=green
  const isGood = positive ? status === "yes" : status === "no";
  const isBad = positive ? status === "no" : status === "yes";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.5rem 0.75rem",
      marginBottom: "0.25rem",
      background: isBad ? "#fff5f5" : isGood ? "#f0fff4" : "#f8f9fa",
      borderRadius: "6px",
      border: `1px solid ${isBad ? "#f5c6cb" : isGood ? "#c3e6cb" : "#dee2e6"}`,
    }}>
      <span style={{
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "14px",
        fontWeight: "bold",
        background: isBad ? "#dc3545" : isGood ? "#198754" : "#adb5bd",
        color: "#fff",
        flexShrink: 0,
      }}>
        {isBad ? "✗" : isGood ? "✓" : "?"}
      </span>
      <span style={{ flex: 1, fontWeight: 500, color: "#212529" }}>{label}</span>
      {severity && (
        <span className="badge" style={{
          background: severity === "severe" ? "#dc3545" : severity === "moderate" ? "#fd7e14" : "#ffc107",
          color: severity === "mild" ? "#000" : "#fff",
          fontSize: "0.7rem",
        }}>
          {severity}
        </span>
      )}
      {date && <span style={{ fontSize: "0.75rem", color: "#6c757d" }}>{date}</span>}
    </div>
  );
}

// Photo placeholder with upload hint
function PhotoSection({ photoUrl, catName }: { photoUrl: string | null; catName: string }) {
  return (
    <div style={{
      width: "150px",
      height: "150px",
      background: "#e9ecef",
      borderRadius: "8px",
      border: "2px dashed #adb5bd",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      overflow: "hidden",
    }}>
      {photoUrl ? (
        <img src={photoUrl} alt={catName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <>
          <span style={{ fontSize: "2.5rem" }}>🐱</span>
          <span style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#495057" }}>Add Photo</span>
        </>
      )}
    </div>
  );
}

interface Appointment {
  appointment_id: string;
  scheduled_at: string;
  scheduled_date: string;
  status: string;
  appointment_type: string;
  provider_name: string | null;
  person_name: string | null;
  person_id: string | null;
  place_name: string | null;
  source_system: string;
}

// Data source badge - ClinicHQ patients vs PetLink-only
function DataSourceBadge({ dataSource }: { dataSource: string | null }) {
  if (dataSource === "clinichq") {
    return (
      <span
        className="badge"
        style={{ background: "#198754", color: "#fff", fontSize: "0.5em" }}
        title="This cat has been to the clinic - verified ClinicHQ patient"
      >
        ClinicHQ Patient
      </span>
    );
  }
  if (dataSource === "petlink") {
    return (
      <span
        className="badge"
        style={{ background: "#6c757d", color: "#fff", fontSize: "0.5em" }}
        title="PetLink microchip registration only - no clinic history"
      >
        PetLink Only
      </span>
    );
  }
  if (dataSource === "legacy_import") {
    return (
      <span
        className="badge"
        style={{ background: "#ffc107", color: "#000", fontSize: "0.5em" }}
        title="Imported from legacy system"
      >
        Legacy Import
      </span>
    );
  }
  return null;
}

// Ownership type badge - Unowned (community cats) vs Owned vs Foster
function OwnershipTypeBadge({ ownershipType }: { ownershipType: string | null }) {
  if (!ownershipType) return null;

  const lowerType = ownershipType.toLowerCase();

  // Community Cat (Feral) and Community Cat (Friendly) both → Unowned
  if (lowerType.includes("community") || lowerType.includes("feral") || lowerType.includes("stray")) {
    return (
      <span
        className="badge"
        style={{ background: "#dc3545", color: "#fff", fontSize: "0.5em" }}
        title={`Unowned (${ownershipType})`}
      >
        Unowned
      </span>
    );
  }
  if (lowerType === "owned") {
    return (
      <span
        className="badge"
        style={{ background: "#0d6efd", color: "#fff", fontSize: "0.5em" }}
        title="Owned cat - has an owner"
      >
        Owned
      </span>
    );
  }
  if (lowerType === "foster") {
    return (
      <span
        className="badge"
        style={{ background: "#6f42c1", color: "#fff", fontSize: "0.5em" }}
        title="Foster cat - in foster care"
      >
        Foster
      </span>
    );
  }
  // Unknown type - show as-is
  return (
    <span
      className="badge"
      style={{ background: "#6c757d", color: "#fff", fontSize: "0.5em" }}
      title={ownershipType}
    >
      {ownershipType}
    </span>
  );
}

// Section component for read-only display with edit toggle
function Section({
  title,
  children,
  onEdit,
  editMode = false,
}: {
  title: string;
  children: React.ReactNode;
  onEdit?: () => void;
  editMode?: boolean;
}) {
  return (
    <div className="detail-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>{title}</h2>
        {onEdit && !editMode && (
          <button
            onClick={onEdit}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
          >
            Edit
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// Clickable link pill for related entities
function EntityLink({
  href,
  label,
  badge,
  badgeColor,
}: {
  href: string;
  label: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        background: "var(--card-bg, #f8f9fa)",
        borderRadius: "8px",
        textDecoration: "none",
        color: "var(--foreground, #212529)",
        border: "1px solid var(--border, #dee2e6)",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "#adb5bd";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--border, #dee2e6)";
      }}
    >
      <span>{label}</span>
      {badge && (
        <span
          className="badge"
          style={{ background: badgeColor || "#6c757d", color: "#fff", fontSize: "0.7rem" }}
        >
          {badge}
        </span>
      )}
    </a>
  );
}

export default function CatDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [cat, setCat] = useState<CatDetail | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modes per section
  const [editingBasic, setEditingBasic] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    sex: "",
    is_eartipped: false,
    color_pattern: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchCat = useCallback(async () => {
    try {
      const response = await fetch(`/api/cats/${id}`);
      if (response.status === 404) {
        setError("Cat not found");
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch cat details");
      }
      const result: CatDetail = await response.json();
      setCat(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchAppointments = useCallback(async () => {
    try {
      const response = await fetch(`/api/appointments?cat_id=${id}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
      }
    } catch (err) {
      console.error("Failed to fetch appointments:", err);
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const response = await fetch(`/api/journal?cat_id=${id}&limit=50`);
      if (response.ok) {
        const data = await response.json();
        setJournal(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchCat(), fetchAppointments(), fetchJournal()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchCat, fetchAppointments, fetchJournal]);

  const startEditingBasic = () => {
    if (cat) {
      setEditForm({
        name: cat.display_name || "",
        sex: cat.sex || "",
        is_eartipped: cat.altered_status === "Yes",
        color_pattern: cat.coat_pattern || "",
        notes: cat.notes || "",
      });
      setSaveError(null);
      setEditingBasic(true);
    }
  };

  const cancelEditingBasic = () => {
    setEditingBasic(false);
    setSaveError(null);
  };

  const handleSaveBasic = async () => {
    if (!cat) return;

    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(`/api/cats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name || null,
          sex: editForm.sex || null,
          is_eartipped: editForm.is_eartipped,
          color_pattern: editForm.color_pattern || null,
          notes: editForm.notes || null,
          change_reason: "manual_edit",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveError(result.error || "Failed to save changes");
        return;
      }

      // Refresh cat data
      await fetchCat();
      setEditingBasic(false);
    } catch (err) {
      setSaveError("Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading cat details...</div>;
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/cats" />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Cat ID: <code>{id}</code>
          </p>
        </div>
      </div>
    );
  }

  if (!cat) {
    return <div className="empty">Cat not found</div>;
  }

  const tierColors: Record<string, string> = {
    A: "#198754",
    B: "#ffc107",
    C: "#fd7e14",
    D: "#dc3545",
  };

  // Helper to check if cat has a specific condition
  const hasCondition = (conditionType: string) => {
    return cat.conditions?.some(c => c.condition_type === conditionType && !c.resolved_at);
  };

  const getConditionSeverity = (conditionType: string) => {
    const cond = cat.conditions?.find(c => c.condition_type === conditionType && !c.resolved_at);
    return cond?.severity || undefined;
  };

  const getTestResult = (testType: string) => {
    const test = cat.tests?.find(t => t.test_type === testType);
    return test?.result || "unknown";
  };

  const getLatestVital = () => cat.vitals?.[0] || null;
  const latestVital = getLatestVital();

  // Has spay/neuter procedure
  const hasSpayNeuter = cat.procedures?.some(p => p.is_spay || p.is_neuter);

  return (
    <div>
      <BackButton fallbackHref="/cats" />

      {/* Medical Chart Header */}
      <div style={{
        marginTop: "1rem",
        background: "#f8f9fa",
        borderRadius: "12px",
        padding: "1.5rem",
        border: "1px solid #dee2e6",
      }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          {/* Photo */}
          <PhotoSection photoUrl={cat.photo_url} catName={cat.display_name} />

          {/* Patient Info */}
          <div style={{ flex: 1, minWidth: "200px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.75rem", color: "#212529" }}>{cat.display_name}</h1>
              <DataSourceBadge dataSource={cat.data_source} />
              <OwnershipTypeBadge ownershipType={cat.ownership_type} />
              {!editingBasic && (
                <button
                  onClick={startEditingBasic}
                  style={{ marginLeft: "auto", padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
                >
                  Edit
                </button>
              )}
            </div>

            {editingBasic ? (
              <div style={{ marginTop: "1rem" }}>
                {saveError && (
                  <div style={{ color: "#dc3545", marginBottom: "0.75rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", fontSize: "0.875rem" }}>
                    {saveError}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Name</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Sex</label>
                    <select
                      value={editForm.sex}
                      onChange={(e) => setEditForm({ ...editForm, sex: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Unknown</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Color/Pattern</label>
                    <input
                      type="text"
                      value={editForm.color_pattern}
                      onChange={(e) => setEditForm({ ...editForm, color_pattern: e.target.value })}
                      placeholder="e.g., orange tabby, black"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", paddingTop: "1.5rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={editForm.is_eartipped}
                        onChange={(e) => setEditForm({ ...editForm, is_eartipped: e.target.checked })}
                      />
                      Ear-tipped (altered)
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Notes</label>
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    rows={2}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button onClick={handleSaveBasic} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={cancelEditingBasic}
                    disabled={saving}
                    style={{ background: "transparent", border: "1px solid var(--border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
                <div>
                  <div className="text-muted text-sm">Microchip</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 500, color: "#212529" }}>{cat.microchip || "—"}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">Sex</div>
                  <div style={{ fontWeight: 500, color: "#212529" }}>{cat.sex || "Unknown"}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">Altered</div>
                  <div style={{ fontWeight: 500, color: "#212529" }}>
                    {cat.altered_status === "Yes" ? (
                      <span style={{ color: "#198754" }}>Yes {cat.altered_by_clinic ? "(by clinic)" : ""}</span>
                    ) : cat.altered_status === "No" ? (
                      <span style={{ color: "#dc3545" }}>No</span>
                    ) : "Unknown"}
                  </div>
                </div>
                <div>
                  <div className="text-muted text-sm">Breed</div>
                  <div style={{ fontWeight: 500, color: "#212529" }}>{cat.breed || "Unknown"}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">Color</div>
                  <div style={{ fontWeight: 500, color: "#212529" }}>{cat.color || "Unknown"} {cat.coat_pattern && `(${cat.coat_pattern})`}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">Weight</div>
                  <div style={{ fontWeight: 500, color: "#212529" }}>
                    {latestVital?.weight_lbs ? `${latestVital.weight_lbs} lbs` : "—"}
                    {latestVital?.recorded_at && (
                      <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>
                        ({new Date(latestVital.recorded_at).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Status - FeLV/FIV prominent */}
          <div style={{
            background: "#e9ecef",
            borderRadius: "8px",
            padding: "1rem",
            border: "1px solid #adb5bd",
            minWidth: "140px",
            textAlign: "center",
          }}>
            <div style={{ marginBottom: "0.5rem", fontSize: "0.875rem", color: "#495057" }}>FeLV/FIV</div>
            {cat.tests?.find(t => t.test_type === "felv_fiv") ? (
              <div style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                color: getTestResult("felv_fiv") === "negative" ? "#198754" : "#dc3545",
              }}>
                {getTestResult("felv_fiv") === "negative" ? "NEG" : "POS"}
              </div>
            ) : (
              <div style={{ fontSize: "1.25rem", color: "#495057" }}>Not Tested</div>
            )}
            {cat.tests?.find(t => t.test_type === "felv_fiv") && (
              <div style={{ fontSize: "0.875rem", color: "#495057" }}>
                {new Date(cat.tests.find(t => t.test_type === "felv_fiv")!.test_date).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Medical Overview - What was done/observed */}
      <Section title="Medical Overview">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
          {/* Vaccines Received */}
          <div>
            <h3 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.75rem", textTransform: "uppercase" }}>
              Vaccines Received
            </h3>
            {(() => {
              const allVaccines = cat.visits?.flatMap(v => v.vaccines || []).filter(Boolean) || [];
              const uniqueVaccines = [...new Set(allVaccines)];
              if (uniqueVaccines.length === 0) {
                return <p className="text-muted">No vaccines recorded</p>;
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {uniqueVaccines.map((vaccine, i) => (
                    <div key={i} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 0.75rem",
                      background: "#f0fff4",
                      borderRadius: "6px",
                      border: "1px solid #c3e6cb",
                    }}>
                      <span style={{ color: "#198754", fontWeight: "bold" }}>+</span>
                      <span>{vaccine}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Treatments Given */}
          <div>
            <h3 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.75rem", textTransform: "uppercase" }}>
              Treatments Given
            </h3>
            {(() => {
              const allTreatments = cat.visits?.flatMap(v => v.treatments || []).filter(Boolean) || [];
              const uniqueTreatments = [...new Set(allTreatments)];
              if (uniqueTreatments.length === 0) {
                return <p className="text-muted">No treatments recorded</p>;
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {uniqueTreatments.map((treatment, i) => (
                    <div key={i} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 0.75rem",
                      background: "#e7f1ff",
                      borderRadius: "6px",
                      border: "1px solid #b6d4fe",
                    }}>
                      <span style={{ color: "#0d6efd", fontWeight: "bold" }}>+</span>
                      <span>{treatment}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Conditions Observed */}
          <div>
            <h3 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.75rem", textTransform: "uppercase" }}>
              Conditions Observed
            </h3>
            {cat.conditions?.filter(c => !c.resolved_at).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {cat.conditions.filter(c => !c.resolved_at).map(cond => (
                  <div key={cond.condition_id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    background: cond.severity === "severe" ? "#fff5f5" : cond.severity === "moderate" ? "#fff8e6" : "#fffbe6",
                    borderRadius: "6px",
                    border: `1px solid ${cond.severity === "severe" ? "#f5c6cb" : cond.severity === "moderate" ? "#ffe69c" : "#ffecb5"}`,
                  }}>
                    <span style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: cond.severity === "severe" ? "#dc3545" : cond.severity === "moderate" ? "#fd7e14" : "#ffc107",
                    }} />
                    <span style={{ flex: 1 }}>{cond.condition_type.replace(/_/g, " ")}</span>
                    {cond.severity && (
                      <span style={{ fontSize: "0.75rem", color: "#6c757d" }}>({cond.severity})</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">No active conditions</p>
            )}
          </div>
        </div>
      </Section>

      {/* Latest Vitals */}
      {latestVital && (
        <Section title="Latest Vitals">
          <div className="detail-grid">
            {latestVital.temperature_f && (
              <div className="detail-item">
                <span className="detail-label">Temperature</span>
                <span className="detail-value">{latestVital.temperature_f}°F</span>
              </div>
            )}
            {latestVital.weight_lbs && (
              <div className="detail-item">
                <span className="detail-label">Weight</span>
                <span className="detail-value">{latestVital.weight_lbs} lbs</span>
              </div>
            )}
            <div className="detail-item">
              <span className="detail-label">Pregnant</span>
              <span className="detail-value">{latestVital.is_pregnant ? "Yes" : "No"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Lactating</span>
              <span className="detail-value">{latestVital.is_lactating ? "Yes" : "No"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">In Heat</span>
              <span className="detail-value">{latestVital.is_in_heat ? "Yes" : "No"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Recorded</span>
              <span className="detail-value">{new Date(latestVital.recorded_at).toLocaleDateString()}</span>
            </div>
          </div>
        </Section>
      )}

      {/* Medical Summary - Key health info at a glance */}
      {(cat.tests?.length > 0 || cat.procedures?.length > 0 || cat.conditions?.length > 0) && (
        <Section title="Medical Summary">
          <div className="detail-grid">
            {/* FeLV/FIV Status - Most important */}
            {cat.tests?.filter(t => t.test_type === "felv_fiv").slice(0, 1).map(test => (
              <div className="detail-item" key={test.test_id}>
                <span className="detail-label">FeLV/FIV Status</span>
                <span className="detail-value">
                  <span
                    className="badge"
                    style={{
                      background: test.result === "negative" ? "#198754" :
                                  test.result === "positive" ? "#dc3545" : "#ffc107",
                      color: test.result === "positive" || test.result === "negative" ? "#fff" : "#000",
                    }}
                  >
                    {test.result.toUpperCase()}
                  </span>
                  <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                    ({new Date(test.test_date).toLocaleDateString()})
                  </span>
                </span>
              </div>
            ))}

            {/* Spay/Neuter Procedures */}
            {cat.procedures?.filter(p => p.is_spay || p.is_neuter).slice(0, 1).map(proc => (
              <div className="detail-item" key={proc.procedure_id}>
                <span className="detail-label">{proc.is_spay ? "Spay" : "Neuter"}</span>
                <span className="detail-value">
                  <span className="badge" style={{ background: "#198754", color: "#fff" }}>
                    Completed
                  </span>
                  <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                    {new Date(proc.procedure_date).toLocaleDateString()}
                    {proc.performed_by && ` by ${proc.performed_by}`}
                  </span>
                </span>
              </div>
            ))}

            {/* Active Conditions */}
            {cat.conditions?.filter(c => !c.resolved_at).length > 0 && (
              <div className="detail-item" style={{ gridColumn: "span 2" }}>
                <span className="detail-label">Active Conditions</span>
                <span className="detail-value" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {cat.conditions.filter(c => !c.resolved_at).map(cond => (
                    <span
                      key={cond.condition_id}
                      className="badge"
                      style={{
                        background: cond.severity === "severe" ? "#dc3545" :
                                    cond.severity === "moderate" ? "#fd7e14" :
                                    cond.severity === "mild" ? "#ffc107" : "#6c757d",
                        color: cond.severity === "mild" ? "#000" : "#fff",
                      }}
                      title={`Diagnosed ${new Date(cond.diagnosed_at).toLocaleDateString()}`}
                    >
                      {cond.condition_type.replace(/_/g, " ")}
                      {cond.severity && ` (${cond.severity})`}
                    </span>
                  ))}
                </span>
              </div>
            )}

            {/* Latest Vitals */}
            {cat.vitals?.length > 0 && (
              <>
                {cat.vitals[0].temperature_f && (
                  <div className="detail-item">
                    <span className="detail-label">Last Temperature</span>
                    <span className="detail-value">
                      {cat.vitals[0].temperature_f}°F
                      <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                        ({new Date(cat.vitals[0].recorded_at).toLocaleDateString()})
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>
      )}

      {/* Detailed Medical History */}
      {(cat.procedures?.length > 0 || cat.tests?.length > 0 || cat.conditions?.length > 0) && (
        <Section title="Medical History">
          {/* Procedures */}
          {cat.procedures?.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Procedures ({cat.procedures.length})</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Procedure</th>
                      <th>Vet</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.procedures.map(proc => (
                      <tr key={proc.procedure_id}>
                        <td>{new Date(proc.procedure_date).toLocaleDateString()}</td>
                        <td>
                          <span className="badge" style={{ background: "#198754", color: "#fff" }}>
                            {proc.procedure_type.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>{proc.performed_by || "—"}</td>
                        <td>
                          {proc.complications && proc.complications.length > 0 && (
                            <span className="text-sm" style={{ color: "#dc3545" }}>
                              {proc.complications.join(", ")}
                            </span>
                          )}
                          {proc.post_op_notes && (
                            <span className="text-sm text-muted">
                              {proc.complications?.length ? " | " : ""}{proc.post_op_notes}
                            </span>
                          )}
                          {!proc.complications?.length && !proc.post_op_notes && "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Test Results */}
          {cat.tests?.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Test Results ({cat.tests.length})</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Test</th>
                      <th>Result</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.tests.map(test => (
                      <tr key={test.test_id}>
                        <td>{new Date(test.test_date).toLocaleDateString()}</td>
                        <td>{test.test_type.replace(/_/g, " ")}</td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              background: test.result === "negative" ? "#198754" :
                                          test.result === "positive" ? "#dc3545" : "#ffc107",
                              color: test.result === "positive" || test.result === "negative" ? "#fff" : "#000",
                            }}
                          >
                            {test.result}
                          </span>
                        </td>
                        <td className="text-muted">{test.result_detail || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Conditions */}
          {cat.conditions?.length > 0 && (
            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Conditions ({cat.conditions.length})</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Diagnosed</th>
                      <th>Condition</th>
                      <th>Severity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.conditions.map(cond => (
                      <tr key={cond.condition_id}>
                        <td>{new Date(cond.diagnosed_at).toLocaleDateString()}</td>
                        <td>{cond.condition_type.replace(/_/g, " ")}</td>
                        <td>
                          {cond.severity ? (
                            <span
                              className="badge"
                              style={{
                                background: cond.severity === "severe" ? "#dc3545" :
                                            cond.severity === "moderate" ? "#fd7e14" :
                                            cond.severity === "mild" ? "#ffc107" : "#6c757d",
                                color: cond.severity === "mild" ? "#000" : "#fff",
                              }}
                            >
                              {cond.severity}
                            </span>
                          ) : "—"}
                        </td>
                        <td>
                          {cond.resolved_at ? (
                            <span className="text-muted">
                              Resolved {new Date(cond.resolved_at).toLocaleDateString()}
                            </span>
                          ) : cond.is_chronic ? (
                            <span className="badge" style={{ background: "#6c757d", color: "#fff" }}>
                              Chronic
                            </span>
                          ) : (
                            <span className="badge" style={{ background: "#fd7e14", color: "#fff" }}>
                              Active
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Identifiers */}
      {cat.identifiers && cat.identifiers.length > 0 && (
        <Section title="Identifiers">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {cat.identifiers.map((ident, idx) => (
              <div
                key={idx}
                className="identifier-badge"
              >
                <strong>{ident.type}:</strong>{" "}
                <code>{ident.value}</code>
                {ident.source && (
                  <span className="text-muted" style={{ marginLeft: "0.5rem" }}>
                    ({ident.source})
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Owners - Clickable Links */}
      <Section title="People">
        {cat.owners && cat.owners.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.owners.map((owner) => (
              <EntityLink
                key={owner.person_id}
                href={`/people/${owner.person_id}`}
                label={owner.display_name}
                badge={owner.role}
                badgeColor={owner.role === "owner" ? "#0d6efd" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No people linked to this cat.</p>
        )}
      </Section>

      {/* Places - Clickable Links */}
      <Section title="Places">
        {cat.places && cat.places.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.places.map((place) => (
              <EntityLink
                key={place.place_id}
                href={`/places/${place.place_id}`}
                label={place.label}
                badge={place.place_kind || place.role}
                badgeColor={place.role === "residence" ? "#198754" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No places linked to this cat.</p>
        )}
      </Section>

      {/* Clinic History - Who brought this cat to clinic */}
      {cat.clinic_history && cat.clinic_history.length > 0 && (
        <Section title="Clinic History">
          <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
            Who brought this cat to clinic (from ClinicHQ records)
          </p>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Address</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {cat.clinic_history.map((visit, idx) => (
                  <tr key={idx}>
                    <td>{new Date(visit.visit_date).toLocaleDateString()}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{visit.client_name}</div>
                      {visit.client_email && (
                        <div className="text-muted text-sm">{visit.client_email}</div>
                      )}
                      {visit.client_phone && (
                        <div className="text-muted text-sm">{visit.client_phone}</div>
                      )}
                    </td>
                    <td>
                      {visit.client_address || <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {visit.ownership_type && (
                        <span
                          className="badge"
                          style={{
                            background: visit.ownership_type.includes("Feral") ? "#6c757d" : "#0d6efd",
                            color: "#fff",
                            fontSize: "0.7rem",
                          }}
                        >
                          {visit.ownership_type}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Visit History - Categorized */}
      <Section title="Visit History">
        {cat.visits && cat.visits.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Services</th>
                  <th>Vet</th>
                </tr>
              </thead>
              <tbody>
                {cat.visits.map((visit) => (
                  <tr key={visit.appointment_id}>
                    <td>{new Date(visit.visit_date).toLocaleDateString()}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background:
                            visit.visit_category === "Spay/Neuter" ? "#198754" :
                            visit.visit_category === "Wellness" ? "#0d6efd" :
                            visit.visit_category === "Recheck" ? "#6f42c1" :
                            visit.visit_category === "Euthanasia" ? "#dc3545" : "#6c757d",
                          color: "#fff",
                        }}
                      >
                        {visit.visit_category}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {visit.is_spay && <span className="badge" style={{ background: "#e9ecef", color: "#495057", fontSize: "0.7rem" }}>Spay</span>}
                        {visit.is_neuter && <span className="badge" style={{ background: "#e9ecef", color: "#495057", fontSize: "0.7rem" }}>Neuter</span>}
                        {visit.vaccines?.map((v, i) => (
                          <span key={i} className="badge" style={{ background: "#d1e7dd", color: "#0f5132", fontSize: "0.7rem" }}>{v}</span>
                        ))}
                        {visit.treatments?.map((t, i) => (
                          <span key={i} className="badge" style={{ background: "#cfe2ff", color: "#084298", fontSize: "0.7rem" }}>{t}</span>
                        ))}
                      </div>
                    </td>
                    <td>{visit.vet_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">No visits recorded for this cat.</p>
        )}
      </Section>

      {/* Journal / Notes */}
      <Section title="Journal">
        <JournalSection
          entries={journal}
          entityType="cat"
          entityId={id}
          onEntryAdded={fetchJournal}
        />
      </Section>

      {/* Metadata */}
      <Section title="Metadata">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Data Source</span>
            <span className="detail-value">
              {cat.data_source === "clinichq" ? "ClinicHQ" :
               cat.data_source === "petlink" ? "PetLink (microchip only)" :
               cat.data_source === "legacy_import" ? "Legacy Import" :
               cat.data_source || "Unknown"}
            </span>
          </div>
          {cat.first_visit_date && (
            <div className="detail-item">
              <span className="detail-label">First ClinicHQ Visit</span>
              <span className="detail-value">
                {new Date(cat.first_visit_date).toLocaleDateString()}
              </span>
            </div>
          )}
          {cat.total_visits > 0 && (
            <div className="detail-item">
              <span className="detail-label">Total ClinicHQ Visits</span>
              <span className="detail-value">{cat.total_visits}</span>
            </div>
          )}
          <div className="detail-item">
            <span className="detail-label">Atlas Created</span>
            <span className="detail-value">
              {new Date(cat.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Last Updated</span>
            <span className="detail-value">
              {new Date(cat.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}
