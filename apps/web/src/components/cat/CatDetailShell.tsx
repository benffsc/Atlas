"use client";

import { useState, useCallback } from "react";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useCatDetail } from "@/hooks/useCatDetail";
import { TabBar } from "@/components/ui";
import { BackButton, EditHistory, QuickActions, useCatQuickActionState } from "@/components/common";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { ReportDeceasedModal, RecordBirthModal, AppointmentDetailModal } from "@/components/modals";
import { OwnershipTransferWizard } from "@/components/forms";
import { VerificationBadge, LastVerified, AtlasCatIdBadge, MicrochipStatusBadge } from "@/components/badges";
import { MediaGallery } from "@/components/media";
import { Icon } from "@/components/ui/Icon";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { useNavigationContext } from "@/hooks/useNavigationContext";
import { formatDateLocal } from "@/lib/formatters";
import { postApi } from "@/lib/api-client";
import { CatDataSourceBadge, OwnershipTypeBadge, MultiSourceField } from "./helpers";

// Section components (overview tab)
import { OverviewTab } from "./sections/OverviewTab";
// Section components (medical tab)
import { MedicalTab } from "./sections/MedicalTab";
// Section components (connections tab)
import { ConnectionsTab } from "./sections/ConnectionsTab";

interface CatDetailShellProps {
  id: string;
  mode?: "page" | "panel";
  onClose?: () => void;
  onDataUpdated?: () => void;
}

