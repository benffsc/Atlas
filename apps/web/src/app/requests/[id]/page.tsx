"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";

interface MediaItem {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  notes: string | null;
  cat_description: string | null;
  linked_cat_id: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface RequestDetail {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  assigned_to: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  requester_person_id: string | null;
  requester_name: string | null;
  cats: { cat_id: string; cat_name: string; relationship: string }[] | null;
  // Kitten assessment fields
  kitten_count: number | null;
  kitten_age_weeks: number | null;
  kitten_assessment_status: string | null;
  kitten_assessment_outcome: string | null;
  kitten_foster_readiness: string | null;
  kitten_urgency_factors: string[] | null;
  kitten_assessment_notes: string | null;
  kitten_assessed_by: string | null;
  kitten_assessed_at: string | null;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "triaged", label: "Triaged" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "on_hold", label: "On Hold" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const KITTEN_ASSESSMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending Assessment" },
  { value: "assessed", label: "Assessed" },
  { value: "follow_up", label: "Needs Follow-up" },
];

const KITTEN_OUTCOME_OPTIONS = [
  { value: "foster_intake", label: "Foster Intake" },
  { value: "tnr_candidate", label: "TNR Candidate (feral/older)" },
  { value: "pending_space", label: "Pending Foster Space" },
  { value: "return_to_colony", label: "Return to Colony" },
  { value: "declined", label: "Declined / Not Suitable" },
];

const FOSTER_READINESS_OPTIONS = [
  { value: "high", label: "High - Ready for foster" },
  { value: "medium", label: "Medium - Some concerns" },
  { value: "low", label: "Low - Not ready / needs intervention" },
];

const URGENCY_FACTOR_OPTIONS = [
  { value: "very_young", label: "Very young (bottle babies)" },
  { value: "medical_concern", label: "Medical concern" },
  { value: "exposed_danger", label: "Exposed to danger" },
  { value: "cold_weather", label: "Cold weather risk" },
  { value: "hot_weather", label: "Hot weather risk" },
  { value: "mom_missing", label: "Mom missing/dead" },
  { value: "construction", label: "Construction/demolition" },
  { value: "eviction", label: "Eviction/displacement" },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    new: { bg: "#0d6efd", color: "#fff" },
    triaged: { bg: "#6610f2", color: "#fff" },
    scheduled: { bg: "#198754", color: "#fff" },
    in_progress: { bg: "#fd7e14", color: "#000" },
    completed: { bg: "#20c997", color: "#000" },
    cancelled: { bg: "#6c757d", color: "#fff" },
    on_hold: { bg: "#ffc107", color: "#000" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.9rem", padding: "0.5rem 1rem" }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#dc3545", color: "#fff" },
    high: { bg: "#fd7e14", color: "#000" },
    normal: { bg: "#6c757d", color: "#fff" },
    low: { bg: "#adb5bd", color: "#000" },
  };
  const style = colors[priority] || { bg: "#6c757d", color: "#fff" };

  return (
    <span className="badge" style={{ background: style.bg, color: style.color }}>
      {priority}
    </span>
  );
}

