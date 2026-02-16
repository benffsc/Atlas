"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
import QuickNotes from "@/components/QuickNotes";
import { BackButton } from "@/components/BackButton";
import { EditHistory } from "@/components/EditHistory";
import { OwnershipTransferWizard } from "@/components/OwnershipTransferWizard";
import { CatMovementSection } from "@/components/CatMovementSection";
import { EntityLink } from "@/components/EntityLink";
import { VerificationBadge, LastVerified } from "@/components/VerificationBadge";
import { formatDateLocal, formatPhone } from "@/lib/formatters";
import ReportDeceasedModal from "@/components/ReportDeceasedModal";
import RecordBirthModal from "@/components/RecordBirthModal";
import AppointmentDetailModal from "@/components/AppointmentDetailModal";
import { MediaGallery } from "@/components/MediaGallery";
import { QuickActions, useCatQuickActionState } from "@/components/QuickActions";
import { ProfileLayout } from "@/components/ProfileLayout";
import { AtlasCatIdBadge } from "@/components/AtlasCatIdBadge";
import { MicrochipStatusBadge } from "@/components/MicrochipStatusBadge";

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

interface ClinicAppointment {
  appointment_date: string;
  appt_number: string;
  client_name: string;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
}

interface OriginPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  inferred_source: string | null;
}

interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string;
  first_seen: string;
  appointment_count: number;
}

interface EnhancedClinicAppointment {
  appointment_id: string;
  appointment_date: string;
  appt_number: string;
  client_name: string | null;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
  origin_address: string | null;
  partner_org_short: string | null;
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

interface CatAppointment {
  appointment_id: string;
  appointment_date: string;
  clinic_day_number: number | null;
  appointment_category: string;
  service_types: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  vaccines: string[];
  treatments: string[];
}

interface MortalityEvent {
  mortality_event_id: string;
  death_date: string | null;
  death_cause: string;
  death_age_category: string;
  source_system: string;
  notes: string | null;
  created_at: string;
}

interface BirthEvent {
  birth_event_id: string;
  litter_id: string;
  mother_cat_id: string | null;
  mother_name: string | null;
  birth_date: string | null;
  birth_date_precision: string;
  birth_year: number | null;
  birth_month: number | null;
  birth_season: string | null;
  place_id: string | null;
  place_name: string | null;
  kitten_count_in_litter: number | null;
  survived_to_weaning: boolean | null;
  litter_survived_count: number | null;
  source_system: string;
  notes: string | null;
  created_at: string;
}

interface Sibling {
  cat_id: string;
  display_name: string;
  sex: string | null;
  microchip: string | null;
}

// Multi-source field transparency (MIG_620)
interface FieldSourceValue {
  value: string;
  source: string;
  observed_at: string;
  is_current: boolean;
  confidence: number | null;
}

interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  altered_by_clinic: boolean | null; // TRUE if we performed the spay/neuter
  breed: string | null;
  color: string | null;
  secondary_color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  needs_microchip: boolean; // TRUE if cat was created without microchip (MIG_891)
  data_source: string | null; // clinichq, petlink, or legacy_import
  ownership_type: string | null; // Community Cat (Feral), Owned, etc.
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: Identifier[];
  owners: Owner[];
  places: Place[];
  clinic_history: ClinicAppointment[];
  vitals: CatVital[];
  conditions: CatCondition[];
  tests: CatTestResult[];
  procedures: CatProcedure[];
  appointments: CatAppointment[];
  first_appointment_date: string | null;
  total_appointments: number;
  photo_url: string | null;
  is_deceased: boolean | null;
  deceased_date: string | null;
  mortality_event: MortalityEvent | null;
  birth_event: BirthEvent | null;
  siblings: Sibling[];
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  // Origin and partner org data (MIG_581, MIG_582)
  primary_origin_place: OriginPlace | null;
  partner_orgs: PartnerOrg[];
  enhanced_clinic_history: EnhancedClinicAppointment[];
  // Multi-source field transparency (MIG_620)
  field_sources: Record<string, FieldSourceValue[]> | null;
  has_field_conflicts: boolean;
  field_source_count: number;
  // Atlas Cat ID System (MIG_976)
  atlas_cat_id: string | null;
  atlas_cat_id_type: "microchip" | "hash" | null;
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
      background: isBad ? "var(--danger-bg)" : isGood ? "var(--success-bg)" : "var(--section-bg)",
      borderRadius: "6px",
      border: `1px solid ${isBad ? "var(--danger-border)" : isGood ? "var(--success-border)" : "var(--border)"}`,
      color: isBad ? "var(--danger-text)" : isGood ? "var(--success-text)" : "var(--foreground)",
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
        background: isBad ? "#dc3545" : isGood ? "#198754" : "var(--muted)",
        color: "#fff",
        flexShrink: 0,
      }}>
        {isBad ? "✗" : isGood ? "✓" : "?"}
      </span>
      <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
      {severity && (
        <span className="badge" style={{
          background: severity === "severe" ? "#dc3545" : severity === "moderate" ? "#fd7e14" : "#ffc107",
          color: severity === "mild" ? "#000" : "#fff",
          fontSize: "0.7rem",
        }}>
          {severity}
        </span>
      )}
      {date && <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{date}</span>}
    </div>
  );
}