export function CatDetailShell({ id, mode = "page", onClose, onDataUpdated }: CatDetailShellProps) {
  const data = useCatDetail(id);
  const preview = useEntityPreviewModal();
  const navContext = useNavigationContext(data.cat?.display_name);
  const { ref: containerRef, isNarrow } = useContainerWidth();
  const isPanel = mode === "panel";

  const [activeTab, setActiveTab] = useState("overview");
  const [showHistory, setShowHistory] = useState(false);
  const [showDeceasedModal, setShowDeceasedModal] = useState(false);
  const [showBirthModal, setShowBirthModal] = useState(false);
  const [showTransferWizard, setShowTransferWizard] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  // Inline editing state
  const [editingBasic, setEditingBasic] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", sex: "", is_eartipped: false, color_pattern: "", breed: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEditingBasic = () => {
    if (!data.cat) return;
    const cat = data.cat;
    const normalizedSex = cat.sex ? cat.sex.toLowerCase() : "";
    const isAltered = cat.altered_status ? ["yes", "spayed", "neutered"].includes(cat.altered_status.toLowerCase()) : false;
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
  };

  const handleSaveBasic = async () => {
    if (!data.cat) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postApi(`/api/cats/${id}`, {
        name: editForm.name || null,
        sex: editForm.sex || null,
        is_eartipped: editForm.is_eartipped,
        color_pattern: editForm.color_pattern || null,
        breed: editForm.breed || null,
        notes: editForm.notes || null,
        change_reason: "manual_edit",
      }, { method: "PATCH" });
      await data.fetchCat();
      setEditingBasic(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  // Loading / Error states
  if (data.loading) {
    return <div className="loading" style={isPanel ? { padding: "1rem" } : undefined}>Loading cat details...</div>;
  }

  if (data.error) {
    return (
      <div style={isPanel ? { padding: "1rem" } : undefined}>
        {!isPanel && <BackButton fallbackHref="/cats" />}
        <div className="empty" style={{ marginTop: isPanel ? "0.5rem" : "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{data.error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>Cat ID: <code>{id}</code></p>
        </div>
      </div>
    );
  }

  if (!data.cat) {
    return <div className="empty">Cat not found</div>;
  }

  const cat = data.cat;

  const alteredDisplay = cat.altered_status && ["yes", "spayed", "neutered"].includes(cat.altered_status.toLowerCase())
    ? `Yes \u2013 ${cat.altered_status.charAt(0).toUpperCase() + cat.altered_status.slice(1)}`
    : cat.altered_status === "No" || cat.altered_status?.toLowerCase() === "intact"
      ? "Intact"
      : "Unknown";

  // ── Tabs ──
  const tabDefs = [
    { id: "overview", label: "Overview" },
    { id: "medical", label: "Medical" },
    { id: "connections", label: "Connections", count: (cat.owners?.length || 0) + (cat.places?.length || 0) || undefined },
  ];

  const actionButtons = !editingBasic ? (
    <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
      <button onClick={startEditingBasic} style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", fontWeight: 600, background: "var(--primary)", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}>Edit</button>
      <button onClick={() => setShowHistory(!showHistory)} title="History" style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}>{"\u22EE"}</button>
    </div>
  ) : null;

  return (
    <>
      <div ref={containerRef} style={{ maxWidth: isPanel ? undefined : 1100, padding: isPanel ? (isNarrow ? "0.5rem" : "0.75rem") : undefined }}>
        {/* Panel header */}
        {isPanel && (
          <div style={{
            position: "sticky", top: 0, zIndex: 10, background: "var(--background, #fff)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0.5rem 0", marginBottom: "0.5rem", borderBottom: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "0.25rem", color: "var(--text-muted)", flexShrink: 0 }} title="Close panel">
                <Icon name="x" size={18} />
              </button>
              <span style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cat.display_name}
              </span>
            </div>
            <a href={`/cats/${id}?from=cats`} style={{ fontSize: "0.75rem", color: "var(--primary)", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
              Open Full Profile →
            </a>
          </div>
        )}

        {/* Breadcrumbs + Actions (page mode only) */}
        {!isPanel && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <Breadcrumbs items={navContext.breadcrumbs.length > 0 ? navContext.breadcrumbs : [{ label: "Cats", href: "/cats" }, { label: cat.display_name }]} />
            {actionButtons}
          </div>
        )}

        {/* ── Hero Card ── */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: isNarrow ? "1rem" : "1.5rem", marginBottom: isNarrow ? "1rem" : "1.5rem" }}>
          {/* Panel-mode action buttons */}
          {isPanel && actionButtons && (
            <div style={{ marginBottom: "0.75rem" }}>{actionButtons}</div>
          )}
          <div className="hero-card-layout" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {/* Photo */}
            <div className="hero-card-photo" style={{ width: isNarrow ? 100 : 160, flexShrink: 0 }}>
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
                  postApi(`/api/appointments/${apptId}`, { clinic_day_number: num }, { method: "PATCH" }).catch(() => {});
                } : undefined}
                appointmentOptions={cat.appointments?.map((a) => ({
                  appointment_id: a.appointment_id,
                  appointment_date: a.appointment_date,
                  clinic_day_number: a.clinic_day_number,
                }))}
              />
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h1 style={{ margin: "0 0 0.5rem", fontSize: isNarrow ? "1.1rem" : "1.5rem", fontWeight: 700, color: cat.is_deceased ? "var(--muted)" : "inherit" }}>
                {cat.display_name}
              </h1>

              {/* Badges row */}
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <CatDataSourceBadge dataSource={cat.data_source} />
                {cat.is_deceased && <span className="badge" style={{ background: "#dc3545", color: "#fff" }}>Deceased</span>}
                {data.clinicalNotes?.has_medical_notes && <span className="badge" style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>Has notes</span>}
                {cat.has_field_conflicts && <span className="badge" style={{ background: "#ffc107", color: "#000" }}>Multi-Source Data</span>}
              </div>

              {editingBasic ? (
                <div>
                  {saveError && (
                    <div style={{ color: "#dc3545", marginBottom: "0.75rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", fontSize: "0.875rem" }}>{saveError}</div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.2rem", fontWeight: 500, fontSize: "0.8rem", color: "var(--text-muted)" }}>Name</label>
                      <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.2rem", fontWeight: 500, fontSize: "0.8rem", color: "var(--text-muted)" }}>Sex</label>
                      <select value={editForm.sex} onChange={(e) => setEditForm({ ...editForm, sex: e.target.value })} style={{ width: "100%" }}>
                        <option value="">Unknown</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.2rem", fontWeight: 500, fontSize: "0.8rem", color: "var(--text-muted)" }}>Color</label>
                      <input type="text" value={editForm.color_pattern} onChange={(e) => setEditForm({ ...editForm, color_pattern: e.target.value })} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.2rem", fontWeight: 500, fontSize: "0.8rem", color: "var(--text-muted)" }}>Breed</label>
                      <input type="text" value={editForm.breed} onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })} style={{ width: "100%" }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", paddingTop: "1.25rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.85rem" }}>
                        <input type="checkbox" checked={editForm.is_eartipped} onChange={(e) => setEditForm({ ...editForm, is_eartipped: e.target.checked })} />
                        Ear-tipped
                      </label>
                    </div>
                  </div>
                  <div style={{ marginTop: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.2rem", fontWeight: 500, fontSize: "0.8rem", color: "var(--text-muted)" }}>Notes</label>
                    <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} style={{ width: "100%", resize: "vertical" }} />
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button onClick={handleSaveBasic} disabled={saving} style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", fontWeight: 600, background: "var(--primary)", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}>{saving ? "Saving..." : "Save Changes"}</button>
                    <button onClick={() => { setEditingBasic(false); setSaveError(null); }} disabled={saving} style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Attribute grid — matches Figma: Microchip | Sex | Altered | Breed | Color */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem" }}>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Microchip</div>
                      <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: "0.85rem" }}>{cat.microchip || "\u2014"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Sex</div>
                      <div style={{ fontWeight: 600 }}>{cat.sex ? cat.sex.charAt(0).toUpperCase() + cat.sex.slice(1) : "\u2014"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Altered</div>
                      <div style={{ fontWeight: 600 }}>{alteredDisplay}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Breed</div>
                      <div style={{ fontWeight: 600 }}>{cat.breed || "\u2014"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Color</div>
                      <div style={{ fontWeight: 600 }}>{cat.color || "\u2014"}</div>
                    </div>
                  </div>

                  {/* Second row: Weight + FeLV/FIV */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Weight</div>
                      <div style={{ fontWeight: 600 }}>{data.latestWeight?.weight_lbs ? `${data.latestWeight.weight_lbs} lbs` : "\u2014"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>FeLV/ FIV</div>
                      <div>
                        {data.felvFivStatus.hasAnyTest ? (
                          <span className="badge" style={{
                            background: data.felvFivStatus.anyPositive ? "rgba(220,38,38,0.1)" : "rgba(22,163,74,0.1)",
                            color: data.felvFivStatus.anyPositive ? "#dc3545" : "#16a34a",
                            fontWeight: 600,
                          }}>
                            {data.felvFivStatus.anyPositive ? "Positive" : "Negative"}
                          </span>
                        ) : (
                          <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>Not Tested</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div style={{ marginBottom: isNarrow ? "1rem" : "1.5rem" }}>
          <TabBar tabs={tabDefs} activeTab={activeTab} onTabChange={setActiveTab} size={isNarrow ? "sm" : "md"} />
        </div>

        {/* ── Tab Content ── */}
        {activeTab === "overview" && <OverviewTab data={data} preview={preview} />}
        {activeTab === "medical" && <MedicalTab data={data} preview={preview} onAppointmentClick={setSelectedAppointmentId} />}
        {activeTab === "connections" && <ConnectionsTab data={data} preview={preview} onTransfer={() => setShowTransferWizard(true)} />}
      </div>

      {/* Edit History Panel */}
      {showHistory && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "400px",
          background: "var(--card-bg)", borderLeft: "1px solid var(--border)",
          padding: "1.5rem", overflowY: "auto", zIndex: 100,
          boxShadow: "-4px 0 10px rgba(0,0,0,0.2)",
        }}>
          <EditHistory entityType="cat" entityId={id} limit={50} onClose={() => setShowHistory(false)} />
        </div>
      )}

      {/* Ownership Transfer Wizard */}
      {showTransferWizard && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", maxWidth: "600px", width: "90%", maxHeight: "90vh", overflow: "auto" }}>
            <OwnershipTransferWizard
              catId={id}
              catName={cat.display_name}
              currentOwnerId={cat.owners?.[0]?.person_id || null}
              currentOwnerName={cat.owners?.[0]?.display_name || null}
              onComplete={() => { setShowTransferWizard(false); data.fetchCat(); }}
              onCancel={() => setShowTransferWizard(false)}
            />
          </div>
        </div>
      )}

      <ReportDeceasedModal
        isOpen={showDeceasedModal} onClose={() => setShowDeceasedModal(false)}
        catId={id} catName={cat.display_name}
        linkedPlaces={cat.places?.map(p => ({ place_id: p.place_id, label: p.label })) || []}
        onSuccess={() => data.fetchCat()}
      />

      <RecordBirthModal
        isOpen={showBirthModal} onClose={() => setShowBirthModal(false)}
        catId={id} catName={cat.display_name}
        linkedPlaces={cat.places?.map(p => ({ place_id: p.place_id, label: p.label })) || []}
        existingBirthEvent={cat.birth_event}
        onSuccess={() => data.fetchCat()}
      />

      <AppointmentDetailModal
        appointmentId={selectedAppointmentId}
        onClose={() => setSelectedAppointmentId(null)}
      />

      <EntityPreviewModal
        isOpen={preview.isOpen} onClose={preview.close}
        entityType={preview.entityType} entityId={preview.entityId}
      />
    </>
  );
}
