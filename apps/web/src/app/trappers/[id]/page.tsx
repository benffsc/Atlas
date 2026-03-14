"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { TrapperBadge } from "@/components/badges";
import { TrapperStatsCard } from "@/components/cards";
import { BackButton } from "@/components/common";
import PlaceResolver, { type ResolvedPlace } from "@/components/forms/PlaceResolver";
import { fetchApi, postApi, ApiError } from "@/lib/api-client";
import { JournalSection } from "@/components/sections";
import type { JournalEntry } from "@/components/sections";

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
  email: string | null;
  phone: string | null;
  availability_status: string;
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

interface Contract {
  contract_id: string;
  person_id: string;
  contract_type: string;
  status: string;
  signed_date: string | null;
  expiration_date: string | null;
  service_area_description: string | null;
  contract_notes: string | null;
  renewed_from_contract_id: string | null;
  is_expiring_soon: boolean;
  is_expired: boolean;
  created_at: string;
}

interface Assignment {
  assignment_id: string;
  request_id: string;
  request_address: string | null;
  request_status: string;
  assignment_type: string;
  assignment_status: string;
  assigned_at: string;
  notes: string | null;
  estimated_cat_count: number | null;
  cats_attributed: number;
}

interface ChangeHistoryEntry {
  edit_id: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  editor: string;
  edit_source: string;
  created_at: string;
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
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryEntry[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Contract form state
  const [showAddContract, setShowAddContract] = useState(false);
  const [newContractType, setNewContractType] = useState("community_limited");
  const [newContractSignedDate, setNewContractSignedDate] = useState(new Date().toISOString().split("T")[0]);
  const [newContractExpDate, setNewContractExpDate] = useState("");
  const [newContractAreaDesc, setNewContractAreaDesc] = useState("");
  const [newContractNotes, setNewContractNotes] = useState("");
  const [newContractExpirePrev, setNewContractExpirePrev] = useState(true);
  const [addingContract, setAddingContract] = useState(false);
  const [terminatingContractId, setTerminatingContractId] = useState<string | null>(null);

  // Confirm modal state for status/type/availability changes
  const [confirmAction, setConfirmAction] = useState<{
    field: string;
    label: string;
    currentValue: string;
    newValue: string;
    currentLabel: string;
    newLabel: string;
    isDangerous: boolean;
  } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Service area form state
  const [showAddArea, setShowAddArea] = useState(false);
  const [newAreaPlace, setNewAreaPlace] = useState<ResolvedPlace | null>(null);
  const [newAreaType, setNewAreaType] = useState("regular");
  const [addingArea, setAddingArea] = useState(false);
  const [areaConflicts, setAreaConflicts] = useState<Array<{
    person_id: string;
    person_name: string;
    service_type: string;
    place_name: string;
    match_type: string;
  }>>([]);

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
    certified_date: string;
  }>({ notes: "", rescue_name: "", has_signed_contract: false, contract_signed_date: "", contract_areas: "", certified_date: "" });
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

  const fetchAssignments = useCallback(async () => {
    try {
      const data = await fetchApi<{ assignments: Assignment[] }>(`/api/people/${id}/assignments`);
      setAssignments(data.assignments || []);
    } catch (err) {
      console.error("Failed to fetch assignments:", err);
    }
  }, [id]);

  const fetchChangeHistory = useCallback(async () => {
    try {
      const data = await fetchApi<{ history: ChangeHistoryEntry[] }>(`/api/entities/person/${id}/history?limit=20`);
      setChangeHistory(data.history || []);
    } catch (err) {
      console.error("Failed to fetch change history:", err);
    }
  }, [id]);

