"use client";

import { useState, useEffect } from "react";

interface ClinicDay {
  clinic_day_id: string;
  clinic_date: string;
  clinic_type: "regular" | "tame_only" | "mass_trapping" | "emergency" | "mobile";
  clinic_type_label?: string;
  target_place_id: string | null;
  target_place_name?: string | null;
  target_place_address?: string | null;
  max_capacity: number | null;
  vet_name: string | null;
  day_of_week?: number;
  total_cats: number;
  total_females: number;
  total_males: number;
  total_unknown_sex: number;
  total_no_shows: number;
  total_cancelled: number;
  notes: string | null;
  finalized_at: string | null;
  clinichq_cats?: number;
  variance?: number;
}

interface ClinicDayEntry {
  entry_id: string;
  trapper_name: string | null;
  place_label: string | null;
  place_address: string | null;
  request_address: string | null;
  source_description: string | null;
  cat_count: number;
  female_count: number;
  male_count: number;
  unknown_sex_count: number;
  status: string;
  notes: string | null;
  entered_by_name: string | null;
  created_at: string;
}

interface Trapper {
  person_id: string;
  display_name: string;
}

interface Place {
  place_id: string;
  display_name: string;
  formatted_address: string;
}

interface ClinicDayCat {
  appointment_id: string;
  cat_id: string | null;
  clinic_day_number: number | null;
  appointment_number: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_breed: string | null;
  cat_color: string | null;
  cat_secondary_color: string | null;
  microchip: string | null;
  needs_microchip: boolean;
  clinichq_animal_id: string | null;
  photo_url: string | null;
  service_type: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  owner_name: string | null;
  trapper_name: string | null;
  place_address: string | null;
}

// Clinic type config
const CLINIC_TYPES = {
  regular: { label: "Regular", color: "var(--primary)", bg: "var(--primary-bg)" },
  tame_only: { label: "Tame Only", color: "var(--warning-text)", bg: "var(--warning-bg)" },
  mass_trapping: { label: "Mass Trapping", color: "var(--success-text)", bg: "var(--success-bg)" },
  emergency: { label: "Emergency", color: "var(--danger-text)", bg: "var(--danger-bg)" },
  mobile: { label: "Mobile", color: "var(--info-text)", bg: "var(--info-bg)" },
};