function LegacyBadge() {
  return (
    <span
      className="badge"
      style={{
        background: "#e9ecef",
        color: "#495057",
        fontSize: "0.75rem",
        padding: "0.25rem 0.5rem",
        border: "1px solid #ced4da",
      }}
      title="This request was imported from Airtable"
    >
      Legacy (Airtable)
    </span>
  );
}

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    status: "",
    priority: "",
    summary: "",
    notes: "",
    estimated_cat_count: "" as number | "",
    has_kittens: false,
    cats_are_friendly: null as boolean | null,
    assigned_to: "",
    scheduled_date: "",
    scheduled_time_range: "",
    resolution_notes: "",
    cats_trapped: "" as number | "",
    cats_returned: "" as number | "",
  });

  // Media state
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadMediaType, setUploadMediaType] = useState("site_photo");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadCatDescription, setUploadCatDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Kitten assessment state
  const [editingKittens, setEditingKittens] = useState(false);
  const [savingKittens, setSavingKittens] = useState(false);
  const [kittenForm, setKittenForm] = useState({
    kitten_count: "" as number | "",
    kitten_age_weeks: "" as number | "",
    kitten_assessment_status: "",
    kitten_assessment_outcome: "",
    kitten_foster_readiness: "",
    kitten_urgency_factors: [] as string[],
    kitten_assessment_notes: "",
  });

  const fetchMedia = async () => {
    setLoadingMedia(true);
    try {
      const response = await fetch(`/api/requests/${requestId}/media`);
      if (response.ok) {
        const data = await response.json();
        setMedia(data.media || []);
      }
    } catch (err) {
      console.error("Failed to fetch media:", err);
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleMediaUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploadingMedia(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("media_type", uploadMediaType);
    formData.append("caption", uploadCaption);
    if (uploadMediaType === "cat_photo" && uploadCatDescription) {
      formData.append("cat_description", uploadCatDescription);
    }
    formData.append("uploaded_by", "app_user");

    try {
      const response = await fetch(`/api/requests/${requestId}/media`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        await fetchMedia();
        setShowUploadForm(false);
        setUploadCaption("");
        setUploadCatDescription("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        const data = await response.json();
        alert(data.error || "Upload failed");
      }
    } catch (err) {
      alert("Upload failed");
    } finally {
      setUploadingMedia(false);
    }
  };

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const response = await fetch(`/api/requests/${requestId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError("Request not found");
          } else {
            setError("Failed to load request");
          }
          return;
        }
        const data = await response.json();
        setRequest(data);
        // Initialize edit form
        setEditForm({
          status: data.status,
          priority: data.priority,
          summary: data.summary || "",
          notes: data.notes || "",
          estimated_cat_count: data.estimated_cat_count ?? "",
          has_kittens: data.has_kittens,
          cats_are_friendly: data.cats_are_friendly,
          assigned_to: data.assigned_to || "",
          scheduled_date: data.scheduled_date || "",
          scheduled_time_range: data.scheduled_time_range || "",
          resolution_notes: data.resolution_notes || "",
          cats_trapped: data.cats_trapped ?? "",
          cats_returned: data.cats_returned ?? "",
        });
        // Initialize kitten form
        setKittenForm({
          kitten_count: data.kitten_count ?? "",
          kitten_age_weeks: data.kitten_age_weeks ?? "",
          kitten_assessment_status: data.kitten_assessment_status || "",
          kitten_assessment_outcome: data.kitten_assessment_outcome || "",
          kitten_foster_readiness: data.kitten_foster_readiness || "",
          kitten_urgency_factors: data.kitten_urgency_factors || [],
          kitten_assessment_notes: data.kitten_assessment_notes || "",
        });
      } catch (err) {
        setError("Failed to load request");
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
    fetchMedia();
  }, [requestId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editForm.status,
          priority: editForm.priority,
          summary: editForm.summary || null,
          notes: editForm.notes || null,
          estimated_cat_count: editForm.estimated_cat_count || null,
          has_kittens: editForm.has_kittens,
          cats_are_friendly: editForm.cats_are_friendly,
          assigned_to: editForm.assigned_to || null,
          scheduled_date: editForm.scheduled_date || null,
          scheduled_time_range: editForm.scheduled_time_range || null,
          resolution_notes: editForm.resolution_notes || null,
          cats_trapped: editForm.cats_trapped || null,
          cats_returned: editForm.cats_returned || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save changes");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }

      setEditing(false);
    } catch (err) {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (request) {
      setEditForm({
        status: request.status,
        priority: request.priority,
        summary: request.summary || "",
        notes: request.notes || "",
        estimated_cat_count: request.estimated_cat_count ?? "",
        has_kittens: request.has_kittens,
        cats_are_friendly: request.cats_are_friendly,
        assigned_to: request.assigned_to || "",
        scheduled_date: request.scheduled_date || "",
        scheduled_time_range: request.scheduled_time_range || "",
        resolution_notes: request.resolution_notes || "",
        cats_trapped: request.cats_trapped ?? "",
        cats_returned: request.cats_returned ?? "",
      });
    }
    setEditing(false);
  };

  const handleSaveKittens = async () => {
    setSavingKittens(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kitten_count: kittenForm.kitten_count || null,
          kitten_age_weeks: kittenForm.kitten_age_weeks || null,
          kitten_assessment_status: kittenForm.kitten_assessment_status || null,
          kitten_assessment_outcome: kittenForm.kitten_assessment_outcome || null,
          kitten_foster_readiness: kittenForm.kitten_foster_readiness || null,
          kitten_urgency_factors: kittenForm.kitten_urgency_factors.length > 0 ? kittenForm.kitten_urgency_factors : null,
          kitten_assessment_notes: kittenForm.kitten_assessment_notes || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save kitten assessment");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }

      setEditingKittens(false);
    } catch (err) {
      setError("Failed to save kitten assessment");
    } finally {
      setSavingKittens(false);
    }
  };

  const handleCancelKittens = () => {
    if (request) {
      setKittenForm({
        kitten_count: request.kitten_count ?? "",
        kitten_age_weeks: request.kitten_age_weeks ?? "",
        kitten_assessment_status: request.kitten_assessment_status || "",
        kitten_assessment_outcome: request.kitten_assessment_outcome || "",
        kitten_foster_readiness: request.kitten_foster_readiness || "",
        kitten_urgency_factors: request.kitten_urgency_factors || [],
        kitten_assessment_notes: request.kitten_assessment_notes || "",
      });
    }
    setEditingKittens(false);
  };

  const toggleUrgencyFactor = (factor: string) => {
    setKittenForm(prev => ({
      ...prev,
      kitten_urgency_factors: prev.kitten_urgency_factors.includes(factor)
        ? prev.kitten_urgency_factors.filter(f => f !== factor)
        : [...prev.kitten_urgency_factors, factor]
    }));
  };

  if (loading) {
    return (
      <div>
        <BackButton fallbackHref="/requests" />
        <div className="loading" style={{ marginTop: "2rem" }}>Loading request...</div>
      </div>
    );
  }

  if (error && !request) {
    return (
      <div>
        <BackButton fallbackHref="/requests" />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!request) return null;

  const isResolved = request.status === "completed" || request.status === "cancelled";

  return (
    <div>
      <BackButton fallbackHref="/requests" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0 }}>
              {request.summary || request.place_name || "TNR Request"}
            </h1>
            {request.source_system === "airtable" && <LegacyBadge />}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <StatusBadge status={request.status} />
            <PriorityBadge priority={request.priority} />
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{ padding: "0.5rem 1rem" }}>
            Edit
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: "#dc3545", marginBottom: "1rem", padding: "0.75rem", background: "#f8d7da", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      {editing ? (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Edit Request</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  style={{ width: "100%" }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Priority
                </label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                  style={{ width: "100%" }}
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Summary
              </label>
              <input
                type="text"
                value={editForm.summary}
                onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Estimated Cats
                </label>
                <input
                  type="number"
                  min="0"
                  value={editForm.estimated_cat_count}
                  onChange={(e) => setEditForm({ ...editForm, estimated_cat_count: e.target.value ? parseInt(e.target.value) : "" })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Assigned To
                </label>
                <input
                  type="text"
                  value={editForm.assigned_to}
                  onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editForm.has_kittens}
                  onChange={(e) => setEditForm({ ...editForm, has_kittens: e.target.checked })}
                />
                Has kittens
              </label>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span>Cats friendly?</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === true}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: true })}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === false}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: false })}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === null}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: null })}
                  />
                  Unknown
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Scheduled Date
                </label>
                <input
                  type="date"
                  value={editForm.scheduled_date}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Time Range
                </label>
                <input
                  type="text"
                  value={editForm.scheduled_time_range}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_time_range: e.target.value })}
                  placeholder="e.g., morning, 9am-12pm"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Notes
              </label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={4}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            {(editForm.status === "completed" || editForm.status === "cancelled") && (
              <>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Resolution Notes
                  </label>
                  <textarea
                    value={editForm.resolution_notes}
                    onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })}
                    rows={3}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Cats Trapped
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_trapped}
                      onChange={(e) => setEditForm({ ...editForm, cats_trapped: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Cats Returned
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_returned}
                      onChange={(e) => setEditForm({ ...editForm, cats_returned: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "inherit" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Location Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Location</h2>
            {request.place_id ? (
              <div>
                <a href={`/places/${request.place_id}`} style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                  {request.place_name}
                </a>
                {request.place_address && (
                  <p className="text-muted" style={{ margin: "0.25rem 0 0" }}>
                    {request.place_address}
                  </p>
                )}
                {request.place_city && (
                  <p className="text-muted text-sm" style={{ margin: "0.25rem 0 0" }}>
                    {request.place_city}{request.place_postal_code ? `, ${request.place_postal_code}` : ""}
                  </p>
                )}
                {request.place_kind && (
                  <span className="badge" style={{ marginTop: "0.5rem", display: "inline-block" }}>
                    {request.place_kind}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted">No location linked</p>
            )}
          </div>

          {/* Requester Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Requester</h2>
            {request.requester_person_id ? (
              <a href={`/people/${request.requester_person_id}`} style={{ fontWeight: 500 }}>
                {request.requester_name}
              </a>
            ) : (
              <p className="text-muted">No requester linked</p>
            )}
          </div>

          {/* Details Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Details</h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Estimated Cats</div>
                <div style={{ fontWeight: 500 }}>
                  {request.estimated_cat_count ?? "Unknown"}
                  {request.has_kittens && (
                    <span style={{ marginLeft: "0.5rem", color: "#fd7e14" }}>+kittens</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-muted text-sm">Cats Friendly</div>
                <div style={{ fontWeight: 500 }}>
                  {request.cats_are_friendly === true ? "Yes" : request.cats_are_friendly === false ? "No" : "Unknown"}
                </div>
              </div>

              <div>
                <div className="text-muted text-sm">Assigned To</div>
                <div style={{ fontWeight: 500 }}>
                  {request.assigned_to || "Unassigned"}
                </div>
              </div>

              <div>
                <div className="text-muted text-sm">Scheduled</div>
                <div style={{ fontWeight: 500 }}>
                  {request.scheduled_date ? (
                    <>
                      {new Date(request.scheduled_date).toLocaleDateString()}
                      {request.scheduled_time_range && ` (${request.scheduled_time_range})`}
                    </>
                  ) : (
                    "Not scheduled"
                  )}
                </div>
              </div>
            </div>

            {request.notes && (
              <div style={{ marginTop: "1.5rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Notes</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{request.notes}</div>
              </div>
            )}
          </div>

          {/* Kitten Assessment Card (when has_kittens is true) */}
          {request.has_kittens && (
            <div className="card" style={{
              padding: "1.5rem",
              marginBottom: "1.5rem",
              background: "rgba(33, 150, 243, 0.1)",
              border: "1px solid #2196f3"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.25rem", margin: 0, color: "#1565c0" }}>
                  Kitten Assessment
                </h2>
                {!editingKittens && (
                  <button
                    onClick={() => setEditingKittens(true)}
                    style={{ padding: "0.5rem 1rem" }}
                  >
                    {request.kitten_assessment_status ? "Edit Assessment" : "Assess Kittens"}
                  </button>
                )}
              </div>

              {editingKittens ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* Kitten Count and Age */}
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 150px" }}>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Kitten Count
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={kittenForm.kitten_count}
                        onChange={(e) => setKittenForm({ ...kittenForm, kitten_count: e.target.value ? parseInt(e.target.value) : "" })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div style={{ flex: "1 1 150px" }}>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Age (weeks)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={kittenForm.kitten_age_weeks}
                        onChange={(e) => setKittenForm({ ...kittenForm, kitten_age_weeks: e.target.value ? parseInt(e.target.value) : "" })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>

                  {/* Assessment Status */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Assessment Status
                    </label>
                    <select
                      value={kittenForm.kitten_assessment_status}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_assessment_status: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select status...</option>
                      {KITTEN_ASSESSMENT_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Outcome */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Outcome Decision
                    </label>
                    <select
                      value={kittenForm.kitten_assessment_outcome}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_assessment_outcome: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select outcome...</option>
                      {KITTEN_OUTCOME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Foster Readiness */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Foster Readiness
                    </label>
                    <select
                      value={kittenForm.kitten_foster_readiness}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_foster_readiness: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select readiness...</option>
                      {FOSTER_READINESS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Urgency Factors */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                      Urgency Factors
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {URGENCY_FACTOR_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.5rem 0.75rem",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            background: kittenForm.kitten_urgency_factors.includes(opt.value)
                              ? "rgba(33, 150, 243, 0.2)"
                              : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={kittenForm.kitten_urgency_factors.includes(opt.value)}
                            onChange={() => toggleUrgencyFactor(opt.value)}
                            style={{ marginRight: "0.25rem" }}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Assessment Notes */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Assessment Notes
                    </label>
                    <textarea
                      value={kittenForm.kitten_assessment_notes}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_assessment_notes: e.target.value })}
                      rows={3}
                      style={{ width: "100%", resize: "vertical" }}
                      placeholder="Notes about the kittens, socialization level, health observations, etc."
                    />
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                    <button onClick={handleSaveKittens} disabled={savingKittens}>
                      {savingKittens ? "Saving..." : "Save Assessment"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelKittens}
                      style={{ background: "transparent", border: "1px solid var(--border)", color: "inherit" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Display existing assessment */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
                    <div>
                      <div className="text-muted text-sm">Kitten Count</div>
                      <div style={{ fontWeight: 500, fontSize: "1.25rem" }}>
                        {request.kitten_count ?? "Not recorded"}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Age</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_age_weeks
                          ? `~${request.kitten_age_weeks} weeks`
                          : "Unknown"}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Assessment Status</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_assessment_status ? (
                          <span style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            background: request.kitten_assessment_status === "assessed"
                              ? "#198754"
                              : request.kitten_assessment_status === "follow_up"
                                ? "#ffc107"
                                : "#6c757d",
                            color: request.kitten_assessment_status === "follow_up" ? "#000" : "#fff",
                            fontSize: "0.85rem"
                          }}>
                            {request.kitten_assessment_status.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span style={{ color: "#dc3545" }}>Pending</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Outcome</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_assessment_outcome
                          ? request.kitten_assessment_outcome.replace(/_/g, " ")
                          : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Foster Readiness</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_foster_readiness ? (
                          <span style={{
                            color: request.kitten_foster_readiness === "high"
                              ? "#198754"
                              : request.kitten_foster_readiness === "medium"
                                ? "#ffc107"
                                : "#dc3545"
                          }}>
                            {request.kitten_foster_readiness}
                          </span>
                        ) : "—"}
                      </div>
                    </div>
                  </div>

                  {request.kitten_urgency_factors && request.kitten_urgency_factors.length > 0 && (
                    <div style={{ marginTop: "1rem" }}>
                      <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Urgency Factors</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                        {request.kitten_urgency_factors.map((factor) => (
                          <span
                            key={factor}
                            style={{
                              background: "#dc3545",
                              color: "#fff",
                              padding: "0.25rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.85rem"
                            }}
                          >
                            {factor.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {request.kitten_assessment_notes && (
                    <div style={{ marginTop: "1rem" }}>
                      <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Assessment Notes</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{request.kitten_assessment_notes}</div>
                    </div>
                  )}

                  {request.kitten_assessed_by && (
                    <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                      Assessed by {request.kitten_assessed_by}
                      {request.kitten_assessed_at && (
                        <> on {new Date(request.kitten_assessed_at).toLocaleDateString()}</>
                      )}
                    </div>
                  )}

                  {!request.kitten_assessment_status && (
                    <div style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      background: "rgba(255, 193, 7, 0.15)",
                      borderRadius: "6px",
                      border: "1px dashed #ffc107"
                    }}>
                      <p style={{ margin: 0, color: "#856404" }}>
                        This request has kittens that need to be assessed by the foster coordinator.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Resolution Card (if resolved) */}
          {isResolved && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Resolution</h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
                <div>
                  <div className="text-muted text-sm">Resolved</div>
                  <div style={{ fontWeight: 500 }}>
                    {request.resolved_at ? new Date(request.resolved_at).toLocaleDateString() : "—"}
                  </div>
                </div>

                <div>
                  <div className="text-muted text-sm">Cats Trapped</div>
                  <div style={{ fontWeight: 500 }}>{request.cats_trapped ?? "—"}</div>
                </div>

                <div>
                  <div className="text-muted text-sm">Cats Returned</div>
                  <div style={{ fontWeight: 500 }}>{request.cats_returned ?? "—"}</div>
                </div>
              </div>

              {request.resolution_notes && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Resolution Notes</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{request.resolution_notes}</div>
                </div>
              )}
            </div>
          )}

          {/* Legacy Internal Notes Card (for Airtable imports) */}
          {request.legacy_notes && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "var(--card-bg, #1a1a1a)", border: "1px solid var(--border)" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>📋</span>
                Internal Notes (from Airtable)
              </h2>
              <div style={{
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: "0.9rem",
                background: "var(--code-bg, #0d0d0d)",
                color: "var(--foreground)",
                padding: "1rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                maxHeight: "400px",
                overflowY: "auto"
              }}>
                {request.legacy_notes}
              </div>
              <p className="text-muted text-sm" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                These notes were imported from Airtable and are read-only. Future notes will use the new journal system.
              </p>
            </div>
          )}

          {/* Linked Cats Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Linked Cats</h2>
            {request.cats && request.cats.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {request.cats.map((cat) => (
                  <a
                    key={cat.cat_id}
                    href={`/cats/${cat.cat_id}`}
                    style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}
                  >
                    {cat.cat_name || "Unnamed cat"}
                    <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                      ({cat.relationship})
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-muted">No cats linked to this request yet</p>
            )}
          </div>

          {/* Photos & Media Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Photos & Media</h2>
              <button
                onClick={() => setShowUploadForm(!showUploadForm)}
                style={{ padding: "0.5rem 1rem" }}
              >
                {showUploadForm ? "Cancel" : "+ Upload"}
              </button>
            </div>

            {showUploadForm && (
              <form onSubmit={handleMediaUpload} style={{ marginBottom: "1.5rem", padding: "1rem", background: "var(--bg-muted)", borderRadius: "8px" }}>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    What type of photo is this?
                  </label>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <label style={{
                      display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer",
                      padding: "0.5rem 1rem", border: "1px solid var(--border)", borderRadius: "6px",
                      background: uploadMediaType === "cat_photo" ? "var(--primary)" : "transparent",
                      color: uploadMediaType === "cat_photo" ? "#fff" : "inherit"
                    }}>
                      <input
                        type="radio"
                        name="mediaType"
                        value="cat_photo"
                        checked={uploadMediaType === "cat_photo"}
                        onChange={() => setUploadMediaType("cat_photo")}
                        style={{ display: "none" }}
                      />
                      Cat Photo
                    </label>
                    <label style={{
                      display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer",
                      padding: "0.5rem 1rem", border: "1px solid var(--border)", borderRadius: "6px",
                      background: uploadMediaType === "site_photo" ? "var(--primary)" : "transparent",
                      color: uploadMediaType === "site_photo" ? "#fff" : "inherit"
                    }}>
                      <input
                        type="radio"
                        name="mediaType"
                        value="site_photo"
                        checked={uploadMediaType === "site_photo"}
                        onChange={() => setUploadMediaType("site_photo")}
                        style={{ display: "none" }}
                      />
                      Site/Colony Photo
                    </label>
                    <label style={{
                      display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer",
                      padding: "0.5rem 1rem", border: "1px solid var(--border)", borderRadius: "6px",
                      background: uploadMediaType === "evidence" ? "var(--primary)" : "transparent",
                      color: uploadMediaType === "evidence" ? "#fff" : "inherit"
                    }}>
                      <input
                        type="radio"
                        name="mediaType"
                        value="evidence"
                        checked={uploadMediaType === "evidence"}
                        onChange={() => setUploadMediaType("evidence")}
                        style={{ display: "none" }}
                      />
                      Documentation
                    </label>
                  </div>
                </div>

                {uploadMediaType === "cat_photo" && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Describe the cat (if not yet identified)
                    </label>
                    <input
                      type="text"
                      value={uploadCatDescription}
                      onChange={(e) => setUploadCatDescription(e.target.value)}
                      placeholder="e.g., orange tabby, black female, calico"
                      style={{ width: "100%" }}
                    />
                    <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                      You can link this photo to a specific cat later
                    </p>
                  </div>
                )}

                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Caption (optional)
                  </label>
                  <input
                    type="text"
                    value={uploadCaption}
                    onChange={(e) => setUploadCaption(e.target.value)}
                    placeholder="What does this photo show?"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Select Photo
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    required
                  />
                </div>

                <button type="submit" disabled={uploadingMedia}>
                  {uploadingMedia ? "Uploading..." : "Upload Photo"}
                </button>
              </form>
            )}

            {loadingMedia ? (
              <div className="text-muted">Loading media...</div>
            ) : media.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1rem" }}>
                {media.map((item) => (
                  <div key={item.media_id} style={{ border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                    <div style={{ aspectRatio: "1", background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <img
                        src={`/api${item.storage_path}`}
                        alt={item.caption || item.original_filename}
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                    <div style={{ padding: "0.5rem" }}>
                      <div className="text-sm" style={{ fontWeight: 500 }}>
                        {item.media_type === "cat_photo" ? "Cat" : item.media_type === "site_photo" ? "Site" : "Doc"}
                      </div>
                      {item.caption && (
                        <div className="text-muted text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.caption}
                        </div>
                      )}
                      {item.cat_description && (
                        <div className="text-muted text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.cat_description}
                        </div>
                      )}
                      <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                        {new Date(item.uploaded_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted">
                <p>No photos uploaded yet.</p>
                <p className="text-sm" style={{ marginTop: "0.5rem" }}>
                  Upload photos of cats or the trapping site to help trappers.
                </p>
              </div>
            )}
          </div>

          {/* Metadata Card */}
          <div className="card" style={{ padding: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Metadata</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Created</div>
                <div>{new Date(request.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Updated</div>
                <div>{new Date(request.updated_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Source</div>
                <div>{request.data_source}{request.source_system && ` (${request.source_system})`}</div>
              </div>
              {request.created_by && (
                <div>
                  <div className="text-muted text-sm">Created By</div>
                  <div>{request.created_by}</div>
                </div>
              )}
            </div>
            <div style={{ marginTop: "1rem" }}>
              <div className="text-muted text-sm">Request ID</div>
              <code style={{ fontSize: "0.8rem" }}>{request.request_id}</code>
            </div>
            {request.source_system === "airtable" && request.source_record_id && (
              <div style={{ marginTop: "1rem" }}>
                <a
                  href={`https://airtable.com/appl6zLrRFDvsz0dh/tblc1bva7jFzg8DVF/${request.source_record_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "0.875rem" }}
                >
                  View in Airtable &rarr;
                </a>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