  const fetchJournalEntries = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(
        `/api/journal?person_id=${id}&include_related=true&limit=50`
      );
      setJournalEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal entries:", err);
    }
  }, [id]);

  const fetchContracts = useCallback(async () => {
    try {
      const data = await fetchApi<{ contracts: Contract[] }>(`/api/people/${id}/contracts`);
      setContracts(data.contracts || []);
    } catch (err) {
      console.error("Failed to fetch contracts:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([
        fetchStats(), fetchManualCatches(), fetchServiceAreas(),
        fetchProfile(), fetchAssignments(), fetchChangeHistory(),
        fetchJournalEntries(), fetchContracts(),
      ]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchStats, fetchManualCatches, fetchServiceAreas, fetchProfile, fetchAssignments, fetchChangeHistory, fetchJournalEntries, fetchContracts]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return phone;
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  const FIELD_LABELS: Record<string, string> = {
    role_status: "Status",
    trapper_type: "Trapper Type",
    availability_status: "Availability",
    has_signed_contract: "Contract",
    notes: "Notes",
    rescue_name: "Rescue Name",
  };

  const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
    active: { bg: "#dcfce7", color: "#166534" },
    completed: { bg: "#dbeafe", color: "#1e40af" },
    declined: { bg: "#fee2e2", color: "#b91c1c" },
  };

  const TYPE_LABELS: Record<string, string> = {
    coordinator: "Coordinator",
    head_trapper: "Head Trapper",
    ffsc_trapper: "FFSC Trapper",
    community_trapper: "Community Trapper",
  };

  const STATUS_LABELS: Record<string, string> = {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
    revoked: "Revoked",
  };

  const AVAILABILITY_LABELS: Record<string, string> = {
    available: "Available",
    busy: "Busy",
    on_leave: "On Leave",
  };

  const DANGEROUS_CHANGES = new Set(["suspended", "revoked"]);

  const requestChange = (field: string, newValue: string) => {
    let currentValue = "";
    let labels: Record<string, string> = {};

    if (field === "status") {
      currentValue = profile?.is_active ? "active" : "inactive";
      labels = STATUS_LABELS;
    } else if (field === "type") {
      currentValue = stats?.trapper_type || "community_trapper";
      labels = TYPE_LABELS;
    } else if (field === "availability") {
      currentValue = stats?.availability_status || "available";
      labels = AVAILABILITY_LABELS;
    }

    if (currentValue === newValue) return;

    setConfirmAction({
      field,
      label: field === "status" ? "Status" : field === "type" ? "Trapper Type" : "Availability",
      currentValue,
      newValue,
      currentLabel: labels[currentValue] || currentValue,
      newLabel: labels[newValue] || newValue,
      isDangerous: DANGEROUS_CHANGES.has(newValue) ||
        (field === "type" && !!stats?.is_ffsc_trapper && newValue === "community_trapper"),
    });
    setConfirmReason("");
  };

  const executeChange = async () => {
    if (!confirmAction) return;
    setConfirming(true);
    try {
      await postApi("/api/trappers", {
        person_id: id,
        action: confirmAction.field,
        value: confirmAction.newValue,
        reason: confirmReason || null,
      }, { method: "PATCH" });

      await Promise.all([fetchStats(), fetchProfile(), fetchChangeHistory()]);
      setConfirmAction(null);
      setConfirmReason("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setConfirming(false);
    }
  };

  const handleAddServiceArea = async () => {
    if (!newAreaPlace) return;
    setAddingArea(true);
    try {
      const result = await postApi<{
        id: string;
        action: string;
        conflicts: Array<{
          person_id: string;
          person_name: string;
          service_type: string;
          place_name: string;
          match_type: string;
        }>;
      }>(`/api/people/${id}/service-areas`, {
        place_id: newAreaPlace.place_id,
        service_type: newAreaType,
      });
      await fetchServiceAreas();
      // Show conflicts briefly if any, then close form
      if (result.conflicts && result.conflicts.length > 0) {
        setAreaConflicts(result.conflicts);
      } else {
        setAreaConflicts([]);
      }
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
      certified_date: profile.certified_date || "",
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
        certified_date: editProfile.certified_date || null,
      }, { method: "PATCH" });

      await Promise.all([fetchProfile(), fetchChangeHistory()]);
      setEditingProfile(false);
    } catch (err) {
      console.error("Failed to save profile:", err);
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingProfile(false);
    }
  };

  const CONTRACT_TYPE_LABELS: Record<string, string> = {
    ffsc_volunteer: "FFSC Volunteer",
    community_limited: "Community Limited",
    colony_caretaker: "Colony Caretaker",
    rescue_partnership: "Rescue Partnership",
  };

  const CONTRACT_STATUS_STYLES: Record<string, { bg: string; color: string }> = {
    active: { bg: "#dcfce7", color: "#166534" },
    pending: { bg: "#fef3c7", color: "#92400e" },
    expired: { bg: "#fee2e2", color: "#b91c1c" },
    terminated: { bg: "#f3f4f6", color: "#6b7280" },
  };

  const handleAddContract = async () => {
    setAddingContract(true);
    try {
      await postApi(`/api/people/${id}/contracts`, {
        contract_type: newContractType,
        signed_date: newContractSignedDate || undefined,
        expiration_date: newContractExpDate || undefined,
        service_area_description: newContractAreaDesc || undefined,
        contract_notes: newContractNotes || undefined,
        expire_previous: newContractExpirePrev,
      });
      await Promise.all([fetchContracts(), fetchProfile(), fetchChangeHistory()]);
      setShowAddContract(false);
      setNewContractType("community_limited");
      setNewContractSignedDate(new Date().toISOString().split("T")[0]);
      setNewContractExpDate("");
      setNewContractAreaDesc("");
      setNewContractNotes("");
    } catch (err) {
      console.error("Failed to create contract:", err);
      alert(err instanceof Error ? err.message : "Failed to create contract");
    } finally {
      setAddingContract(false);
    }
  };

  const handleTerminateContract = async (contractId: string) => {
    const reason = prompt("Reason for termination:");
    if (reason === null) return;
    setTerminatingContractId(contractId);
    try {
      await postApi(`/api/people/${id}/contracts/${contractId}`, {
        status: "terminated",
        reason: reason || "Manually terminated",
      }, { method: "PATCH" });
      await Promise.all([fetchContracts(), fetchProfile(), fetchChangeHistory()]);
    } catch (err) {
      console.error("Failed to terminate contract:", err);
      alert(err instanceof Error ? err.message : "Failed to terminate contract");
    } finally {
      setTerminatingContractId(null);
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
          {stats.availability_status && stats.availability_status !== "available" && (
            <span style={{
              padding: "0.2rem 0.6rem",
              borderRadius: "9999px",
              fontSize: "0.75rem",
              fontWeight: 500,
              background: stats.availability_status === "busy" ? "#fef3c7" : "#f3f4f6",
              color: stats.availability_status === "busy" ? "#92400e" : "#6b7280",
            }}>
              {stats.availability_status === "busy" ? "Busy" : "On Leave"}
            </span>
          )}
        </div>

        {/* Contact Info + Quick Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          {stats.email && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <a href={`mailto:${stats.email}`} style={{ fontSize: "0.875rem" }}>{stats.email}</a>
              <button
                onClick={() => copyToClipboard(stats.email!, "email")}
                title="Copy email"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "0.75rem", color: copiedField === "email" ? "#16a34a" : "#9ca3af",
                  padding: "0.125rem 0.25rem",
                }}
              >
                {copiedField === "email" ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          {stats.phone && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <a href={`tel:${stats.phone.replace(/\D/g, "")}`} style={{ fontSize: "0.875rem" }}>
                {formatPhone(stats.phone)}
              </a>
              <button
                onClick={() => copyToClipboard(stats.phone!, "phone")}
                title="Copy phone"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "0.75rem", color: copiedField === "phone" ? "#16a34a" : "#9ca3af",
                  padding: "0.125rem 0.25rem",
                }}
              >
                {copiedField === "phone" ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          {!stats.email && !stats.phone && (
            <span className="text-muted" style={{ fontSize: "0.875rem" }}>No contact info on file</span>
          )}
          <a href={`/people/${id}`} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            View person record
          </a>
          <a href={`/map?layers=trapper_territories&trapper=${id}`} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            View on Map
          </a>
        </div>
      </div>

      {/* Performance Summary — FFS-570 */}
      {(() => {
        const tenure = stats.first_activity_date
          ? Math.floor((Date.now() - new Date(stats.first_activity_date).getTime()) / 86400000)
          : 0;
        const tenureLabel = tenure > 365
          ? `${Math.floor(tenure / 365)}y ${Math.floor((tenure % 365) / 30)}mo`
          : tenure > 30
          ? `${Math.floor(tenure / 30)} months`
          : `${tenure} days`;
        const daysSinceLast = stats.last_activity_date
          ? Math.floor((Date.now() - new Date(stats.last_activity_date).getTime()) / 86400000)
          : null;
        const isDormant = daysSinceLast !== null && daysSinceLast > 90;
        const catsPerMonth = tenure > 30 && stats.total_cats_caught > 0
          ? (stats.total_cats_caught / (tenure / 30)).toFixed(1)
          : null;

        return (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "0.75rem",
            marginBottom: "1.5rem",
            padding: "1rem",
            background: isDormant ? "#fffbeb" : "#f0fdf4",
            borderRadius: "10px",
            border: `1px solid ${isDormant ? "#fde68a" : "#bbf7d0"}`,
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#166534" }}>
                {stats.total_cats_caught}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#666" }}>Total Caught</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {stats.active_assignments}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#666" }}>Active Assignments</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {stats.unique_clinic_days}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#666" }}>Clinic Days</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {tenureLabel}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#666" }}>Tenure</div>
            </div>
            {catsPerMonth && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0d6efd" }}>
                  {catsPerMonth}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#666" }}>Cats/Month</div>
              </div>
            )}
            <div style={{ textAlign: "center" }}>
              <div style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: isDormant ? "#b45309" : daysSinceLast !== null && daysSinceLast < 30 ? "#166534" : "#666",
              }}>
                {daysSinceLast !== null ? (
                  daysSinceLast === 0 ? "Today" : `${daysSinceLast}d`
                ) : "—"}
              </div>
              <div style={{ fontSize: "0.7rem", color: isDormant ? "#b45309" : "#666" }}>
                {isDormant ? "Dormant" : "Since Last Activity"}
              </div>
            </div>
          </div>
        );
      })()}

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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
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

                {/* Trapper Type — Editable */}
                <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Type
                  </div>
                  <select
                    value={stats?.trapper_type || "community_trapper"}
                    onChange={(e) => requestChange("type", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.35rem 0.5rem",
                      fontSize: "0.85rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {Object.entries(TYPE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  {profile.tier && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.4rem" }}>
                      {profile.tier}
                    </div>
                  )}
                  {profile.is_legacy_informal && (
                    <div style={{ fontSize: "0.75rem", color: "#b45309", marginTop: "0.25rem" }}>
                      Legacy informal
                    </div>
                  )}
                  {profile.rescue_name && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      Rescue: {profile.rescue_name}
                    </div>
                  )}
                </div>

                {/* Role Status — Editable */}
                <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Status
                  </div>
                  <select
                    value={profile.is_active ? "active" : "inactive"}
                    onChange={(e) => requestChange("status", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.35rem 0.5rem",
                      fontSize: "0.85rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {Object.entries(STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  {profile.certified_date && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.4rem" }}>
                      Certified: {new Date(profile.certified_date).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Availability — Editable */}
                <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Availability
                  </div>
                  <select
                    value={stats?.availability_status || "available"}
                    onChange={(e) => requestChange("availability", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.35rem 0.5rem",
                      fontSize: "0.85rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {Object.entries(AVAILABILITY_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
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

              {/* Certified Date */}
              <div>
                <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  Certification Date
                </label>
                <input
                  type="date"
                  value={editProfile.certified_date}
                  onChange={(e) => setEditProfile(prev => ({ ...prev, certified_date: e.target.value }))}
                  style={{ padding: "0.4rem", width: "200px" }}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  Date trapper was certified/approved
                </div>
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

      {/* Contract History — FFS-569 */}
      <Section title="Contract History">
        {!showAddContract ? (
          <button
            onClick={() => setShowAddContract(true)}
            style={{ marginBottom: "1rem" }}
          >
            + New Contract
          </button>
        ) : (
          <div style={{
            padding: "1rem",
            background: "#f8f9fa",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Contract Type
                </label>
                <select
                  value={newContractType}
                  onChange={(e) => setNewContractType(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  {Object.entries(CONTRACT_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Signed Date
                </label>
                <input
                  type="date"
                  value={newContractSignedDate}
                  onChange={(e) => setNewContractSignedDate(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Expiration Date (optional)
                </label>
                <input
                  type="date"
                  value={newContractExpDate}
                  onChange={(e) => setNewContractExpDate(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Service Area Description (optional)
                </label>
                <input
                  type="text"
                  value={newContractAreaDesc}
                  onChange={(e) => setNewContractAreaDesc(e.target.value)}
                  placeholder="e.g. Santa Rosa, West Side"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                Notes (optional)
              </label>
              <input
                type="text"
                value={newContractNotes}
                onChange={(e) => setNewContractNotes(e.target.value)}
                placeholder="Any additional notes..."
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={newContractExpirePrev}
                onChange={(e) => setNewContractExpirePrev(e.target.checked)}
              />
              <span style={{ fontSize: "0.875rem" }}>Expire previous active contract of same type</span>
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleAddContract} disabled={addingContract}>
                {addingContract ? "Creating..." : "Create Contract"}
              </button>
              <button
                onClick={() => setShowAddContract(false)}
                style={{ background: "transparent", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {contracts.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {contracts.map((c) => {
              const statusStyle = CONTRACT_STATUS_STYLES[c.status] || CONTRACT_STATUS_STYLES.active;
              return (
                <div
                  key={c.contract_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 1rem",
                    background: "#f8f9fa",
                    borderRadius: "8px",
                    borderLeft: `4px solid ${statusStyle.color}`,
                    opacity: c.status === "terminated" || c.status === "expired" ? 0.7 : 1,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: "0.75rem",
                        padding: "0.125rem 0.5rem",
                        borderRadius: "4px",
                        background: statusStyle.bg,
                        color: statusStyle.color,
                        fontWeight: 500,
                      }}>
                        {CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type}
                      </span>
                      <span style={{
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "3px",
                        background: statusStyle.bg,
                        color: statusStyle.color,
                      }}>
                        {c.status}
                      </span>
                      {c.is_expiring_soon && c.status === "active" && (
                        <span style={{
                          fontSize: "0.7rem",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "3px",
                          background: "#fef3c7",
                          color: "#92400e",
                          fontWeight: 600,
                        }}>
                          Expiring Soon
                        </span>
                      )}
                      {c.is_expired && c.status === "active" && (
                        <span style={{
                          fontSize: "0.7rem",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "3px",
                          background: "#fee2e2",
                          color: "#b91c1c",
                          fontWeight: 600,
                        }}>
                          Expired
                        </span>
                      )}
                      {c.renewed_from_contract_id && (
                        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                          (renewal)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      {c.signed_date && `Signed: ${new Date(c.signed_date).toLocaleDateString()}`}
                      {c.expiration_date && ` · Expires: ${new Date(c.expiration_date).toLocaleDateString()}`}
                      {c.service_area_description && ` · ${c.service_area_description}`}
                    </div>
                    {c.contract_notes && (
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.15rem", fontStyle: "italic" }}>
                        {c.contract_notes}
                      </div>
                    )}
                  </div>
                  {c.status === "active" && (
                    <button
                      onClick={() => handleTerminateContract(c.contract_id)}
                      disabled={terminatingContractId === c.contract_id}
                      title="Terminate contract"
                      style={{
                        background: "transparent",
                        border: "1px solid #fecaca",
                        color: "#b91c1c",
                        cursor: terminatingContractId === c.contract_id ? "not-allowed" : "pointer",
                        fontSize: "0.75rem",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                      }}
                    >
                      {terminatingContractId === c.contract_id ? "..." : "Terminate"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted">No contracts on file.</p>
        )}
      </Section>

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

        {/* Conflict warnings */}
        {areaConflicts.length > 0 && (
          <div style={{
            padding: "0.75rem 1rem",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#92400e", marginBottom: "0.5rem" }}>
              Territory Overlap Detected
            </div>
            <div style={{ fontSize: "0.8rem", color: "#78350f" }}>
              {areaConflicts.map((c, i) => (
                <div key={i} style={{ marginBottom: "0.25rem" }}>
                  <a href={`/trappers/${c.person_id}`} style={{ fontWeight: 500 }}>
                    {c.person_name}
                  </a>
                  {" "}has <strong>{SERVICE_TYPE_LABELS[c.service_type] || c.service_type}</strong> coverage
                  {c.match_type === "family" ? " at a related place" : " at the same place"}
                </div>
              ))}
            </div>
            <button
              onClick={() => setAreaConflicts([])}
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                background: "transparent",
                border: "none",
                color: "#92400e",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Dismiss
            </button>
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

      {/* Assignment History — FFS-544 */}
      <Section title="Assignment History">
        {assignments.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Role</th>
                <th>Status</th>
                <th>Request Status</th>
                <th>Assigned</th>
                <th>Cats</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.assignment_id}>
                  <td>
                    <a href={`/requests/${a.request_id}`} style={{ fontWeight: 500 }}>
                      {a.request_address || "Unknown address"}
                    </a>
                  </td>
                  <td>
                    <span style={{
                      fontSize: "0.75rem",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "4px",
                      background: a.assignment_type === "primary" ? "#dbeafe" : "#f3f4f6",
                      color: a.assignment_type === "primary" ? "#1e40af" : "#6b7280",
                    }}>
                      {a.assignment_type}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      fontSize: "0.75rem",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "4px",
                      background: (STATUS_COLORS[a.assignment_status] || STATUS_COLORS.active).bg,
                      color: (STATUS_COLORS[a.assignment_status] || STATUS_COLORS.active).color,
                    }}>
                      {a.assignment_status}
                    </span>
                  </td>
                  <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                    {a.request_status}
                  </td>
                  <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                    {timeAgo(a.assigned_at)}
                  </td>
                  <td style={{ fontWeight: a.cats_attributed > 0 ? 600 : 400 }}>
                    {a.cats_attributed > 0 ? a.cats_attributed : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No request assignments.</p>
        )}
      </Section>

      {/* Journal — FFS-567 */}
      <Section title="Journal">
        <JournalSection
          entries={journalEntries}
          entityType="person"
          entityId={id}
          onEntryAdded={fetchJournalEntries}
        />
      </Section>

      {/* Change History — FFS-548 */}
      {changeHistory.length > 0 && (
        <Section title="Change History">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {changeHistory
              .filter(e => e.field_name) // Only show field changes
              .slice(0, 10)
              .map((entry) => {
                const label = FIELD_LABELS[entry.field_name || ""] || entry.field_name;
                let oldVal = entry.old_value;
                let newVal = entry.new_value;
                try { oldVal = JSON.parse(oldVal || '""'); } catch { /* keep raw */ }
                try { newVal = JSON.parse(newVal || '""'); } catch { /* keep raw */ }

                return (
                  <div
                    key={entry.edit_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.5rem 0.75rem",
                      background: "#f8f9fa",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                    }}
                  >
                    <span style={{ color: "var(--muted)", fontSize: "0.75rem", minWidth: "60px" }}>
                      {timeAgo(entry.created_at)}
                    </span>
                    <span>
                      <strong>{label}</strong>: {String(oldVal || "—")} → {String(newVal || "—")}
                    </span>
                    {entry.reason && (
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem", fontStyle: "italic" }}>
                        — {entry.reason}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.7rem" }}>
                      {entry.editor}
                    </span>
                  </div>
                );
              })}
          </div>
          {changeHistory.filter(e => e.field_name).length > 10 && (
            <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
              Showing 10 of {changeHistory.filter(e => e.field_name).length} changes
            </p>
          )}
        </Section>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !confirming && setConfirmAction(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "420px",
              width: "90%",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              margin: "0 0 1rem 0",
              color: confirmAction.isDangerous ? "#b91c1c" : "inherit",
            }}>
              {confirmAction.isDangerous ? "Confirm Dangerous Change" : `Change ${confirmAction.label}`}
            </h3>

            <div style={{
              padding: "0.75rem",
              background: confirmAction.isDangerous ? "#fef2f2" : "#f8f9fa",
              borderRadius: "8px",
              marginBottom: "1rem",
              border: confirmAction.isDangerous ? "1px solid #fecaca" : "none",
            }}>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                {confirmAction.label}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{
                  padding: "0.2rem 0.5rem",
                  background: "#e2e8f0",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                }}>
                  {confirmAction.currentLabel}
                </span>
                <span style={{ color: "var(--muted)" }}>&rarr;</span>
                <span style={{
                  padding: "0.2rem 0.5rem",
                  background: confirmAction.isDangerous ? "#fee2e2" : "#dcfce7",
                  color: confirmAction.isDangerous ? "#b91c1c" : "#166534",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}>
                  {confirmAction.newLabel}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 500,
                marginBottom: "0.25rem",
              }}>
                Reason {confirmAction.isDangerous ? "(required)" : "(optional)"}
              </label>
              <textarea
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
                placeholder="Why is this change being made?"
                rows={2}
                style={{ width: "100%", padding: "0.5rem", fontSize: "0.85rem" }}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => { setConfirmAction(null); setConfirmReason(""); }}
                disabled={confirming}
                style={{
                  padding: "0.4rem 1rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Cancel
              </button>
              <button
                onClick={executeChange}
                disabled={confirming || (confirmAction.isDangerous && !confirmReason.trim())}
                style={{
                  padding: "0.4rem 1rem",
                  background: confirmAction.isDangerous ? "#dc2626" : "var(--primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  opacity: confirming || (confirmAction.isDangerous && !confirmReason.trim()) ? 0.5 : 1,
                }}
              >
                {confirming ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