// Cat Card Component
function CatCard({ cat }: { cat: ClinicDayCat }) {
  const isUnchipped = cat.cat_id && !cat.microchip && cat.needs_microchip;
  const isUnlinked = !cat.cat_id;

  const getColorGradient = (color: string | null) => {
    if (!color) return "#9ca3af 0%, #d1d5db 100%";
    const c = color.toLowerCase();
    if (c.includes("black")) return "#1f2937 0%, #374151 100%";
    if (c.includes("orange") || c.includes("ginger")) return "#f59e0b 0%, #d97706 100%";
    if (c.includes("gray") || c.includes("grey")) return "#6b7280 0%, #9ca3af 100%";
    if (c.includes("white")) return "#e5e7eb 0%, #f9fafb 100%";
    if (c.includes("calico") || c.includes("tortie")) return "#92400e 0%, #f59e0b 50%, #374151 100%";
    if (c.includes("tabby")) return "#78716c 0%, #a8a29e 100%";
    if (c.includes("cream") || c.includes("buff")) return "#fde68a 0%, #fef3c7 100%";
    if (c.includes("brown")) return "#78350f 0%, #92400e 100%";
    if (c.includes("blue")) return "#64748b 0%, #94a3b8 100%";
    return "#9ca3af 0%, #d1d5db 100%";
  };

  return (
    <div
      onClick={() => cat.cat_id && window.open(`/cats/${cat.cat_id}`, "_blank")}
      style={{
        position: "relative",
        padding: "12px",
        background: isUnchipped
          ? "linear-gradient(135deg, var(--warning-bg) 0%, var(--card-bg) 100%)"
          : isUnlinked
          ? "var(--section-bg)"
          : "var(--card-bg)",
        border: isUnchipped
          ? "2px solid var(--warning-text)"
          : isUnlinked
          ? "2px dashed var(--card-border)"
          : "1px solid var(--card-border)",
        borderRadius: "12px",
        cursor: cat.cat_id ? "pointer" : "default",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
      onMouseEnter={(e) => {
        if (cat.cat_id) {
          e.currentTarget.style.transform = "translateY(-4px)";
          e.currentTarget.style.boxShadow = "0 8px 25px rgba(0,0,0,0.15)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
      }}
    >
      {/* Clinic Day Number Badge */}
      {cat.clinic_day_number && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            left: "8px",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            padding: "4px 10px",
            borderRadius: "6px",
            fontSize: "0.8rem",
            fontWeight: 700,
            zIndex: 1,
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          }}
        >
          #{cat.clinic_day_number}
        </div>
      )}

      {/* Photo or Placeholder */}
      <div
        style={{
          width: "100%",
          aspectRatio: "4/3",
          background: cat.photo_url
            ? `url(${cat.photo_url}) center/cover`
            : `linear-gradient(145deg, ${getColorGradient(cat.cat_color)})`,
          borderRadius: "8px",
          marginBottom: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {!cat.photo_url && (
          <span style={{ fontSize: "3rem", opacity: 0.4 }}>
            {isUnlinked ? "?" : "🐱"}
          </span>
        )}
        {/* Service Type Badge */}
        {(cat.is_spay || cat.is_neuter) && (
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              right: "8px",
              padding: "4px 10px",
              background: cat.is_spay ? "var(--danger-text)" : "var(--info-text)",
              color: "#fff",
              borderRadius: "4px",
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            {cat.is_spay ? "Spay" : "Neuter"}
          </div>
        )}
      </div>

      {/* Cat Name */}
      <div style={{
        fontSize: "1rem",
        fontWeight: 700,
        marginBottom: "6px",
        color: "var(--foreground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        {cat.cat_name || (isUnlinked ? "Unlinked Appointment" : "Unknown")}
      </div>

      {/* Sex and Color */}
      <div style={{
        fontSize: "0.85rem",
        color: "var(--muted)",
        marginBottom: "8px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}>
        {cat.cat_sex && (
          <span style={{
            color: cat.cat_sex.toLowerCase() === "female" ? "var(--danger-text)" : "var(--info-text)",
            fontWeight: 500,
          }}>
            {cat.cat_sex}
          </span>
        )}
        {cat.cat_sex && cat.cat_color && <span style={{ color: "var(--card-border)" }}>•</span>}
        {cat.cat_color && <span>{cat.cat_color}</span>}
      </div>

      {/* Status Badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
        {cat.microchip && (
          <span
            style={{
              padding: "3px 8px",
              fontSize: "0.7rem",
              fontWeight: 600,
              background: "var(--success-bg)",
              color: "var(--success-text)",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ fontSize: "0.65rem" }}>✓</span> Chipped
          </span>
        )}
        {isUnchipped && (
          <span
            style={{
              padding: "3px 8px",
              fontSize: "0.7rem",
              fontWeight: 600,
              background: "var(--warning-bg)",
              color: "var(--warning-text)",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ fontSize: "0.8rem" }}>!</span> No Chip
          </span>
        )}
        {isUnlinked && (
          <span
            style={{
              padding: "3px 8px",
              fontSize: "0.7rem",
              fontWeight: 600,
              background: "var(--section-bg)",
              color: "var(--muted)",
              borderRadius: "4px",
            }}
          >
            Unlinked
          </span>
        )}
      </div>

      {/* Address (truncated) */}
      {cat.place_address && (
        <div style={{
          fontSize: "0.75rem",
          color: "var(--muted)",
          marginTop: "4px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          📍 {cat.place_address}
        </div>
      )}

      {/* ClinicHQ ID for unchipped */}
      {isUnchipped && cat.clinichq_animal_id && (
        <div style={{
          fontSize: "0.7rem",
          color: "var(--warning-text)",
          marginTop: "6px",
          fontFamily: "monospace",
        }}>
          CHQ: {cat.clinichq_animal_id}
        </div>
      )}
    </div>
  );
}

export default function ClinicDaysPage() {
  const [clinicDays, setClinicDays] = useState<ClinicDay[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [selectedDay, setSelectedDay] = useState<ClinicDay | null>(null);
  const [entries, setEntries] = useState<ClinicDayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [trappers, setTrappers] = useState<Trapper[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareData, setCompareData] = useState<{
    summary: {
      logged_total: number;
      clinichq_total: number;
      variance: number;
      is_match: boolean;
    };
    clinichq_by_trapper: Array<{
      trapper_name: string;
      total: number;
      females: number;
      males: number;
    }>;
  } | null>(null);

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // Create clinic day modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    clinic_date: "",
    clinic_type: "regular" as ClinicDay["clinic_type"],
    target_place_id: "",
    max_capacity: "",
    vet_name: "",
    notes: "",
  });

  // Edit day settings modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    clinic_type: "regular" as ClinicDay["clinic_type"],
    target_place_id: "",
    max_capacity: "",
    vet_name: "",
    notes: "",
  });

  // Master list import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported?: number;
    matched?: number;
    match_details?: { high_confidence: number; medium_confidence: number; low_confidence: number };
    trappers_resolved?: number;
    trappers_total?: number;
    summary?: { females_altered: number; males_altered: number; walkin: number; already_altered: number };
    error?: string;
    existingCount?: number;
  } | null>(null);

  // New entry form
  const [newEntry, setNewEntry] = useState({
    source_description: "",
    trapper_person_id: "",
    cat_count: "",
    female_count: "",
    male_count: "",
    status: "completed",
    notes: "",
  });

  // Cat gallery state
  const [clinicCats, setClinicCats] = useState<ClinicDayCat[]>([]);
  const [catGalleryStats, setCatGalleryStats] = useState<{
    total_cats: number;
    chipped_count: number;
    unchipped_count: number;
    unlinked_count: number;
  } | null>(null);
  const [loadingCats, setLoadingCats] = useState(false);

  // Tabbed view state
  const [activeTab, setActiveTab] = useState<"overview" | "gallery">("overview");
  const [catFilter, setCatFilter] = useState<"all" | "chipped" | "unchipped" | "unlinked">("all");
  const [groupByTrapper, setGroupByTrapper] = useState(false);

  // Load clinic days list
  useEffect(() => {
    fetch("/api/admin/clinic-days?include_comparison=true&limit=90")
      .then((res) => res.json())
      .then((data) => {
        setClinicDays(data.clinic_days || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Load trappers for dropdown
  useEffect(() => {
    fetch("/api/trappers?limit=200")
      .then((res) => res.json())
      .then((data) => {
        if (data.trappers) {
          setTrappers(data.trappers);
        }
      });
  }, []);

  // Load places for mass trapping target
  useEffect(() => {
    fetch("/api/places?limit=100")
      .then((res) => res.json())
      .then((data) => {
        if (data.places) {
          setPlaces(data.places);
        }
      });
  }, []);

  // Load selected day
  useEffect(() => {
    if (selectedDate) {
      fetch(`/api/admin/clinic-days/${selectedDate}`)
        .then((res) => {
          if (res.ok) return res.json();
          return { clinic_day: null, entries: [] };
        })
        .then((data) => {
          setSelectedDay(data.clinic_day);
          setEntries(data.entries || []);
        });

      // Load cat gallery data
      setLoadingCats(true);
      fetch(`/api/admin/clinic-days/${selectedDate}/cats`)
        .then((res) => {
          if (res.ok) return res.json();
          return { cats: [], total_cats: 0, chipped_count: 0, unchipped_count: 0, unlinked_count: 0 };
        })
        .then((data) => {
          setClinicCats(data.cats || []);
          setCatGalleryStats({
            total_cats: data.total_cats || 0,
            chipped_count: data.chipped_count || 0,
            unchipped_count: data.unchipped_count || 0,
            unlinked_count: data.unlinked_count || 0,
          });
          setLoadingCats(false);
        })
        .catch(() => setLoadingCats(false));
    }
  }, [selectedDate]);

  // Load comparison data
  const loadComparison = async () => {
    const res = await fetch(`/api/admin/clinic-days/${selectedDate}/compare`);
    if (res.ok) {
      const data = await res.json();
      setCompareData(data);
      setShowCompare(true);
    }
  };

  // Create clinic day
  const handleCreateDay = async () => {
    if (!createForm.clinic_date) {
      alert("Please select a date");
      return;
    }

    const res = await fetch("/api/admin/clinic-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinic_date: createForm.clinic_date,
        clinic_type: createForm.clinic_type,
        target_place_id: createForm.target_place_id || null,
        max_capacity: createForm.max_capacity ? parseInt(createForm.max_capacity) : null,
        vet_name: createForm.vet_name || null,
        notes: createForm.notes || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setShowCreateModal(false);
      setSelectedDate(createForm.clinic_date);
      setCreateForm({
        clinic_date: "",
        clinic_type: "regular",
        target_place_id: "",
        max_capacity: "",
        vet_name: "",
        notes: "",
      });
      // Reload list
      const listRes = await fetch("/api/admin/clinic-days?include_comparison=true&limit=90");
      const listData = await listRes.json();
      setClinicDays(listData.clinic_days || []);
    } else {
      const err = await res.json();
      if (err.clinic_day_id) {
        // Already exists - just navigate to it
        setShowCreateModal(false);
        setSelectedDate(createForm.clinic_date);
      } else {
        alert(err.error || "Failed to create clinic day");
      }
    }
  };

  // Update clinic day settings
  const handleUpdateDay = async () => {
    const res = await fetch(`/api/admin/clinic-days/${selectedDate}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinic_type: editForm.clinic_type,
        target_place_id: editForm.target_place_id || null,
        max_capacity: editForm.max_capacity ? parseInt(editForm.max_capacity) : null,
        vet_name: editForm.vet_name || null,
        notes: editForm.notes || null,
      }),
    });

    if (res.ok) {
      setShowEditModal(false);
      // Reload day and list
      const dayRes = await fetch(`/api/admin/clinic-days/${selectedDate}`);
      const dayData = await dayRes.json();
      setSelectedDay(dayData.clinic_day);
      const listRes = await fetch("/api/admin/clinic-days?include_comparison=true&limit=90");
      const listData = await listRes.json();
      setClinicDays(listData.clinic_days || []);
    }
  };

  // Add entry
  const handleAddEntry = async () => {
    if (!newEntry.cat_count) {
      alert("Cat count is required");
      return;
    }

    // If no clinic day exists, create one first
    if (!selectedDay) {
      const createRes = await fetch("/api/admin/clinic-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_date: selectedDate }),
      });
      if (!createRes.ok) {
        const err = await createRes.json();
        if (!err.clinic_day_id) {
          alert("Failed to create clinic day");
          return;
        }
      }
    }

    const res = await fetch(`/api/admin/clinic-days/${selectedDate}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_description: newEntry.source_description || null,
        trapper_person_id: newEntry.trapper_person_id || null,
        cat_count: parseInt(newEntry.cat_count),
        female_count: parseInt(newEntry.female_count) || 0,
        male_count: parseInt(newEntry.male_count) || 0,
        status: newEntry.status,
        notes: newEntry.notes || null,
      }),
    });

    if (res.ok) {
      // Reload entries
      const dayRes = await fetch(`/api/admin/clinic-days/${selectedDate}`);
      const dayData = await dayRes.json();
      setSelectedDay(dayData.clinic_day);
      setEntries(dayData.entries || []);

      // Reset form
      setNewEntry({
        source_description: "",
        trapper_person_id: "",
        cat_count: "",
        female_count: "",
        male_count: "",
        status: "completed",
        notes: "",
      });

      // Reload clinic days list
      const listRes = await fetch("/api/admin/clinic-days?include_comparison=true&limit=90");
      const listData = await listRes.json();
      setClinicDays(listData.clinic_days || []);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to add entry");
    }
  };

  // Delete entry
  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm("Delete this entry?")) return;

    const res = await fetch(`/api/admin/clinic-days/${selectedDate}/entries/${entryId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setEntries(entries.filter((e) => e.entry_id !== entryId));
      // Reload day totals
      const dayRes = await fetch(`/api/admin/clinic-days/${selectedDate}`);
      const dayData = await dayRes.json();
      setSelectedDay(dayData.clinic_day);
    }
  };

  // Open edit modal with current day data
  const openEditModal = () => {
    if (selectedDay) {
      setEditForm({
        clinic_type: selectedDay.clinic_type || "regular",
        target_place_id: selectedDay.target_place_id || "",
        max_capacity: selectedDay.max_capacity?.toString() || "",
        vet_name: selectedDay.vet_name || "",
        notes: selectedDay.notes || "",
      });
      setShowEditModal(true);
    }
  };

  // Import master list
  const handleImport = async () => {
    if (!importFile) {
      alert("Please select a file");
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const res = await fetch(`/api/admin/clinic-days/${selectedDate}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setImportResult({ success: true, ...data });
        // Reload entries and day data
        const dayRes = await fetch(`/api/admin/clinic-days/${selectedDate}`);
        const dayData = await dayRes.json();
        setSelectedDay(dayData.clinic_day);
        setEntries(dayData.entries || []);
        // Reload clinic days list
        const listRes = await fetch("/api/admin/clinic-days?include_comparison=true&limit=90");
        const listData = await listRes.json();
        setClinicDays(listData.clinic_days || []);
      } else {
        setImportResult({ success: false, error: data.error, existingCount: data.existingCount });
      }
    } catch {
      setImportResult({ success: false, error: "Failed to import file" });
    } finally {
      setImporting(false);
    }
  };

  // Clear master list entries
  const handleClearImport = async () => {
    if (!confirm("Delete all master list entries for this date? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/admin/clinic-days/${selectedDate}/import`, {
        method: "DELETE",
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Deleted ${data.deleted} entries`);
        // Reload
        const dayRes = await fetch(`/api/admin/clinic-days/${selectedDate}`);
        const dayData = await dayRes.json();
        setSelectedDay(dayData.clinic_day);
        setEntries(dayData.entries || []);
        setImportResult(null);
        setImportFile(null);
      }
    } catch {
      alert("Failed to delete entries");
    }
  };

  // Calendar helpers
  const getCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days: Array<{ date: string; day: number } | null> = [];

    // Add empty slots for days before the 1st
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    // Add actual days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date, day: d });
    }

    return days;
  };

  const getClinicDayForDate = (date: string) => {
    return clinicDays.find((cd) => cd.clinic_date === date);
  };

  if (loading) {
    return <div className="page-header"><h1>Loading...</h1></div>;
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Clinic Day Logging</h1>
          <p style={{ color: "var(--muted)", marginTop: "4px" }}>
            Ground truth capture for clinic days (replaces master list spreadsheet)
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
        >
          + New Clinic Day
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "24px" }}>
        {/* Left: Date picker and recent days */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ margin: 0 }}>Select Date</h3>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                onClick={() => setViewMode("list")}
                style={{
                  padding: "4px 8px",
                  background: viewMode === "list" ? "var(--primary)" : "var(--section-bg)",
                  color: viewMode === "list" ? "var(--primary-foreground)" : "var(--foreground)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                List
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                style={{
                  padding: "4px 8px",
                  background: viewMode === "calendar" ? "var(--primary)" : "var(--section-bg)",
                  color: viewMode === "calendar" ? "var(--primary-foreground)" : "var(--foreground)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                Calendar
              </button>
            </div>
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              marginBottom: "16px",
              border: "1px solid var(--card-border)",
              borderRadius: "6px",
              background: "var(--section-bg)",
              color: "var(--foreground)",
            }}
          />

          {viewMode === "calendar" ? (
            <>
              {/* Calendar header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <button
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--foreground)", padding: "4px 8px" }}
                >
                  &lt;
                </button>
                <span style={{ fontWeight: 600 }}>
                  {calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <button
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--foreground)", padding: "4px 8px" }}
                >
                  &gt;
                </button>
              </div>

              {/* Calendar grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", textAlign: "center" }}>
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <div key={i} style={{ padding: "4px", fontSize: "0.7rem", color: "var(--muted)", fontWeight: 600 }}>
                    {d}
                  </div>
                ))}
                {getCalendarDays().map((item, i) => {
                  if (!item) return <div key={i} />;
                  const clinicDay = getClinicDayForDate(item.date);
                  const isSelected = item.date === selectedDate;
                  const typeConfig = clinicDay ? CLINIC_TYPES[clinicDay.clinic_type] : null;

                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(item.date)}
                      style={{
                        padding: "4px",
                        minHeight: "44px",
                        background: isSelected
                          ? "var(--primary)"
                          : clinicDay
                          ? typeConfig?.bg || "var(--section-bg)"
                          : "transparent",
                        color: isSelected
                          ? "var(--primary-foreground)"
                          : clinicDay
                          ? typeConfig?.color || "var(--foreground)"
                          : "var(--foreground)",
                        border: isSelected ? "2px solid var(--primary)" : "1px solid var(--card-border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.85rem",
                      }}
                    >
                      <span>{item.day}</span>
                      {clinicDay && (
                        <span style={{ fontSize: "0.65rem", fontWeight: 600 }}>
                          {clinicDay.total_cats}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.7rem" }}>
                {Object.entries(CLINIC_TYPES).map(([type, config]) => (
                  <div key={type} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <div style={{ width: "12px", height: "12px", background: config.bg, border: `1px solid ${config.color}`, borderRadius: "2px" }} />
                    <span style={{ color: "var(--muted)" }}>{config.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h4 style={{ marginTop: "16px", marginBottom: "8px" }}>Recent Clinic Days</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "400px", overflowY: "auto" }}>
                {clinicDays.slice(0, 20).map((day) => {
                  const typeConfig = CLINIC_TYPES[day.clinic_type];
                  return (
                    <button
                      key={day.clinic_day_id}
                      onClick={() => setSelectedDate(day.clinic_date)}
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        background: day.clinic_date === selectedDate ? "var(--primary)" : "var(--section-bg)",
                        color: day.clinic_date === selectedDate ? "var(--primary-foreground)" : "var(--foreground)",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <span>{new Date(day.clinic_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                        {day.clinic_type !== "regular" && (
                          <span
                            style={{
                              marginLeft: "8px",
                              padding: "2px 6px",
                              fontSize: "0.65rem",
                              fontWeight: 600,
                              background: day.clinic_date === selectedDate ? "rgba(255,255,255,0.2)" : typeConfig.bg,
                              color: day.clinic_date === selectedDate ? "var(--primary-foreground)" : typeConfig.color,
                              borderRadius: "3px",
                            }}
                          >
                            {typeConfig.label}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: "0.85rem" }}>
                        {day.total_cats} cats
                        {day.variance !== undefined && day.variance !== 0 && (
                          <span style={{ color: day.clinic_date === selectedDate ? "var(--primary-foreground)" : day.variance > 0 ? "var(--warning-text)" : "var(--danger-text)", marginLeft: "8px" }}>
                            ({day.variance > 0 ? "+" : ""}{day.variance})
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right: Selected day details */}
        <div>
          {/* Summary card */}
          <div className="card" style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "12px" }}>
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  {selectedDay && selectedDay.clinic_type && (
                    <span
                      style={{
                        padding: "4px 10px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: CLINIC_TYPES[selectedDay.clinic_type].bg,
                        color: CLINIC_TYPES[selectedDay.clinic_type].color,
                        borderRadius: "4px",
                      }}
                    >
                      {CLINIC_TYPES[selectedDay.clinic_type].label}
                    </span>
                  )}
                </h2>
                {selectedDay && (
                  <div style={{ marginTop: "8px", fontSize: "0.85rem", color: "var(--muted)" }}>
                    {selectedDay.target_place_name && (
                      <span style={{ marginRight: "16px" }}>Target: {selectedDay.target_place_name}</span>
                    )}
                    {selectedDay.vet_name && (
                      <span style={{ marginRight: "16px" }}>Vet: {selectedDay.vet_name}</span>
                    )}
                    {selectedDay.max_capacity && (
                      <span>Capacity: {selectedDay.max_capacity}</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {selectedDay && (
                  <button
                    onClick={openEditModal}
                    className="btn"
                    style={{ background: "var(--section-bg)" }}
                  >
                    Edit Day Settings
                  </button>
                )}
                <button
                  onClick={() => { setShowImportModal(true); setImportResult(null); setImportFile(null); }}
                  className="btn"
                  style={{ background: "var(--success-bg)", color: "var(--success-text)" }}
                >
                  Import Master List
                </button>
                <button
                  onClick={loadComparison}
                  className="btn"
                  style={{ background: "var(--info-bg)", color: "var(--info-text)" }}
                >
                  Compare with ClinicHQ
                </button>
              </div>
            </div>

            {selectedDay ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                <div style={{ textAlign: "center", padding: "12px", background: "var(--section-bg)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "2rem", fontWeight: 600 }}>{selectedDay.total_cats}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Total Cats</div>
                </div>
                <div style={{ textAlign: "center", padding: "12px", background: "var(--section-bg)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 500 }}>
                    <span style={{ color: "var(--danger-text)" }}>{selectedDay.total_females}F</span>
                    {" / "}
                    <span style={{ color: "var(--info-text)" }}>{selectedDay.total_males}M</span>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Sex Breakdown</div>
                </div>
                <div style={{ textAlign: "center", padding: "12px", background: "var(--section-bg)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 500, color: "var(--warning-text)" }}>{selectedDay.total_no_shows}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No Shows</div>
                </div>
                <div style={{ textAlign: "center", padding: "12px", background: "var(--section-bg)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 500, color: "var(--muted)" }}>{selectedDay.total_cancelled}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Cancelled</div>
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--muted)" }}>No data logged for this date yet. Add entries below.</p>
            )}
          </div>

          {/* Comparison panel */}
          {showCompare && compareData && (
            <div className="card" style={{ marginBottom: "16px", background: "var(--info-bg)", border: "1px solid var(--info-text)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ margin: 0, color: "var(--info-text)" }}>ClinicHQ Comparison</h3>
                <button onClick={() => setShowCompare(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--info-text)" }}>Close</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Logged: {compareData.summary.logged_total}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>ClinicHQ: {compareData.summary.clinichq_total}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: compareData.summary.is_match ? "var(--success-text)" : "var(--warning-text)" }}>
                    {compareData.summary.is_match ? "Match!" : `Variance: ${compareData.summary.variance}`}
                  </div>
                </div>
              </div>
              <h4>By Trapper (ClinicHQ):</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {compareData.clinichq_by_trapper.map((t, i) => (
                  <div key={i} style={{ padding: "6px 12px", background: "var(--card-bg)", borderRadius: "4px", fontSize: "0.85rem" }}>
                    <strong>{t.trapper_name}</strong>: {t.total} ({t.females}F/{t.males}M)
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div style={{
            display: "flex",
            gap: "0",
            marginBottom: "16px",
            borderBottom: "2px solid var(--card-border)",
          }}>
            <button
              onClick={() => setActiveTab("overview")}
              style={{
                padding: "12px 24px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "overview" ? "2px solid var(--primary)" : "2px solid transparent",
                marginBottom: "-2px",
                color: activeTab === "overview" ? "var(--primary)" : "var(--muted)",
                fontWeight: activeTab === "overview" ? 600 : 400,
                cursor: "pointer",
                fontSize: "0.95rem",
              }}
            >
              Overview & Entries
            </button>
            <button
              onClick={() => setActiveTab("gallery")}
              style={{
                padding: "12px 24px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "gallery" ? "2px solid var(--primary)" : "2px solid transparent",
                marginBottom: "-2px",
                color: activeTab === "gallery" ? "var(--primary)" : "var(--muted)",
                fontWeight: activeTab === "gallery" ? 600 : 400,
                cursor: "pointer",
                fontSize: "0.95rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              Cat Gallery
              {catGalleryStats && catGalleryStats.total_cats > 0 && (
                <span style={{
                  padding: "2px 8px",
                  background: activeTab === "gallery" ? "var(--primary)" : "var(--section-bg)",
                  color: activeTab === "gallery" ? "var(--primary-foreground)" : "var(--muted)",
                  borderRadius: "12px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}>
                  {catGalleryStats.total_cats}
                </span>
              )}
            </button>
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="card">
              <h3>Entries</h3>
              <table className="table" style={{ width: "100%", marginBottom: "16px" }}>
                <thead>
                  <tr>
                    <th>Source / Trapper</th>
                    <th style={{ textAlign: "center" }}>Cats</th>
                    <th style={{ textAlign: "center" }}>F/M</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.entry_id}>
                      <td>
                        {entry.trapper_name && <strong>{entry.trapper_name}</strong>}
                        {entry.source_description && (
                          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{entry.source_description}</div>
                        )}
                        {entry.place_address && (
                          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{entry.place_address}</div>
                        )}
                      </td>
                      <td style={{ textAlign: "center", fontWeight: 600 }}>{entry.cat_count}</td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{ color: "var(--danger-text)" }}>{entry.female_count}</span>
                        {" / "}
                        <span style={{ color: "var(--info-text)" }}>{entry.male_count}</span>
                      </td>
                      <td>
                        <span
                          className={`badge badge-${
                            entry.status === "completed" ? "success" :
                            entry.status === "no_show" ? "warning" :
                            entry.status === "cancelled" ? "danger" : "default"
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{entry.notes}</td>
                      <td>
                        <button
                          onClick={() => handleDeleteEntry(entry.entry_id)}
                          style={{ background: "none", border: "none", color: "var(--danger-text)", cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: "24px" }}>
                        No entries yet. Add one below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Add entry form */}
              <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: "16px" }}>
                <h4 style={{ marginBottom: "12px" }}>Quick Add Entry</h4>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 80px 80px 100px auto", gap: "8px", alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Source Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Jean Worthey - Trp Crystal"
                      value={newEntry.source_description}
                      onChange={(e) => setNewEntry({ ...newEntry, source_description: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "var(--section-bg)",
                        color: "var(--foreground)",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Trapper</label>
                    <select
                      value={newEntry.trapper_person_id}
                      onChange={(e) => setNewEntry({ ...newEntry, trapper_person_id: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "var(--section-bg)",
                        color: "var(--foreground)",
                      }}
                    >
                      <option value="">(optional)</option>
                      {trappers.map((t) => (
                        <option key={t.person_id} value={t.person_id}>{t.display_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Status</label>
                    <select
                      value={newEntry.status}
                      onChange={(e) => setNewEntry({ ...newEntry, status: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "var(--section-bg)",
                        color: "var(--foreground)",
                      }}
                    >
                      <option value="completed">Completed</option>
                      <option value="no_show">No Show</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="partial">Partial</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}># Cats</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={newEntry.cat_count}
                      onChange={(e) => setNewEntry({ ...newEntry, cat_count: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "var(--section-bg)",
                        color: "var(--foreground)",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>F / M</label>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <input
                        type="number"
                        min="0"
                        placeholder="F"
                        value={newEntry.female_count}
                        onChange={(e) => setNewEntry({ ...newEntry, female_count: e.target.value })}
                        style={{
                          width: "40px",
                          padding: "8px 4px",
                          textAlign: "center",
                          border: "1px solid var(--card-border)",
                          borderRadius: "4px",
                          background: "var(--section-bg)",
                          color: "var(--danger-text)",
                        }}
                      />
                      <input
                        type="number"
                        min="0"
                        placeholder="M"
                        value={newEntry.male_count}
                        onChange={(e) => setNewEntry({ ...newEntry, male_count: e.target.value })}
                        style={{
                          width: "40px",
                          padding: "8px 4px",
                          textAlign: "center",
                          border: "1px solid var(--card-border)",
                          borderRadius: "4px",
                          background: "var(--section-bg)",
                          color: "var(--info-text)",
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Notes</label>
                    <input
                      type="text"
                      placeholder="Notes..."
                      value={newEntry.notes}
                      onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "var(--section-bg)",
                        color: "var(--foreground)",
                      }}
                    />
                  </div>
                  <button
                    onClick={handleAddEntry}
                    className="btn btn-primary"
                    style={{ alignSelf: "end" }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Cat Gallery Tab */}
          {activeTab === "gallery" && (
            <div className="card">
              {/* Stats Bar */}
              {catGalleryStats && (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "12px",
                  marginBottom: "20px",
                  padding: "16px",
                  background: "var(--section-bg)",
                  borderRadius: "8px",
                }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--foreground)" }}>
                      {catGalleryStats.total_cats}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>Total Cats</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--success-text)" }}>
                      {catGalleryStats.chipped_count}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>Microchipped</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--warning-text)" }}>
                      {catGalleryStats.unchipped_count}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>No Microchip</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--muted)" }}>
                      {catGalleryStats.unlinked_count}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>Unlinked</div>
                  </div>
                </div>
              )}

              {/* Filter Bar */}
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                flexWrap: "wrap",
                gap: "12px",
              }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["all", "chipped", "unchipped", "unlinked"] as const).map((filter) => {
                    const count = filter === "all"
                      ? catGalleryStats?.total_cats || 0
                      : filter === "chipped"
                      ? catGalleryStats?.chipped_count || 0
                      : filter === "unchipped"
                      ? catGalleryStats?.unchipped_count || 0
                      : catGalleryStats?.unlinked_count || 0;

                    return (
                      <button
                        key={filter}
                        onClick={() => setCatFilter(filter)}
                        style={{
                          padding: "8px 16px",
                          background: catFilter === filter ? "var(--primary)" : "var(--section-bg)",
                          color: catFilter === filter ? "var(--primary-foreground)" : "var(--foreground)",
                          border: catFilter === filter ? "none" : "1px solid var(--card-border)",
                          borderRadius: "20px",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                          fontWeight: catFilter === filter ? 600 : 400,
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        {filter === "all" ? "All" :
                         filter === "chipped" ? "Chipped" :
                         filter === "unchipped" ? "No Chip" : "Unlinked"}
                        <span style={{
                          padding: "2px 6px",
                          background: catFilter === filter ? "rgba(255,255,255,0.2)" : "var(--card-bg)",
                          borderRadius: "10px",
                          fontSize: "0.75rem",
                        }}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={groupByTrapper}
                    onChange={(e) => setGroupByTrapper(e.target.checked)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <span style={{ fontSize: "0.85rem", color: "var(--foreground)" }}>Group by Trapper</span>
                </label>
              </div>

              {loadingCats ? (
                <div style={{ textAlign: "center", padding: "48px", color: "var(--muted)" }}>
                  <div style={{ fontSize: "1.5rem", marginBottom: "8px" }}>Loading cats...</div>
                </div>
              ) : (
                <>
                  {(() => {
                    // Filter cats
                    const filteredCats = clinicCats.filter((cat) => {
                      if (catFilter === "all") return true;
                      if (catFilter === "chipped") return cat.microchip !== null;
                      if (catFilter === "unchipped") return cat.cat_id && !cat.microchip && cat.needs_microchip;
                      if (catFilter === "unlinked") return !cat.cat_id;
                      return true;
                    });

                    // Group by trapper if enabled
                    if (groupByTrapper) {
                      const grouped = filteredCats.reduce((acc, cat) => {
                        const key = cat.trapper_name || "Unknown Trapper";
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(cat);
                        return acc;
                      }, {} as Record<string, ClinicDayCat[]>);

                      const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
                        if (a === "Unknown Trapper") return 1;
                        if (b === "Unknown Trapper") return -1;
                        return a.localeCompare(b);
                      });

                      return (
                        <div>
                          {sortedGroups.map(([trapperName, cats]) => (
                            <div key={trapperName} style={{ marginBottom: "24px" }}>
                              <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                marginBottom: "12px",
                                paddingBottom: "8px",
                                borderBottom: "1px solid var(--card-border)",
                              }}>
                                <h4 style={{ margin: 0, fontWeight: 600 }}>{trapperName}</h4>
                                <span style={{
                                  padding: "2px 10px",
                                  background: "var(--section-bg)",
                                  borderRadius: "12px",
                                  fontSize: "0.8rem",
                                  color: "var(--muted)",
                                }}>
                                  {cats.length} cat{cats.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                              <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                                gap: "16px",
                              }}>
                                {cats.map((cat) => (
                                  <CatCard key={cat.appointment_id} cat={cat} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                        gap: "16px",
                      }}>
                        {filteredCats.map((cat) => (
                          <CatCard key={cat.appointment_id} cat={cat} />
                        ))}
                      </div>
                    );
                  })()}

                  {clinicCats.length === 0 && (
                    <div style={{ textAlign: "center", padding: "48px", color: "var(--muted)" }}>
                      <div style={{ fontSize: "3rem", marginBottom: "12px", opacity: 0.5 }}>🐱</div>
                      <div>No appointments found for this date in ClinicHQ data.</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Clinic Day Modal */}
      {showCreateModal && (
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
          onClick={(e) => e.target === e.currentTarget && setShowCreateModal(false)}
        >
          <div className="card" style={{ width: "480px", maxWidth: "90%" }}>
            <h2 style={{ marginTop: 0 }}>Create Clinic Day</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Date *</label>
                <input
                  type="date"
                  value={createForm.clinic_date}
                  onChange={(e) => setCreateForm({ ...createForm, clinic_date: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Clinic Type</label>
                <select
                  value={createForm.clinic_type}
                  onChange={(e) => setCreateForm({ ...createForm, clinic_type: e.target.value as ClinicDay["clinic_type"] })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                >
                  {Object.entries(CLINIC_TYPES).map(([type, config]) => (
                    <option key={type} value={type}>{config.label}</option>
                  ))}
                </select>
              </div>

              {createForm.clinic_type === "mass_trapping" && (
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Target Site</label>
                  <select
                    value={createForm.target_place_id}
                    onChange={(e) => setCreateForm({ ...createForm, target_place_id: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "4px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  >
                    <option value="">Select site...</option>
                    {places.map((p) => (
                      <option key={p.place_id} value={p.place_id}>{p.display_name || p.formatted_address}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Max Capacity</label>
                  <input
                    type="number"
                    placeholder="Optional"
                    value={createForm.max_capacity}
                    onChange={(e) => setCreateForm({ ...createForm, max_capacity: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "4px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Vet on Duty</label>
                  <input
                    type="text"
                    placeholder="Optional"
                    value={createForm.vet_name}
                    onChange={(e) => setCreateForm({ ...createForm, vet_name: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "4px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Notes</label>
                <textarea
                  placeholder="Optional notes..."
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
                <button onClick={() => setShowCreateModal(false)} className="btn">
                  Cancel
                </button>
                <button onClick={handleCreateDay} className="btn btn-primary">
                  Create Clinic Day
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Clinic Day Modal */}
      {showEditModal && selectedDay && (
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
          onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}
        >
          <div className="card" style={{ width: "480px", maxWidth: "90%" }}>
            <h2 style={{ marginTop: 0 }}>Edit Clinic Day Settings</h2>
            <p style={{ color: "var(--muted)", marginBottom: "16px" }}>
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Clinic Type</label>
                <select
                  value={editForm.clinic_type}
                  onChange={(e) => setEditForm({ ...editForm, clinic_type: e.target.value as ClinicDay["clinic_type"] })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                >
                  {Object.entries(CLINIC_TYPES).map(([type, config]) => (
                    <option key={type} value={type}>{config.label}</option>
                  ))}
                </select>
              </div>

              {editForm.clinic_type === "mass_trapping" && (
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Target Site</label>
                  <select
                    value={editForm.target_place_id}
                    onChange={(e) => setEditForm({ ...editForm, target_place_id: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "4px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  >
                    <option value="">Select site...</option>
                    {places.map((p) => (
                      <option key={p.place_id} value={p.place_id}>{p.display_name || p.formatted_address}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Max Capacity</label>
                  <input
                    type="number"
                    placeholder="Optional"
                    value={editForm.max_capacity}
                    onChange={(e) => setEditForm({ ...editForm, max_capacity: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "4px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Vet on Duty</label>
                  <input
                    type="text"
                    placeholder="Optional"
                    value={editForm.vet_name}
                    onChange={(e) => setEditForm({ ...editForm, vet_name: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      marginTop: "4px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Notes</label>
                <textarea
                  placeholder="Optional notes..."
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
                <button onClick={() => setShowEditModal(false)} className="btn">
                  Cancel
                </button>
                <button onClick={handleUpdateDay} className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Master List Modal */}
      {showImportModal && (
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
          onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}
        >
          <div className="card" style={{ width: "560px", maxWidth: "90%" }}>
            <h2 style={{ marginTop: 0 }}>Import Master List</h2>
            <p style={{ color: "var(--muted)", marginBottom: "16px" }}>
              Import SharePoint master list Excel file for{" "}
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Excel File (.xlsx)</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                />
                {importFile && (
                  <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "4px" }}>
                    Selected: {importFile.name}
                  </p>
                )}
              </div>

              {/* Import Result */}
              {importResult && (
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "8px",
                    background: importResult.success ? "var(--success-bg)" : "var(--danger-bg)",
                    border: `1px solid ${importResult.success ? "var(--success-text)" : "var(--danger-text)"}`,
                  }}
                >
                  {importResult.success ? (
                    <>
                      <h4 style={{ margin: "0 0 8px 0", color: "var(--success-text)" }}>Import Successful</h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "0.85rem" }}>
                        <div><strong>Imported:</strong> {importResult.imported} entries</div>
                        <div><strong>Matched:</strong> {importResult.matched} to ClinicHQ</div>
                        <div><strong>Trappers:</strong> {importResult.trappers_resolved}/{importResult.trappers_total} resolved</div>
                        <div><strong>Unmatched:</strong> {(importResult.imported || 0) - (importResult.matched || 0)}</div>
                      </div>
                      {importResult.match_details && (
                        <div style={{ marginTop: "8px", fontSize: "0.8rem", color: "var(--muted)" }}>
                          Match confidence: {importResult.match_details.high_confidence} high, {importResult.match_details.medium_confidence} medium, {importResult.match_details.low_confidence} low
                        </div>
                      )}
                      {importResult.summary && (
                        <div style={{ marginTop: "8px", fontSize: "0.8rem" }}>
                          <strong>Summary:</strong> {importResult.summary.females_altered} spays, {importResult.summary.males_altered} neuters, {importResult.summary.walkin} wellness, {importResult.summary.already_altered} already altered
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <h4 style={{ margin: "0 0 8px 0", color: "var(--danger-text)" }}>Import Failed</h4>
                      <p style={{ margin: 0 }}>{importResult.error}</p>
                      {importResult.existingCount && importResult.existingCount > 0 && (
                        <button
                          onClick={handleClearImport}
                          style={{
                            marginTop: "8px",
                            padding: "6px 12px",
                            background: "var(--danger-text)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                          }}
                        >
                          Clear existing entries and retry
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
                <button onClick={() => setShowImportModal(false)} className="btn">
                  {importResult?.success ? "Done" : "Cancel"}
                </button>
                {!importResult?.success && (
                  <button
                    onClick={handleImport}
                    className="btn btn-primary"
                    disabled={!importFile || importing}
                  >
                    {importing ? "Importing..." : "Import"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
