"use client";

import { useState } from "react";
import { Section } from "@/components/layouts";
import { formatDateLocal, formatPhone } from "@/lib/formatters";
import { postApi } from "@/lib/api-client";
import { EncounterAccordion, LifecycleTimeline } from "../helpers";
import type { CatDetailData, ClinicalNote } from "@/lib/cat-types";
import type { EntityType } from "@/hooks/useEntityDetail";

interface MedicalTabProps {
  data: CatDetailData;
  preview: { handleClick: (type: EntityType, id: string) => (e: React.MouseEvent) => void };
  onAppointmentClick: (id: string) => void;
}

export function MedicalTab({ data, preview, onAppointmentClick }: MedicalTabProps) {
  const cat = data.cat!;
  const [editingClinicNum, setEditingClinicNum] = useState<string | null>(null);
  const [clinicNumValue, setClinicNumValue] = useState("");

  const handleSaveClinicNum = async (appointmentId: string) => {
    const val = clinicNumValue.trim();
    const numVal = val === "" ? null : parseInt(val, 10);
    if (val !== "" && (isNaN(numVal!) || numVal! < 1 || numVal! > 999)) return;
    try {
      await postApi(`/api/appointments/${appointmentId}`, { clinic_day_number: numVal }, { method: "PATCH" });
    } catch { /* clinic day number update is non-critical */ }
    setEditingClinicNum(null);
  };

  return (
    <>
      {/* ── Medical History ── */}
      <Section title="Medical History">
        {/* Procedures */}
        {cat.procedures?.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>Procedures</h3>
            <div className="table-container">
              <table>
                <thead><tr><th>Date</th><th>Procedure</th><th>Vet</th><th>Notes</th></tr></thead>
                <tbody>
                  {cat.procedures.map(proc => (
                    <tr key={proc.procedure_id}>
                      <td>{formatDateLocal(proc.procedure_date)}</td>
                      <td>{proc.procedure_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</td>
                      <td>{proc.performed_by || "\u2014"}</td>
                      <td className="text-muted">
                        {proc.post_op_notes || (proc.complications?.length ? proc.complications.join(", ") : "\u2014")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Appointment History */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>Appointment History</h3>
          {cat.appointments && cat.appointments.length > 0 ? (
            <div className="table-container">
              <table>
                <thead><tr><th style={{ width: "2.5rem", textAlign: "center" }}>Day #</th><th>Date</th><th>Type</th><th>Services</th><th>Vet</th></tr></thead>
                <tbody>
                  {cat.appointments.map((appt) => (
                    <tr key={appt.appointment_id} onClick={() => onAppointmentClick(appt.appointment_id)} style={{ cursor: "pointer" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "var(--section-bg, #f8f9fa)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "")}>
                      <td style={{ textAlign: "center", width: "2.5rem", padding: "0.25rem" }}
                        onClick={(e) => { e.stopPropagation(); setEditingClinicNum(appt.appointment_id); setClinicNumValue(appt.clinic_day_number != null ? String(appt.clinic_day_number) : ""); }}>
                        {editingClinicNum === appt.appointment_id ? (
                          <input type="number" min={1} max={999} value={clinicNumValue} onChange={(e) => setClinicNumValue(e.target.value)}
                            onBlur={() => handleSaveClinicNum(appt.appointment_id)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveClinicNum(appt.appointment_id); if (e.key === "Escape") setEditingClinicNum(null); }}
                            autoFocus style={{ width: "2.5rem", textAlign: "center", border: "1px solid var(--border)", borderRadius: "3px", fontSize: "0.8rem", padding: "0.1rem" }}
                            onClick={(e) => e.stopPropagation()} />
                        ) : appt.clinic_day_number != null ? (
                          <a href={`#`} onClick={(e) => e.preventDefault()} style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--primary)" }}>{appt.clinic_day_number}</a>
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", cursor: "pointer" }} title="Set clinic day number">+</span>
                        )}
                      </td>
                      <td>{formatDateLocal(appt.appointment_date)}</td>
                      <td>{appt.appointment_category}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                          {appt.is_spay && <span className="badge" style={{ background: "#d1e7dd", color: "#0f5132", fontSize: "0.7rem" }}>Spay</span>}
                          {appt.is_neuter && <span className="badge" style={{ background: "#d1e7dd", color: "#0f5132", fontSize: "0.7rem" }}>Neuter</span>}
                          {appt.vaccines?.map((v, i) => <span key={i} className="badge" style={{ background: "#d1e7dd", color: "#0f5132", fontSize: "0.7rem" }}>{v}</span>)}
                          {appt.treatments?.map((t, i) => <span key={i} className="badge" style={{ background: "#cfe2ff", color: "#084298", fontSize: "0.7rem" }}>{t}</span>)}
                        </div>
                      </td>
                      <td>{appt.vet_name || "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No appointments recorded.</p>
          )}
        </div>

        {/* Clinic History */}
        {((cat.enhanced_clinic_history && cat.enhanced_clinic_history.length > 0) || (cat.clinic_history && cat.clinic_history.length > 0)) && (
          <div>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>Clinic History</h3>
            <div className="table-container">
              <table>
                <thead><tr><th>Date</th><th>Contact</th><th>Origin Address</th><th>Source</th></tr></thead>
                <tbody>
                  {(cat.enhanced_clinic_history || cat.clinic_history || []).map((appt, idx) => (
                    <tr key={idx}>
                      <td>{formatDateLocal(appt.appointment_date)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{appt.client_name || "\u2014"}</div>
                        {appt.client_email && <div className="text-muted text-sm">{appt.client_email}</div>}
                        {appt.client_phone && <div className="text-muted text-sm">{formatPhone(appt.client_phone)}</div>}
                      </td>
                      <td>
                        {"origin_address" in appt && appt.origin_address ? (
                          <a href="#" style={{ color: "var(--primary)", textDecoration: "none" }}>{appt.origin_address}</a>
                        ) : appt.client_address ? appt.client_address : <span className="text-muted">{"\u2014"}</span>}
                      </td>
                      <td>
                        {"partner_org_short" in appt && appt.partner_org_short ? (
                          <span className="badge" style={{ background: appt.partner_org_short === "SCAS" ? "#0d6efd" : "#198754", color: "#fff", fontSize: "0.7rem" }}>{appt.partner_org_short}</span>
                        ) : <span className="text-muted">Direct</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── Lifecycle ── */}
      <Section title="Lifecycle">
        {/* Birth Info */}
        {cat.birth_event && (
          <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "var(--success-bg)", border: "1px solid var(--success-border)", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Birth Information</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Birth Date</div>
                <div style={{ fontWeight: 500 }}>{cat.birth_event.birth_date ? formatDateLocal(cat.birth_event.birth_date) : "Unknown"}</div>
              </div>
              {cat.birth_event.mother_cat_id && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Mother</div>
                  <a href={`/cats/${cat.birth_event.mother_cat_id}`} style={{ fontWeight: 500, color: "var(--primary)" }} onClick={preview.handleClick("cat", cat.birth_event.mother_cat_id)}>{cat.birth_event.mother_name || "Unknown"}</a>
                </div>
              )}
              {cat.birth_event.kitten_count_in_litter && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Litter Size</div>
                  <div style={{ fontWeight: 500 }}>{cat.birth_event.kitten_count_in_litter} kittens</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mortality */}
        {cat.is_deceased && cat.mortality_event && (
          <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600, color: "#dc2626" }}>Mortality Record</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Cause</div>
                <div style={{ fontWeight: 500, textTransform: "capitalize" }}>{cat.mortality_event.death_cause}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Date</div>
                <div style={{ fontWeight: 500 }}>{cat.mortality_event.death_date ? formatDateLocal(cat.mortality_event.death_date) : "Unknown"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Age Category</div>
                <div style={{ fontWeight: 500, textTransform: "capitalize" }}>{cat.mortality_event.death_age_category}</div>
              </div>
            </div>
          </div>
        )}

        {/* Timeline link */}
        <LifecycleTimeline catId={cat.cat_id} currentStatus={cat.current_status} lastEventType={cat.last_event_type} lastEventAt={cat.last_event_at} />

        {/* Clinical Notes */}
        {data.clinicalNotes && data.clinicalNotes.notes.length > 0 && (() => {
          const encounters = new Map<string, ClinicalNote[]>();
          for (const note of data.clinicalNotes!.notes) {
            const key = note.appointment_date ?? "Unknown date";
            if (!encounters.has(key)) encounters.set(key, []);
            encounters.get(key)!.push(note);
          }
          const sortedEncounters = [...encounters.entries()].sort(([a], [b]) => b.localeCompare(a));

          return (
            <div style={{ marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.25rem" }}>Clinical Notes</h3>
              <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>Notes from ClinicHQ records grouped by appointment</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {sortedEncounters.map(([date, notes], encounterIdx) => {
                  const hasMedical = notes.some(n => n.note_type === "medical");
                  const appointmentType = notes[0]?.appointment_type ?? "Visit";
                  return <EncounterAccordion key={date} date={date} appointmentType={appointmentType} notes={notes} hasMedical={hasMedical} defaultOpen={encounterIdx === 0} />;
                })}
              </div>
            </div>
          );
        })()}
      </Section>
    </>
  );
}