// Photo placeholder with upload hint
function PhotoSection({ photoUrl, catName }: { photoUrl: string | null; catName: string }) {
  return (
    <div style={{
      width: "150px",
      height: "150px",
      background: "var(--section-bg)",
      borderRadius: "8px",
      border: "2px dashed var(--border)",
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
          <span style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>Add Photo</span>
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

// Multi-source field display - shows primary value with source and alternate values
function MultiSourceField({
  label,
  fieldName,
  primaryValue,
  fieldSources,
  formatValue,
}: {
  label: string;
  fieldName: string;
  primaryValue: string | null;
  fieldSources: Record<string, FieldSourceValue[]> | null;
  formatValue?: (val: string) => string;
}) {
  const sources = fieldSources?.[fieldName] || [];
  const currentSource = sources.find(s => s.is_current);
  const alternateSources = sources.filter(s => !s.is_current && s.value !== currentSource?.value);

  // Source display names
  const sourceLabels: Record<string, string> = {
    clinichq: "ClinicHQ",
    shelterluv: "ShelterLuv",
    petlink: "PetLink",
    airtable: "Airtable",
    web_intake: "Web Intake",
    atlas_ui: "Atlas",
    legacy_import: "Legacy",
  };

  const getSourceLabel = (source: string) => sourceLabels[source] || source;
  const format = formatValue || ((v: string) => v);

  // If no sources recorded, just show the value
  if (sources.length === 0) {
    return (
      <div>
        <div className="text-muted text-sm">{label}</div>
        <div style={{ fontWeight: 500 }}>{primaryValue || "Unknown"}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-muted text-sm">{label}</div>
      <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span>{format(currentSource?.value || primaryValue || "Unknown")}</span>
        {currentSource && (
          <span
            className="badge"
            style={{
              background: currentSource.source === "clinichq" ? "#198754" :
                         currentSource.source === "shelterluv" ? "#0d6efd" :
                         currentSource.source === "petlink" ? "#6c757d" : "#6c757d",
              color: "#fff",
              fontSize: "0.6rem",
              padding: "0.15rem 0.4rem",
            }}
            title={`From ${getSourceLabel(currentSource.source)}`}
          >
            {getSourceLabel(currentSource.source)}
          </span>
        )}
      </div>
      {alternateSources.length > 0 && (
        <div style={{ marginTop: "0.25rem" }}>
          {alternateSources.map((alt, idx) => (
            <div
              key={idx}
              className="text-muted"
              style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
            >
              <span style={{ color: "#6c757d" }}>Also:</span>
              <span style={{ fontStyle: "italic" }}>"{format(alt.value)}"</span>
              <span style={{ color: "#6c757d" }}>({getSourceLabel(alt.source)})</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
    breed: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit history and transfer wizard
  const [showHistory, setShowHistory] = useState(false);
  const [showTransferWizard, setShowTransferWizard] = useState(false);
  const [showDeceasedModal, setShowDeceasedModal] = useState(false);
  const [showBirthModal, setShowBirthModal] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [editingClinicNum, setEditingClinicNum] = useState<string | null>(null);
  const [clinicNumValue, setClinicNumValue] = useState("");

  const handleSaveClinicNum = async (appointmentId: string) => {
    const val = clinicNumValue.trim();
    const numVal = val === "" ? null : parseInt(val, 10);
    if (val !== "" && (isNaN(numVal!) || numVal! < 1 || numVal! > 999)) return;
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_day_number: numVal }),
      });
      if (res.ok) {
        // Update local state
        if (cat) {
          const updated = cat.appointments?.map((a) =>
            a.appointment_id === appointmentId
              ? { ...a, clinic_day_number: numVal }
              : a
          );
          setCat({ ...cat, appointments: updated || null });
        }
      }
    } catch {
      // silent fail
    }
    setEditingClinicNum(null);
  };

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
      const response = await fetch(`/api/journal?cat_id=${id}&limit=50&include_related=true`);
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
      // Normalize sex to lowercase for dropdown matching
      const normalizedSex = cat.sex ? cat.sex.toLowerCase() : "";
      // Handle altered_status: "spayed", "neutered", "Yes" all mean altered
      const isAltered = cat.altered_status
        ? ["yes", "spayed", "neutered"].includes(cat.altered_status.toLowerCase())
        : false;
      setEditForm({
        name: cat.display_name || "",
        sex: normalizedSex === "male" || normalizedSex === "female" ? normalizedSex : "",
        is_eartipped: isAltered,
        color_pattern: cat.color || "",
        breed: cat.breed || "",
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
          breed: editForm.breed || null,
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

  // Get FIV status from any of the test types that include FIV
  const getFivTest = () => {
    return cat.tests?.find(t =>
      t.test_type === "fiv" ||
      t.test_type === "felv_fiv" ||
      t.test_type === "felv_fiv_combo"
    );
  };

  // Get FeLV status from any of the test types that include FeLV
  const getFelvTest = () => {
    return cat.tests?.find(t =>
      t.test_type === "felv" ||
      t.test_type === "felv_fiv" ||
      t.test_type === "felv_fiv_combo"
    );
  };

  // Get combined FIV/FeLV display - returns { fivResult, felvResult, testDate, hasAnyTest }
  const getFelvFivStatus = () => {
    const fivTest = getFivTest();
    const felvTest = getFelvTest();

    // For combo tests, parse the result to get individual statuses
    const parseComboResult = (result: string | undefined, disease: "fiv" | "felv") => {
      if (!result) return null;
      const lower = result.toLowerCase();
      // Check for explicit mentions like "FIV: Positive" or "fiv positive"
      if (lower.includes(disease)) {
        if (lower.includes(`${disease} positive`) || lower.includes(`${disease}: positive`)) return "positive";
        if (lower.includes(`${disease} negative`) || lower.includes(`${disease}: negative`)) return "negative";
      }
      // For simple "positive" or "negative" on combo tests, assume both are same
      if (lower === "positive" || lower === "negative") return lower;
      return null;
    };

    let fivResult: string | null = null;
    let felvResult: string | null = null;
    let testDate: string | null = null;

    if (fivTest) {
      testDate = fivTest.test_date;
      if (fivTest.test_type === "fiv") {
        fivResult = fivTest.result?.toLowerCase() || null;
      } else {
        // Combo test - parse result
        fivResult = parseComboResult(fivTest.result, "fiv") || fivTest.result?.toLowerCase() || null;
      }
    }

    if (felvTest) {
      testDate = testDate || felvTest.test_date;
      if (felvTest.test_type === "felv") {
        felvResult = felvTest.result?.toLowerCase() || null;
      } else {
        // Combo test - parse result
        felvResult = parseComboResult(felvTest.result, "felv") || felvTest.result?.toLowerCase() || null;
      }
    }

    return {
      fivResult,
      felvResult,
      testDate,
      hasAnyTest: !!(fivTest || felvTest),
      // For display: any positive is concerning
      anyPositive: fivResult === "positive" || felvResult === "positive",
      allNegative: (fivResult === "negative" || !fivResult) && (felvResult === "negative" || !felvResult) && (fivTest || felvTest),
    };
  };

  const felvFivStatus = getFelvFivStatus();

  const getLatestVital = () => cat.vitals?.[0] || null;
  const latestVital = getLatestVital();
  // Find latest vital WITH weight (may be different record than temperature)
  const latestWeight = cat.vitals?.find(v => v.weight_lbs != null) || null;
  const latestTemp = cat.vitals?.find(v => v.temperature_f != null) || null;

  // Has spay/neuter procedure
  const hasSpayNeuter = cat.procedures?.some(p => p.is_spay || p.is_neuter);

  /* ── Header: Medical chart header (persists across tabs) ── */
  const profileHeader = (
    <div>
      <BackButton fallbackHref="/cats" />

      <div style={{
        marginTop: "1rem",
        background: "var(--section-bg)",
        borderRadius: "12px",
        padding: "1.5rem",
        border: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          {/* Photo Gallery */}
          <div style={{ width: "180px" }}>
            <MediaGallery
              entityType="cat"
              entityId={cat.cat_id}
              allowUpload={true}
              includeRelated={true}
              maxDisplay={1}
              defaultMediaType="cat_photo"
              allowedMediaTypes={["cat_photo"]}
              entitySummary={{
                name: cat.display_name || "Unknown Cat",
                details: [
                  cat.sex ? `Sex: ${cat.sex.charAt(0).toUpperCase() + cat.sex.slice(1).toLowerCase()}` : "Sex: Unknown",
                  cat.breed ? `Breed: ${cat.breed}` : undefined,
                  cat.color ? `Color: ${cat.color}` : undefined,
                  cat.microchip ? `Chip: ${cat.microchip}` : undefined,
                ].filter(Boolean) as string[],
              }}
              onClinicDayNumber={cat.appointments?.length ? (apptId, num) => {
                fetch(`/api/appointments/${apptId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ clinic_day_number: num }),
                }).then((res) => {
                  if (res.ok && cat) {
                    const updated = cat.appointments?.map((a) =>
                      a.appointment_id === apptId ? { ...a, clinic_day_number: num } : a
                    );
                    setCat({ ...cat, appointments: updated || null });
                  }
                }).catch(() => {});
              } : undefined}
              appointmentOptions={cat.appointments?.map((a) => ({
                appointment_id: a.appointment_id,
                appointment_date: a.appointment_date,
              }))}
            />
          </div>

          {/* Patient Info */}
          <div style={{ flex: 1, minWidth: "200px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.75rem", color: cat.is_deceased ? "var(--muted)" : "inherit" }}>{cat.display_name}</h1>
              {cat.is_deceased && (
                <span
                  className="badge"
                  style={{ background: "#dc3545", color: "#fff", fontSize: "0.6em" }}
                  title={cat.deceased_date ? `Deceased: ${formatDateLocal(cat.deceased_date)}` : "Deceased"}
                >
                  DECEASED
                </span>
              )}
              {cat.atlas_cat_id && (
                <AtlasCatIdBadge
                  atlasCatId={cat.atlas_cat_id}
                  isChipped={cat.atlas_cat_id_type !== "hash"}
                  size="md"
                />
              )}
              {cat.needs_microchip && (
                <MicrochipStatusBadge
                  hasChip={false}
                  size="md"
                />
              )}
              <DataSourceBadge dataSource={cat.data_source} />
              <OwnershipTypeBadge ownershipType={cat.ownership_type} />
              {cat.has_field_conflicts && (
                <span
                  className="badge"
                  style={{
                    background: "#ffc107",
                    color: "#000",
                    fontSize: "0.5em",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                  title="This cat has field values that differ between data sources. Scroll down to see details."
                >
                  Multi-Source Data
                </span>
              )}
              {cat.field_source_count > 1 && !cat.has_field_conflicts && (
                <span
                  className="badge"
                  style={{
                    background: "#e9ecef",
                    color: "#495057",
                    fontSize: "0.5em",
                  }}
                  title={`Data from ${cat.field_source_count} sources`}
                >
                  {cat.field_source_count} Sources
                </span>
              )}
              {!editingBasic && (
                <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                  <a
                    href={`/cats/${cat.cat_id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "0.25rem 0.75rem",
                      fontSize: "0.875rem",
                      background: "transparent",
                      color: "inherit",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    Print
                  </a>
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      fontSize: "0.875rem",
                      background: showHistory ? "var(--primary)" : "transparent",
                      color: showHistory ? "white" : "inherit",
                      border: showHistory ? "none" : "1px solid var(--border)",
                    }}
                  >
                    History
                  </button>
                  <button
                    onClick={startEditingBasic}
                    style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setShowBirthModal(true)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      fontSize: "0.875rem",
                      background: "transparent",
                      color: "#198754",
                      border: "1px solid #198754",
                    }}
                  >
                    {cat.birth_event ? "Edit Birth Info" : "Record Birth Info"}
                  </button>
                  {!cat.is_deceased && (
                    <button
                      onClick={() => setShowDeceasedModal(true)}
                      style={{
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.875rem",
                        background: "transparent",
                        color: "#dc3545",
                        border: "1px solid #dc3545",
                      }}
                    >
                      Report Deceased
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Unchipped Cat Alert Banner */}
            {cat.needs_microchip && !editingBasic && (
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.75rem 1rem",
                  background: "#fef3c7",
                  border: "1px solid #f59e0b",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  color: "#92400e",
                }}
              >
                <strong>No Microchip:</strong> This cat does not have a microchip on record. It was identified via ClinicHQ Animal ID
                {cat.identifiers?.find(id => id.type === "clinichq_animal_id")?.value && (
                  <span style={{ fontFamily: "monospace", marginLeft: "0.25rem" }}>
                    ({cat.identifiers.find(id => id.type === "clinichq_animal_id")?.value})
                  </span>
                )}.
                This typically means the cat was euthanized before microchipping or the microchip was not recorded.
              </div>
            )}

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
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Breed</label>
                    <input
                      type="text"
                      value={editForm.breed}
                      onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })}
                      placeholder="e.g., DSH, Siamese"
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
                  <div style={{ fontFamily: "monospace", fontWeight: 500 }}>{cat.microchip || "—"}</div>
                </div>
                <MultiSourceField
                  label="Sex"
                  fieldName="sex"
                  primaryValue={cat.sex}
                  fieldSources={cat.field_sources}
                  formatValue={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
                />
                <div>
                  <div className="text-muted text-sm">Altered</div>
                  <div style={{ fontWeight: 500 }}>
                    {cat.altered_status && ["yes", "spayed", "neutered"].includes(cat.altered_status.toLowerCase()) ? (
                      <span style={{ color: "#198754" }}>
                        Yes {cat.altered_by_clinic ? "(by clinic)" : ""}
                        {cat.altered_status.toLowerCase() === "spayed" ? " — Spayed" :
                         cat.altered_status.toLowerCase() === "neutered" ? " — Neutered" : ""}
                      </span>
                    ) : cat.altered_status === "No" || cat.altered_status?.toLowerCase() === "intact" ? (
                      <span style={{ color: "#dc3545" }}>No</span>
                    ) : "Unknown"}
                  </div>
                </div>
                <MultiSourceField
                  label="Breed"
                  fieldName="breed"
                  primaryValue={cat.breed}
                  fieldSources={cat.field_sources}
                />
                <MultiSourceField
                  label="Color"
                  fieldName="primary_color"
                  primaryValue={cat.color ? `${cat.color}${cat.secondary_color ? ` / ${cat.secondary_color}` : ""}${cat.coat_pattern ? ` (${cat.coat_pattern})` : ""}` : null}
                  fieldSources={cat.field_sources}
                />
                <div>
                  <div className="text-muted text-sm">Weight</div>
                  <div style={{ fontWeight: 500 }}>
                    {latestWeight?.weight_lbs ? `${latestWeight.weight_lbs} lbs` : "—"}
                    {latestWeight?.recorded_at && (
                      <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>
                        ({formatDateLocal(latestWeight.recorded_at)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Status - FeLV/FIV prominent */}
          <div style={{
            background: "var(--section-bg)",
            borderRadius: "8px",
            padding: "1rem",
            border: "1px solid var(--border)",
            minWidth: "140px",
            textAlign: "center",
          }}>
            <div style={{ marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--muted)" }}>FeLV/FIV</div>
            {felvFivStatus.hasAnyTest ? (
              <>
                <div style={{
                  fontSize: "1.5rem",
                  fontWeight: "bold",
                  color: felvFivStatus.anyPositive ? "#dc3545" : "#198754",
                }}>
                  {felvFivStatus.anyPositive ? "POS" : "NEG"}
                </div>
                {/* Show individual results if available */}
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  {felvFivStatus.felvResult && (
                    <span style={{ color: felvFivStatus.felvResult === "positive" ? "#dc3545" : "#198754" }}>
                      FeLV: {felvFivStatus.felvResult === "positive" ? "+" : "-"}
                    </span>
                  )}
                  {felvFivStatus.felvResult && felvFivStatus.fivResult && " / "}
                  {felvFivStatus.fivResult && (
                    <span style={{ color: felvFivStatus.fivResult === "positive" ? "#dc3545" : "#198754" }}>
                      FIV: {felvFivStatus.fivResult === "positive" ? "+" : "-"}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: "1.25rem", color: "var(--muted)" }}>Not Tested</div>
            )}
            {felvFivStatus.testDate && (
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                {formatDateLocal(felvFivStatus.testDate)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── Tab: Overview ── */
  const overviewTab = (
    <>
      {!editingBasic && (
        <div className="card" style={{ padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
          <QuickActions
            entityType="cat"
            entityId={cat.cat_id}
            state={useCatQuickActionState({
              altered_status: cat.altered_status === "Yes" ? "altered" : cat.altered_status === "No" ? "intact" : "unknown",
              microchip: cat.microchip,
              owner_person_id: cat.owners?.[0]?.person_id,
              place_id: cat.places?.[0]?.place_id,
            })}
            onActionComplete={fetchCat}
          />
        </div>
      )}

      {/* Staff Quick Notes */}
      <QuickNotes
        entityType="cat"
        entityId={cat.cat_id}
        entries={journal}
        onNoteAdded={fetchJournal}
      />

      {(cat.primary_origin_place || (cat.partner_orgs && cat.partner_orgs.length > 0)) && (
        <Section title="Origin Information">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            {cat.primary_origin_place && (
              <div>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Origin Address</div>
                <div style={{ fontWeight: 500 }}>
                  <a href={`/places/${cat.primary_origin_place.place_id}`} style={{ color: "#0d6efd", textDecoration: "none" }}>
                    {cat.primary_origin_place.formatted_address}
                  </a>
                  {cat.primary_origin_place.inferred_source && (
                    <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                      (via {cat.primary_origin_place.inferred_source.replace(/_/g, " ")})
                    </span>
                  )}
                </div>
              </div>
            )}
            {cat.partner_orgs && cat.partner_orgs.length > 0 && (
              <div>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Came From</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {cat.partner_orgs.map((org) => (
                    <span
                      key={org.org_id}
                      className="badge"
                      style={{
                        background: org.org_name_short === "SCAS" ? "#0d6efd" :
                                    org.org_name_short === "FFSC" ? "#198754" : "#6c757d",
                        color: "#fff",
                        fontSize: "0.8rem",
                        padding: "0.35rem 0.75rem",
                      }}
                      title={`${org.org_name} - First seen: ${formatDateLocal(org.first_seen)}, ${org.appointment_count} appointments`}
                    >
                      {org.org_name_short || org.org_name}
                    </span>
                  ))}
                </div>
                <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  Cat came from {cat.partner_orgs.map(o => o.org_name_short || o.org_name).join(", ")}
                </div>
              </div>
            )}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: "0.75rem" }}>
            Origin data helps track where cats came from for population modeling and Beacon statistics.
          </p>
        </Section>
      )}

      <Section title="Medical Overview">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
          <div>
            <h3 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.75rem", textTransform: "uppercase" }}>Vaccines Received</h3>
            {(() => {
              const allVaccines = cat.appointments?.flatMap(v => v.vaccines || []).filter(Boolean) || [];
              const uniqueVaccines = [...new Set(allVaccines)];
              if (uniqueVaccines.length === 0) return <p className="text-muted">No vaccines recorded</p>;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {uniqueVaccines.map((vaccine, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--success-bg)", borderRadius: "6px", border: "1px solid var(--success-border)", color: "var(--success-text)" }}>
                      <span style={{ fontWeight: "bold" }}>+</span>
                      <span>{vaccine}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div>
            <h3 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.75rem", textTransform: "uppercase" }}>Treatments Given</h3>
            {(() => {
              const allTreatments = cat.appointments?.flatMap(v => v.treatments || []).filter(Boolean) || [];
              const uniqueTreatments = [...new Set(allTreatments)];
              if (uniqueTreatments.length === 0) return <p className="text-muted">No treatments recorded</p>;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {uniqueTreatments.map((treatment, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--info-bg)", borderRadius: "6px", border: "1px solid var(--info-border)", color: "var(--info-text)" }}>
                      <span style={{ fontWeight: "bold" }}>+</span>
                      <span>{treatment}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div>
            <h3 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.75rem", textTransform: "uppercase" }}>Conditions Observed</h3>
            {cat.conditions?.filter(c => !c.resolved_at).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {cat.conditions.filter(c => !c.resolved_at).map(cond => (
                  <div key={cond.condition_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: cond.severity === "severe" ? "#fff5f5" : cond.severity === "moderate" ? "#fff8e6" : "#fffbe6", borderRadius: "6px", border: `1px solid ${cond.severity === "severe" ? "#f5c6cb" : cond.severity === "moderate" ? "#ffe69c" : "#ffecb5"}` }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: cond.severity === "severe" ? "#dc3545" : cond.severity === "moderate" ? "#fd7e14" : "#ffc107" }} />
                    <span style={{ flex: 1 }}>{cond.condition_type.replace(/_/g, " ")}</span>
                    {cond.severity && <span style={{ fontSize: "0.75rem", color: "#6c757d" }}>({cond.severity})</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">No active conditions</p>
            )}
          </div>
        </div>
      </Section>

      {(cat.tests?.length > 0 || cat.procedures?.length > 0 || cat.conditions?.length > 0) && (
        <Section title="Medical Summary">
          <div className="detail-grid">
            {felvFivStatus.hasAnyTest && (
              <div className="detail-item">
                <span className="detail-label">FeLV/FIV Status</span>
                <span className="detail-value">
                  {felvFivStatus.felvResult && (
                    <span className="badge" style={{
                      background: felvFivStatus.felvResult === "negative" ? "#198754" : felvFivStatus.felvResult === "positive" ? "#dc3545" : "#ffc107",
                      color: felvFivStatus.felvResult === "positive" || felvFivStatus.felvResult === "negative" ? "#fff" : "#000",
                      marginRight: "0.25rem"
                    }}>
                      FeLV: {felvFivStatus.felvResult.toUpperCase()}
                    </span>
                  )}
                  {felvFivStatus.fivResult && (
                    <span className="badge" style={{
                      background: felvFivStatus.fivResult === "negative" ? "#198754" : felvFivStatus.fivResult === "positive" ? "#dc3545" : "#ffc107",
                      color: felvFivStatus.fivResult === "positive" || felvFivStatus.fivResult === "negative" ? "#fff" : "#000"
                    }}>
                      FIV: {felvFivStatus.fivResult.toUpperCase()}
                    </span>
                  )}
                  {felvFivStatus.testDate && (
                    <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>({formatDateLocal(felvFivStatus.testDate)})</span>
                  )}
                </span>
              </div>
            )}
            {cat.procedures?.filter(p => p.is_spay || p.is_neuter).slice(0, 1).map(proc => (
              <div className="detail-item" key={proc.procedure_id}>
                <span className="detail-label">{proc.is_spay ? "Spay" : "Neuter"}</span>
                <span className="detail-value">
                  <span className="badge" style={{ background: "#198754", color: "#fff" }}>Completed</span>
                  <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>{formatDateLocal(proc.procedure_date)}{proc.performed_by && ` by ${proc.performed_by}`}</span>
                </span>
              </div>
            ))}
            {cat.conditions?.filter(c => !c.resolved_at).length > 0 && (
              <div className="detail-item" style={{ gridColumn: "span 2" }}>
                <span className="detail-label">Active Conditions</span>
                <span className="detail-value" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {cat.conditions.filter(c => !c.resolved_at).map(cond => (
                    <span key={cond.condition_id} className="badge" style={{ background: cond.severity === "severe" ? "#dc3545" : cond.severity === "moderate" ? "#fd7e14" : cond.severity === "mild" ? "#ffc107" : "#6c757d", color: cond.severity === "mild" ? "#000" : "#fff" }} title={`Diagnosed ${formatDateLocal(cond.diagnosed_at)}`}>
                      {cond.condition_type.replace(/_/g, " ")}{cond.severity && ` (${cond.severity})`}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {cat.vitals?.length > 0 && cat.vitals[0].temperature_f && (
              <div className="detail-item">
                <span className="detail-label">Last Temperature</span>
                <span className="detail-value">
                  {cat.vitals[0].temperature_f}°F
                  <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>({formatDateLocal(cat.vitals[0].recorded_at)})</span>
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {cat.identifiers && cat.identifiers.length > 0 && (
        <Section title="Identifiers">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {cat.identifiers.map((ident, idx) => (
              <div key={idx} className="identifier-badge">
                <strong>{ident.type}:</strong>{" "}
                <code>{ident.value}</code>
                {ident.source && (
                  <span className="text-muted" style={{ marginLeft: "0.5rem" }}>({ident.source})</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Journal */}
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
          {cat.first_appointment_date && (
            <div className="detail-item">
              <span className="detail-label">First Appointment</span>
              <span className="detail-value">{formatDateLocal(cat.first_appointment_date)}</span>
            </div>
          )}
          {cat.total_appointments > 0 && (
            <div className="detail-item">
              <span className="detail-label">Total Appointments</span>
              <span className="detail-value">{cat.total_appointments}</span>
            </div>
          )}
          <div className="detail-item">
            <span className="detail-label">Atlas Created</span>
            <span className="detail-value">{formatDateLocal(cat.created_at)}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Last Updated</span>
            <span className="detail-value">{formatDateLocal(cat.updated_at)}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Verification</span>
            <span className="detail-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <VerificationBadge table="cats" recordId={cat.cat_id} verifiedAt={cat.verified_at} verifiedBy={cat.verified_by_name} onVerify={() => fetchCat()} />
              {cat.verified_at && <LastVerified verifiedAt={cat.verified_at} verifiedBy={cat.verified_by_name} />}
            </span>
          </div>
        </div>
      </Section>
    </>
  );

  /* ── Tab: Medical ── */
  const medicalTab = (
    <>
      {cat.sex === "female" && cat.vitals && cat.vitals.length > 0 && (
        (() => {
          const reproVitals = cat.vitals.filter(v => v.is_pregnant || v.is_lactating || v.is_in_heat);
          const hasReproData = reproVitals.length > 0;
          const latestRepro = reproVitals[0];

          return (
            <Section title="Reproduction Status">
              {hasReproData ? (
                <div>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                    {latestRepro?.is_pregnant && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: "#fdf2f8", border: "2px solid #ec4899", borderRadius: "8px" }}>
                        <span style={{ fontSize: "1.5rem" }}>🤰</span>
                        <div>
                          <div style={{ fontWeight: 600, color: "#ec4899" }}>Pregnant</div>
                          <div className="text-muted text-sm">{formatDateLocal(latestRepro.recorded_at)}</div>
                        </div>
                      </div>
                    )}
                    {latestRepro?.is_lactating && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: "#f5f3ff", border: "2px solid #8b5cf6", borderRadius: "8px" }}>
                        <span style={{ fontSize: "1.5rem" }}>🍼</span>
                        <div>
                          <div style={{ fontWeight: 600, color: "#8b5cf6" }}>Lactating</div>
                          <div className="text-muted text-sm">{formatDateLocal(latestRepro.recorded_at)}</div>
                        </div>
                      </div>
                    )}
                    {latestRepro?.is_in_heat && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: "#fff7ed", border: "2px solid #f97316", borderRadius: "8px" }}>
                        <span style={{ fontSize: "1.5rem" }}>🔥</span>
                        <div>
                          <div style={{ fontWeight: 600, color: "#f97316" }}>In Heat</div>
                          <div className="text-muted text-sm">{formatDateLocal(latestRepro.recorded_at)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  {reproVitals.length > 1 && (
                    <div>
                      <h4 style={{ fontSize: "0.875rem", color: "#6c757d", marginBottom: "0.5rem" }}>Reproduction History</h4>
                      <div className="table-container">
                        <table>
                          <thead><tr><th>Date</th><th>Status</th></tr></thead>
                          <tbody>
                            {reproVitals.slice(0, 5).map(v => (
                              <tr key={v.vital_id}>
                                <td>{formatDateLocal(v.recorded_at)}</td>
                                <td>
                                  <div style={{ display: "flex", gap: "0.25rem" }}>
                                    {v.is_pregnant && <span style={{ padding: "0.2rem 0.5rem", background: "#fdf2f8", color: "#ec4899", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 500 }}>Pregnant</span>}
                                    {v.is_lactating && <span style={{ padding: "0.2rem 0.5rem", background: "#f5f3ff", color: "#8b5cf6", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 500 }}>Lactating</span>}
                                    {v.is_in_heat && <span style={{ padding: "0.2rem 0.5rem", background: "#fff7ed", color: "#f97316", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 500 }}>In Heat</span>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <p className="text-muted text-sm" style={{ marginTop: "0.75rem" }}>
                    Reproduction indicators are extracted from clinic appointment notes. Used by Beacon for birth rate estimation and kitten surge prediction.
                  </p>
                </div>
              ) : (
                <p className="text-muted">No reproduction indicators recorded for this cat.</p>
              )}
            </Section>
          );
        })()
      )}

      {cat.birth_event && (
        <Section title="Birth Information">
          <div style={{ padding: "1rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Birth Date</div>
                <div style={{ fontWeight: 600 }}>
                  {cat.birth_event.birth_date ? formatDateLocal(cat.birth_event.birth_date) : cat.birth_event.birth_year ? `${cat.birth_event.birth_season || ""} ${cat.birth_event.birth_year}` : "Unknown"}
                  {cat.birth_event.birth_date_precision && cat.birth_event.birth_date_precision !== "exact" && (
                    <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>({cat.birth_event.birth_date_precision})</span>
                  )}
                </div>
              </div>
              {cat.birth_event.mother_cat_id && (
                <div>
                  <div className="text-muted text-sm">Mother</div>
                  <div><a href={`/cats/${cat.birth_event.mother_cat_id}`} style={{ fontWeight: 500, color: "#0d6efd" }}>{cat.birth_event.mother_name || "Unknown"}</a></div>
                </div>
              )}
              {cat.birth_event.place_id && (
                <div>
                  <div className="text-muted text-sm">Birth Location</div>
                  <div><a href={`/places/${cat.birth_event.place_id}`} style={{ fontWeight: 500, color: "#0d6efd" }}>{cat.birth_event.place_name || "Unknown"}</a></div>
                </div>
              )}
              {cat.birth_event.kitten_count_in_litter && (
                <div>
                  <div className="text-muted text-sm">Litter Size</div>
                  <div style={{ fontWeight: 500 }}>
                    {cat.birth_event.kitten_count_in_litter} kittens
                    {cat.birth_event.litter_survived_count !== null && <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>({cat.birth_event.litter_survived_count} survived)</span>}
                  </div>
                </div>
              )}
              {cat.birth_event.survived_to_weaning !== null && (
                <div>
                  <div className="text-muted text-sm">Survived to Weaning</div>
                  <div style={{ fontWeight: 500, color: cat.birth_event.survived_to_weaning ? "#16a34a" : "#dc2626" }}>{cat.birth_event.survived_to_weaning ? "Yes" : "No"}</div>
                </div>
              )}
            </div>
            {cat.siblings && cat.siblings.length > 0 && (
              <div style={{ borderTop: "1px solid #bbf7d0", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>Littermates ({cat.siblings.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {cat.siblings.map(sibling => (
                    <a key={sibling.cat_id} href={`/cats/${sibling.cat_id}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", textDecoration: "none", color: "inherit" }}>
                      <span style={{ fontSize: "1.25rem" }}>🐱</span>
                      <div>
                        <div style={{ fontWeight: 500 }}>{sibling.display_name}</div>
                        {sibling.sex && <div className="text-muted text-sm">{sibling.sex}</div>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {cat.birth_event.notes && (
              <div style={{ borderTop: "1px solid #bbf7d0", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Notes</div>
                <p style={{ margin: 0, fontSize: "0.9rem" }}>{cat.birth_event.notes}</p>
              </div>
            )}
            <p className="text-muted text-sm" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>Birth data used by Beacon for population modeling and litter tracking.</p>
          </div>
        </Section>
      )}

      {cat.is_deceased && cat.mortality_event && (
        <Section title="Mortality Record">
          <div style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Cause of Death</div>
                <div style={{ fontWeight: 600, textTransform: "capitalize", color: "#dc2626" }}>{cat.mortality_event.death_cause}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Age Category</div>
                <div style={{ fontWeight: 500, textTransform: "capitalize" }}>{cat.mortality_event.death_age_category}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Date of Death</div>
                <div style={{ fontWeight: 500 }}>{cat.mortality_event.death_date ? formatDateLocal(cat.mortality_event.death_date) : cat.deceased_date ? formatDateLocal(cat.deceased_date) : "Unknown"}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Recorded</div>
                <div className="text-muted text-sm">{formatDateLocal(cat.mortality_event.created_at)}</div>
              </div>
            </div>
            {cat.mortality_event.notes && (
              <div style={{ borderTop: "1px solid #fecaca", paddingTop: "0.75rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Notes</div>
                <p style={{ margin: 0, fontSize: "0.9rem" }}>{cat.mortality_event.notes}</p>
              </div>
            )}
            <p className="text-muted text-sm" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>Mortality data used by Beacon for survival rate calculations and population modeling.</p>
          </div>
        </Section>
      )}

      {(latestTemp || latestWeight) && (
        <Section title="Latest Vitals">
          <div className="detail-grid">
            {latestTemp?.temperature_f && (
              <div className="detail-item">
                <span className="detail-label">Temperature</span>
                <span className="detail-value">{latestTemp.temperature_f}°F</span>
              </div>
            )}
            {latestWeight?.weight_lbs && (
              <div className="detail-item">
                <span className="detail-label">Weight</span>
                <span className="detail-value">{latestWeight.weight_lbs} lbs</span>
              </div>
            )}
            <div className="detail-item">
              <span className="detail-label">Recorded</span>
              <span className="detail-value">{formatDateLocal((latestTemp || latestWeight)?.recorded_at || "")}</span>
            </div>
          </div>
        </Section>
      )}

      {(cat.procedures?.length > 0 || cat.tests?.length > 0 || cat.conditions?.length > 0) && (
        <Section title="Medical History">
          {cat.procedures?.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Procedures ({cat.procedures.length})</h3>
              <div className="table-container">
                <table>
                  <thead><tr><th>Date</th><th>Procedure</th><th>Vet</th><th>Notes</th></tr></thead>
                  <tbody>
                    {cat.procedures.map(proc => (
                      <tr key={proc.procedure_id}>
                        <td>{formatDateLocal(proc.procedure_date)}</td>
                        <td><span className="badge" style={{ background: "#198754", color: "#fff" }}>{proc.procedure_type.replace(/_/g, " ")}</span></td>
                        <td>{proc.performed_by || "—"}</td>
                        <td>
                          {proc.complications && proc.complications.length > 0 && <span className="text-sm" style={{ color: "#dc3545" }}>{proc.complications.join(", ")}</span>}
                          {proc.post_op_notes && <span className="text-sm text-muted">{proc.complications?.length ? " | " : ""}{proc.post_op_notes}</span>}
                          {!proc.complications?.length && !proc.post_op_notes && "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {cat.tests?.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Test Results ({cat.tests.length})</h3>
              <div className="table-container">
                <table>
                  <thead><tr><th>Date</th><th>Test</th><th>Result</th><th>Details</th></tr></thead>
                  <tbody>
                    {cat.tests.map(test => (
                      <tr key={test.test_id}>
                        <td>{formatDateLocal(test.test_date)}</td>
                        <td>{test.test_type.replace(/_/g, " ")}</td>
                        <td><span className="badge" style={{ background: test.result === "negative" ? "#198754" : test.result === "positive" ? "#dc3545" : "#ffc107", color: test.result === "positive" || test.result === "negative" ? "#fff" : "#000" }}>{test.result}</span></td>
                        <td className="text-muted">{test.result_detail || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {cat.conditions?.length > 0 && (
            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Conditions ({cat.conditions.length})</h3>
              <div className="table-container">
                <table>
                  <thead><tr><th>Diagnosed</th><th>Condition</th><th>Severity</th><th>Status</th></tr></thead>
                  <tbody>
                    {cat.conditions.map(cond => (
                      <tr key={cond.condition_id}>
                        <td>{formatDateLocal(cond.diagnosed_at)}</td>
                        <td>{cond.condition_type.replace(/_/g, " ")}</td>
                        <td>{cond.severity ? <span className="badge" style={{ background: cond.severity === "severe" ? "#dc3545" : cond.severity === "moderate" ? "#fd7e14" : cond.severity === "mild" ? "#ffc107" : "#6c757d", color: cond.severity === "mild" ? "#000" : "#fff" }}>{cond.severity}</span> : "—"}</td>
                        <td>{cond.resolved_at ? <span className="text-muted">Resolved {formatDateLocal(cond.resolved_at)}</span> : cond.is_chronic ? <span className="badge" style={{ background: "#6c757d", color: "#fff" }}>Chronic</span> : <span className="badge" style={{ background: "#fd7e14", color: "#fff" }}>Active</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Appointment History">
        {cat.appointments && cat.appointments.length > 0 ? (
          <div className="table-container">
            <table>
              <thead><tr><th style={{ width: "2.5rem", textAlign: "center" }} title="Clinic day number (from waiver)">Day #</th><th>Date</th><th>Type</th><th>Services</th><th>Vet</th></tr></thead>
              <tbody>
                {cat.appointments.map((appt) => (
                  <tr
                    key={appt.appointment_id}
                    onClick={() => setSelectedAppointmentId(appt.appointment_id)}
                    style={{ cursor: "pointer" }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "var(--section-bg, #f8f9fa)")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td
                      style={{ textAlign: "center", width: "2.5rem", padding: "0.25rem" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingClinicNum(appt.appointment_id);
                        setClinicNumValue(appt.clinic_day_number != null ? String(appt.clinic_day_number) : "");
                      }}
                    >
                      {editingClinicNum === appt.appointment_id ? (
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={clinicNumValue}
                          onChange={(e) => setClinicNumValue(e.target.value)}
                          onBlur={() => handleSaveClinicNum(appt.appointment_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveClinicNum(appt.appointment_id);
                            if (e.key === "Escape") setEditingClinicNum(null);
                          }}
                          autoFocus
                          style={{
                            width: "2.5rem",
                            textAlign: "center",
                            border: "1px solid var(--border, #dee2e6)",
                            borderRadius: "3px",
                            fontSize: "0.8rem",
                            padding: "0.1rem",
                            background: "var(--bg-secondary, #fff)",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : appt.clinic_day_number != null ? (
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--accent, #0d6efd)" }}>
                          {appt.clinic_day_number}
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted, #adb5bd)", cursor: "pointer" }} title="Set clinic day number">
                          +
                        </span>
                      )}
                    </td>
                    <td>{formatDateLocal(appt.appointment_date)}</td>
                    <td>
                      <span className="badge" style={{ background: appt.appointment_category === "Spay/Neuter" ? "#198754" : appt.appointment_category === "Wellness" ? "#0d6efd" : appt.appointment_category === "Recheck" ? "#6f42c1" : appt.appointment_category === "Euthanasia" ? "#dc3545" : appt.appointment_category === "TNR" ? "#17a2b8" : appt.appointment_category === "Clinic Visit" ? "#6c757d" : "#adb5bd", color: "#fff" }}>
                        {appt.appointment_category}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {appt.is_spay && <span className="badge" style={{ background: "#e9ecef", color: "#495057", fontSize: "0.7rem" }}>Spay</span>}
                        {appt.is_neuter && <span className="badge" style={{ background: "#e9ecef", color: "#495057", fontSize: "0.7rem" }}>Neuter</span>}
                        {appt.vaccines?.map((v, i) => <span key={i} className="badge" style={{ background: "#d1e7dd", color: "#0f5132", fontSize: "0.7rem" }}>{v}</span>)}
                        {appt.treatments?.map((t, i) => <span key={i} className="badge" style={{ background: "#cfe2ff", color: "#084298", fontSize: "0.7rem" }}>{t}</span>)}
                      </div>
                    </td>
                    <td>{appt.vet_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">No appointments recorded for this cat.</p>
        )}
      </Section>

      {/* Clinic History - moved from activity tab */}
      {((cat.enhanced_clinic_history && cat.enhanced_clinic_history.length > 0) ||
        (cat.clinic_history && cat.clinic_history.length > 0)) && (
        <Section title="Clinic History">
          <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
            Cat appointment records with origin address and source information
          </p>
          <div className="table-container">
            <table>
              <thead><tr><th>Date</th><th>Contact</th><th>Origin Address</th><th>Source</th></tr></thead>
              <tbody>
                {(cat.enhanced_clinic_history || cat.clinic_history || []).map((appt, idx) => (
                  <tr key={idx}>
                    <td>{formatDateLocal(appt.appointment_date)}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{appt.client_name || "—"}</div>
                      {appt.client_email && <div className="text-muted text-sm">{appt.client_email}</div>}
                      {appt.client_phone && <div className="text-muted text-sm">{formatPhone(appt.client_phone)}</div>}
                    </td>
                    <td>
                      {"origin_address" in appt && appt.origin_address ? (
                        <span style={{ fontWeight: 500, color: "#198754" }}>{appt.origin_address}</span>
                      ) : appt.client_address ? (
                        appt.client_address
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {"partner_org_short" in appt && appt.partner_org_short ? (
                        <span className="badge" style={{ background: appt.partner_org_short === "SCAS" ? "#0d6efd" : appt.partner_org_short === "FFSC" ? "#198754" : "#6c757d", color: "#fff", fontSize: "0.7rem" }} title={`Cat came from ${appt.partner_org_short}`}>
                          {appt.partner_org_short}
                        </span>
                      ) : appt.ownership_type ? (
                        <span className="badge" style={{ background: appt.ownership_type.includes("Feral") ? "#6c757d" : "#0d6efd", color: "#fff", fontSize: "0.7rem" }}>
                          {appt.ownership_type}
                        </span>
                      ) : (
                        <span className="text-muted">Direct</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );

  /* ── Tab: Connections ── */
  const connectionsTab = (
    <>
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>People</h2>
          <button
            onClick={() => setShowTransferWizard(true)}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
          >
            Transfer Ownership
          </button>
        </div>
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
      </div>

      <Section title="Places">
        {cat.places && cat.places.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.places.map((catPlace) => (
              <EntityLink
                key={catPlace.place_id}
                href={`/places/${catPlace.place_id}`}
                label={catPlace.label}
                badge={catPlace.place_kind || catPlace.role}
                badgeColor={catPlace.role === "residence" ? "#198754" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No places linked to this cat.</p>
        )}
      </Section>

      <Section title="Movement & Reunification">
        <CatMovementSection catId={id} />
      </Section>
    </>
  );

  return (
    <ProfileLayout
      header={profileHeader}
      tabs={[
        { id: "overview", label: "Overview", content: overviewTab },
        { id: "medical", label: "Medical", content: medicalTab },
        { id: "connections", label: "Connections", content: connectionsTab, badge: (cat.owners?.length || 0) + (cat.places?.length || 0) || undefined },
      ]}
      defaultTab="overview"
    >
      {/* Edit History Panel */}
      {showHistory && (
        <div style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "400px",
          background: "var(--card-bg)",
          borderLeft: "1px solid var(--border)",
          padding: "1.5rem",
          overflowY: "auto",
          zIndex: 100,
          boxShadow: "-4px 0 10px rgba(0,0,0,0.2)"
        }}>
          <EditHistory entityType="cat" entityId={id} limit={50} onClose={() => setShowHistory(false)} />
        </div>
      )}

      {/* Ownership Transfer Wizard */}
      {showTransferWizard && (
        <div style={{
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
        }}>
          <div style={{
            background: "var(--card-bg)",
            borderRadius: "8px",
            maxWidth: "600px",
            width: "90%",
            maxHeight: "90vh",
            overflow: "auto",
          }}>
            <OwnershipTransferWizard
              catId={id}
              catName={cat.display_name}
              currentOwnerId={cat.owners?.[0]?.person_id || null}
              currentOwnerName={cat.owners?.[0]?.display_name || null}
              onComplete={() => { setShowTransferWizard(false); fetchCat(); }}
              onCancel={() => setShowTransferWizard(false)}
            />
          </div>
        </div>
      )}

      <ReportDeceasedModal
        isOpen={showDeceasedModal}
        onClose={() => setShowDeceasedModal(false)}
        catId={id}
        catName={cat.display_name}
        linkedPlaces={cat.places?.map(p => ({ place_id: p.place_id, label: p.label })) || []}
        onSuccess={() => { fetchCat(); }}
      />

      <RecordBirthModal
        isOpen={showBirthModal}
        onClose={() => setShowBirthModal(false)}
        catId={id}
        catName={cat.display_name}
        linkedPlaces={cat.places?.map(p => ({ place_id: p.place_id, label: p.label })) || []}
        existingBirthEvent={cat.birth_event}
        onSuccess={() => { fetchCat(); }}
      />

      <AppointmentDetailModal
        appointmentId={selectedAppointmentId}
        onClose={() => setSelectedAppointmentId(null)}
      />
    </ProfileLayout>
  );
}
