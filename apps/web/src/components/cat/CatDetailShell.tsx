"use client";

import { useState, useCallback } from "react";
import { useCatDetail } from "@/hooks/useCatDetail";
import { TwoColumnLayout, Section, StatsSidebar, StatRow } from "@/components/layouts";
import { TabBar } from "@/components/ui";
import { BackButton, EditHistory, QuickActions, useCatQuickActionState } from "@/components/common";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { ReportDeceasedModal, RecordBirthModal, AppointmentDetailModal } from "@/components/modals";
import { OwnershipTransferWizard } from "@/components/forms";
import { VerificationBadge, LastVerified, AtlasCatIdBadge, MicrochipStatusBadge } from "@/components/badges";
import { MediaGallery } from "@/components/media";
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
}

export function CatDetailShell({ id }: CatDetailShellProps) {
  const data = useCatDetail(id);
  const preview = useEntityPreviewModal();
  const navContext = useNavigationContext(data.cat?.display_name);

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
    return <div className="loading">Loading cat details...</div>;
  }

  if (data.error) {
    return (
      <div>
        <BackButton fallbackHref="/cats" />
        <div className="empty" style={{ marginTop: "2rem" }}>
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

  // ── Header ──
  const headerContent = (
    <div>
      {navContext.breadcrumbs.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <Breadcrumbs items={navContext.breadcrumbs} />
        </div>
      )}
      <BackButton fallbackHref={navContext.backHref} />

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
                postApi(`/api/appointments/${apptId}`, { clinic_day_number: num }, { method: "PATCH" }).catch(() => {});
              } : undefined}
              appointmentOptions={cat.appointments?.map((a) => ({
                appointment_id: a.appointment_id,
                appointment_date: a.appointment_date,
                clinic_day_number: a.clinic_day_number,
              }))}
            />
          </div>

          {/* Patient Info */}
          <div style={{ flex: 1, minWidth: "200px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.75rem", color: cat.is_deceased ? "var(--muted)" : "inherit" }}>
                {cat.display_name}
              </h1>
              {cat.is_deceased && (
                <span className="badge" style={{ background: "#dc3545", color: "#fff", fontSize: "0.6em" }}
                  title={cat.mortality_event?.mortality_timing && cat.mortality_event.mortality_timing !== "unspecified"
                    ? `Deceased: ${cat.mortality_event.mortality_timing.replace(/_/g, "-")}${cat.mortality_event.mortality_cause_detail ? `, ${cat.mortality_event.mortality_cause_detail.replace(/_/g, " ")}` : ""}`
                    : cat.deceased_date ? `Deceased: ${formatDateLocal(cat.deceased_date)}` : "Deceased"
                  }>
                  DECEASED
                </span>
              )}
              {data.clinicalNotes?.has_medical_notes && (
                <span className="badge" style={{ background: "#0284c7", color: "#fff", fontSize: "0.6em" }} title="Has clinical notes from ClinicHQ">HAS NOTES</span>
              )}
              {cat.atlas_cat_id && <AtlasCatIdBadge atlasCatId={cat.atlas_cat_id} isChipped={cat.atlas_cat_id_type !== "hash"} size="md" />}
              {cat.needs_microchip && <MicrochipStatusBadge hasChip={false} size="md" />}
              <CatDataSourceBadge dataSource={cat.data_source} />
              <OwnershipTypeBadge ownershipType={cat.ownership_type} />
              {cat.has_field_conflicts && (
                <span className="badge" style={{ background: "#ffc107", color: "#000", fontSize: "0.5em", display: "flex", alignItems: "center", gap: "0.25rem" }}
                  title="This cat has field values that differ between data sources.">
                  Multi-Source Data
                </span>
              )}
              {cat.field_source_count > 1 && !cat.has_field_conflicts && (
                <span className="badge" style={{ background: "#e9ecef", color: "#495057", fontSize: "0.5em" }} title={`Data from ${cat.field_source_count} sources`}>
                  {cat.field_source_count} Sources
                </span>
              )}
              {!editingBasic && (
                <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                  <a href={`/cats/${cat.cat_id}/print`} target="_blank" rel="noopener noreferrer"
                    style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", color: "inherit", border: "1px solid var(--border)", borderRadius: "6px", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                    Print
                  </a>
                  <button onClick={() => setShowHistory(!showHistory)}
                    style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: showHistory ? "var(--primary)" : "transparent", color: showHistory ? "white" : "inherit", border: showHistory ? "none" : "1px solid var(--border)" }}>
                    History
                  </button>
                  <button onClick={startEditingBasic} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}>Edit</button>
                  <button onClick={() => setShowBirthModal(true)}
                    style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", color: "#198754", border: "1px solid #198754" }}>
                    {cat.birth_event ? "Edit Birth Info" : "Record Birth Info"}
                  </button>
                  {!cat.is_deceased && (
                    <button onClick={() => setShowDeceasedModal(true)}
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", color: "#dc3545", border: "1px solid #dc3545" }}>
                      Report Deceased
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Unchipped Cat Alert */}
            {cat.needs_microchip && !editingBasic && (
              <div style={{ marginTop: "0.75rem", padding: "0.75rem 1rem", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "6px", fontSize: "0.875rem", color: "#92400e" }}>
                <strong>No Microchip:</strong> This cat does not have a microchip on record. It was identified via ClinicHQ Animal ID
                {cat.identifiers?.find(ident => ident.type === "clinichq_animal_id")?.value && (
                  <span style={{ fontFamily: "monospace", marginLeft: "0.25rem" }}>
                    ({cat.identifiers.find(ident => ident.type === "clinichq_animal_id")?.value})
                  </span>
                )}.
              </div>
            )}

            {editingBasic ? (
              <div style={{ marginTop: "1rem" }}>
                {saveError && (
                  <div style={{ color: "#dc3545", marginBottom: "0.75rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", fontSize: "0.875rem" }}>{saveError}</div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Name</label>
                    <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={{ width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Sex</label>
                    <select value={editForm.sex} onChange={(e) => setEditForm({ ...editForm, sex: e.target.value })} style={{ width: "100%" }}>
                      <option value="">Unknown</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Color/Pattern</label>
                    <input type="text" value={editForm.color_pattern} onChange={(e) => setEditForm({ ...editForm, color_pattern: e.target.value })} placeholder="e.g., orange tabby, black" style={{ width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Breed</label>
                    <input type="text" value={editForm.breed} onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })} placeholder="e.g., DSH, Siamese" style={{ width: "100%" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", paddingTop: "1.5rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input type="checkbox" checked={editForm.is_eartipped} onChange={(e) => setEditForm({ ...editForm, is_eartipped: e.target.checked })} />
                      Ear-tipped (altered)
                    </label>
                  </div>
                </div>
                <div style={{ marginTop: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Notes</label>
                  <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} style={{ width: "100%", resize: "vertical" }} />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button onClick={handleSaveBasic} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
                  <button onClick={() => { setEditingBasic(false); setSaveError(null); }} disabled={saving} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
                <div>
                  <div className="text-muted text-sm">Microchip</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 500 }}>{cat.microchip || "\u2014"}</div>
                </div>
                <MultiSourceField label="Sex" fieldName="sex" primaryValue={cat.sex} fieldSources={cat.field_sources} formatValue={(v) => v.charAt(0).toUpperCase() + v.slice(1)} />
                <div>
                  <div className="text-muted text-sm">Altered</div>
                  <div style={{ fontWeight: 500 }}>
                    {cat.altered_status && ["yes", "spayed", "neutered"].includes(cat.altered_status.toLowerCase()) ? (
                      <span style={{ color: "#198754" }}>
                        Yes {cat.altered_by_clinic ? "(by clinic)" : ""}
                        {cat.altered_status.toLowerCase() === "spayed" ? " \u2014 Spayed" : cat.altered_status.toLowerCase() === "neutered" ? " \u2014 Neutered" : ""}
                      </span>
                    ) : cat.altered_status === "No" || cat.altered_status?.toLowerCase() === "intact" ? (
                      <span style={{ color: "#dc3545" }}>No</span>
                    ) : "Unknown"}
                  </div>
                </div>
                <MultiSourceField label="Breed" fieldName="breed" primaryValue={cat.breed} fieldSources={cat.field_sources} />
                <MultiSourceField label="Color" fieldName="primary_color"
                  primaryValue={cat.color ? `${cat.color}${cat.secondary_color ? ` / ${cat.secondary_color}` : ""}${cat.coat_pattern ? ` (${cat.coat_pattern})` : ""}` : null}
                  fieldSources={cat.field_sources} />
                <div>
                  <div className="text-muted text-sm">Weight</div>
                  <div style={{ fontWeight: 500 }}>
                    {data.latestWeight?.weight_lbs ? `${data.latestWeight.weight_lbs} lbs` : "\u2014"}
                    {data.latestWeight?.recorded_at && (
                      <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>({formatDateLocal(data.latestWeight.recorded_at)})</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Status - FeLV/FIV prominent */}
          <div style={{ background: "var(--section-bg)", borderRadius: "8px", padding: "1rem", border: "1px solid var(--border)", minWidth: "140px", textAlign: "center" }}>
            <div style={{ marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--muted)" }}>FeLV/FIV</div>
            {data.felvFivStatus.hasAnyTest ? (
              <>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: data.felvFivStatus.anyPositive ? "#dc3545" : "#198754" }}>
                  {data.felvFivStatus.anyPositive ? "POS" : "NEG"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  {data.felvFivStatus.felvResult && (
                    <span style={{ color: data.felvFivStatus.felvResult === "positive" ? "#dc3545" : "#198754" }}>FeLV: {data.felvFivStatus.felvResult === "positive" ? "+" : "-"}</span>
                  )}
                  {data.felvFivStatus.felvResult && data.felvFivStatus.fivResult && " / "}
                  {data.felvFivStatus.fivResult && (
                    <span style={{ color: data.felvFivStatus.fivResult === "positive" ? "#dc3545" : "#198754" }}>FIV: {data.felvFivStatus.fivResult === "positive" ? "+" : "-"}</span>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: "1.25rem", color: "var(--muted)" }}>Not Tested</div>
            )}
            {data.felvFivStatus.testDate && (
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{formatDateLocal(data.felvFivStatus.testDate)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Sidebar ──
  const sidebarContent = (
    <div className="space-y-4">
      <StatsSidebar
        stats={[
          { label: "Appointments", value: cat.total_appointments || 0, icon: "\uD83D\uDCC5" },
          { label: "People", value: cat.owners?.length || 0, icon: "\uD83D\uDC64" },
          { label: "Places", value: cat.places?.length || 0, icon: "\uD83D\uDCCD" },
          ...(data.latestWeight?.weight_lbs ? [{ label: "Weight", value: `${data.latestWeight.weight_lbs} lbs`, icon: "\u2696\uFE0F" }] : []),
        ]}
        sections={[
          {
            title: "Quick Actions",
            content: (
              <QuickActions
                entityType="cat"
                entityId={cat.cat_id}
                state={useCatQuickActionState({
                  altered_status: cat.altered_status === "Yes" ? "altered" : cat.altered_status === "No" ? "intact" : "unknown",
                  microchip: cat.microchip,
                  owner_person_id: cat.owners?.[0]?.person_id,
                  place_id: cat.places?.[0]?.place_id,
                })}
                onActionComplete={data.fetchCat}
              />
            ),
          },
          {
            title: "Verification",
            content: (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <VerificationBadge table="cats" recordId={cat.cat_id} verifiedAt={cat.verified_at} verifiedBy={cat.verified_by_name} onVerify={() => data.fetchCat()} />
                {cat.verified_at && <LastVerified verifiedAt={cat.verified_at} verifiedBy={cat.verified_by_name} />}
              </div>
            ),
          },
          {
            title: "Record Info",
            content: (
              <div style={{ fontSize: "0.875rem" }}>
                <StatRow label="Data Source" value={cat.data_source === "clinichq" ? "ClinicHQ" : cat.data_source === "petlink" ? "PetLink" : cat.data_source || "Unknown"} />
                {cat.first_appointment_date && <StatRow label="First Appt" value={formatDateLocal(cat.first_appointment_date)} />}
                {cat.last_appointment_date && <StatRow label="Last Appt" value={formatDateLocal(cat.last_appointment_date)} />}
                <StatRow label="Created" value={formatDateLocal(cat.created_at)} />
                <StatRow label="Updated" value={formatDateLocal(cat.updated_at)} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  // ── Tabs ──
  const tabDefs = [
    { id: "overview", label: "Overview" },
    { id: "medical", label: "Medical" },
    { id: "connections", label: "Connections", count: (cat.owners?.length || 0) + (cat.places?.length || 0) || undefined },
  ];

  // ── Main content ──
  const mainContent = (
    <>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ padding: "0 1rem" }}>
          <TabBar tabs={tabDefs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {activeTab === "overview" && (
        <OverviewTab data={data} preview={preview} />
      )}
      {activeTab === "medical" && (
        <MedicalTab data={data} preview={preview} onAppointmentClick={setSelectedAppointmentId} />
      )}
      {activeTab === "connections" && (
        <ConnectionsTab data={data} preview={preview} onTransfer={() => setShowTransferWizard(true)} />
      )}
    </>
  );

  return (
    <>
      <TwoColumnLayout
        header={headerContent}
        main={mainContent}
        sidebar={sidebarContent}
        sidebarWidth="35%"
      />

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
