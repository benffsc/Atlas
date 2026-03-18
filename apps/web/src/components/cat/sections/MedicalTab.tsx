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
      {/* Reproduction Status (female only) */}
      {cat.sex === "female" && cat.vitals && cat.vitals.length > 0 && (() => {
        const reproVitals = cat.vitals.filter(v => v.is_pregnant || v.is_lactating || v.is_in_heat);
        if (reproVitals.length === 0) return null;
        const latestRepro = reproVitals[0];
        return (
          <Section title="Reproduction Status">
            <div>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                {latestRepro?.is_pregnant && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: "#fdf2f8", border: "2px solid #ec4899", borderRadius: "8px" }}>
                    <span style={{ fontSize: "1.5rem" }}>{"\uD83E\uDD30"}</span>
                    <div><div style={{ fontWeight: 600, color: "#ec4899" }}>Pregnant</div><div className="text-muted text-sm">{formatDateLocal(latestRepro.recorded_at)}</div></div>
                  </div>
                )}
                {latestRepro?.is_lactating && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: "#f5f3ff", border: "2px solid #8b5cf6", borderRadius: "8px" }}>
                    <span style={{ fontSize: "1.5rem" }}>{"\uD83C\uDF7C"}</span>
                    <div><div style={{ fontWeight: 600, color: "#8b5cf6" }}>Lactating</div><div className="text-muted text-sm">{formatDateLocal(latestRepro.recorded_at)}</div></div>
                  </div>
                )}
                {latestRepro?.is_in_heat && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: "#fff7ed", border: "2px solid #f97316", borderRadius: "8px" }}>
                    <span style={{ fontSize: "1.5rem" }}>{"\uD83D\uDD25"}</span>
                    <div><div style={{ fontWeight: 600, color: "#f97316" }}>In Heat</div><div className="text-muted text-sm">{formatDateLocal(latestRepro.recorded_at)}</div></div>
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
          </Section>
        );
      })()}

      {/* Birth Information */}
      {cat.birth_event && (
        <Section title="Birth Information">
          <div style={{ padding: "1rem", background: "var(--success-bg)", border: "1px solid var(--success-border)", borderRadius: "8px" }}>
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
                  <div><a href={`/cats/${cat.birth_event.mother_cat_id}`} style={{ fontWeight: 500, color: "#0d6efd" }} onClick={preview.handleClick("cat", cat.birth_event.mother_cat_id)}>{cat.birth_event.mother_name || "Unknown"}</a></div>
                </div>
              )}
              {cat.birth_event.place_id && (
                <div>
                  <div className="text-muted text-sm">Birth Location</div>
                  <div><a href={`/places/${cat.birth_event.place_id}`} style={{ fontWeight: 500, color: "#0d6efd" }} onClick={preview.handleClick("place", cat.birth_event.place_id)}>{cat.birth_event.place_name || "Unknown"}</a></div>
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
              <div style={{ borderTop: "1px solid var(--success-border)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>Littermates ({cat.siblings.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {cat.siblings.map(sibling => (
                    <a key={sibling.cat_id} href={`/cats/${sibling.cat_id}`} onClick={preview.handleClick("cat", sibling.cat_id)}
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--background)", border: "1px solid var(--border-light)", borderRadius: "6px", textDecoration: "none", color: "inherit" }}>
                      <span style={{ fontSize: "1.25rem" }}>{"\uD83D\uDC31"}</span>
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
              <div style={{ borderTop: "1px solid var(--success-border)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Notes</div>
                <p style={{ margin: 0, fontSize: "0.9rem" }}>{cat.birth_event.notes}</p>
              </div>
            )}
            <p className="text-muted text-sm" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>Birth data used by Beacon for population modeling and litter tracking.</p>
          </div>
        </Section>
      )}

      {/* Mortality Record */}
      {cat.is_deceased && cat.mortality_event && (
        <Section title="Mortality Record">
          <div style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Cause of Death</div>
                <div style={{ fontWeight: 600, textTransform: "capitalize", color: "#dc2626" }}>{cat.mortality_event.death_cause}</div>
              </div>
              {cat.mortality_event.mortality_timing && cat.mortality_event.mortality_timing !== "unspecified" && (
                <div><div className="text-muted text-sm">Timing</div><div style={{ fontWeight: 500, textTransform: "capitalize" }}>{cat.mortality_event.mortality_timing.replace(/_/g, "-")}</div></div>
              )}
              {cat.mortality_event.mortality_cause_detail && cat.mortality_event.mortality_cause_detail !== "unknown" && (
                <div><div className="text-muted text-sm">Detailed Cause</div><div style={{ fontWeight: 500, textTransform: "capitalize" }}>{cat.mortality_event.mortality_cause_detail.replace(/_/g, " ")}</div></div>
              )}
              <div><div className="text-muted text-sm">Age Category</div><div style={{ fontWeight: 500, textTransform: "capitalize" }}>{cat.mortality_event.death_age_category}</div></div>
              <div><div className="text-muted text-sm">Date of Death</div><div style={{ fontWeight: 500 }}>{cat.mortality_event.death_date ? formatDateLocal(cat.mortality_event.death_date) : cat.deceased_date ? formatDateLocal(cat.deceased_date) : "Unknown"}</div></div>
              <div><div className="text-muted text-sm">Recorded</div><div className="text-muted text-sm">{formatDateLocal(cat.mortality_event.created_at)}</div></div>
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

      {/* Latest Vitals */}
      {(data.latestTemp || data.latestWeight) && (
        <Section title="Latest Vitals">
          <div className="detail-grid">
            {data.latestTemp?.temperature_f && (
              <div className="detail-item"><span className="detail-label">Temperature</span><span className="detail-value">{data.latestTemp.temperature_f}&deg;F</span></div>
            )}
            {data.latestWeight?.weight_lbs && (
              <div className="detail-item"><span className="detail-label">Weight</span><span className="detail-value">{data.latestWeight.weight_lbs} lbs</span></div>
            )}
            <div className="detail-item"><span className="detail-label">Recorded</span><span className="detail-value">{formatDateLocal((data.latestTemp || data.latestWeight)?.recorded_at || "")}</span></div>
          </div>
        </Section>
      )}

      {/* Medical History */}
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
                        <td>{proc.performed_by || "\u2014"}</td>
                        <td>
                          {proc.complications && proc.complications.length > 0 && <span className="text-sm" style={{ color: "#dc3545" }}>{proc.complications.join(", ")}</span>}
                          {proc.post_op_notes && <span className="text-sm text-muted">{proc.complications?.length ? " | " : ""}{proc.post_op_notes}</span>}
                          {!proc.complications?.length && !proc.post_op_notes && "\u2014"}
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
                        <td className="text-muted">{test.result_detail || "\u2014"}</td>
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
                        <td>{cond.severity ? <span className="badge" style={{ background: cond.severity === "severe" ? "#dc3545" : cond.severity === "moderate" ? "#fd7e14" : cond.severity === "mild" ? "#ffc107" : "#6c757d", color: cond.severity === "mild" ? "#000" : "#fff" }}>{cond.severity}</span> : "\u2014"}</td>
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

      {/* Appointment History */}
      <Section title="Appointment History">
        {cat.appointments && cat.appointments.length > 0 ? (
          <div className="table-container">
            <table>
              <thead><tr><th style={{ width: "2.5rem", textAlign: "center" }} title="Clinic day number (from waiver)">Day #</th><th>Date</th><th>Type</th><th>Services</th><th>Vet</th></tr></thead>
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
                          autoFocus style={{ width: "2.5rem", textAlign: "center", border: "1px solid var(--border, #dee2e6)", borderRadius: "3px", fontSize: "0.8rem", padding: "0.1rem", background: "var(--bg-secondary, #fff)" }}
                          onClick={(e) => e.stopPropagation()} />
                      ) : appt.clinic_day_number != null ? (
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--accent, #0d6efd)" }}>{appt.clinic_day_number}</span>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted, #adb5bd)", cursor: "pointer" }} title="Set clinic day number">+</span>
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
                        {appt.is_spay && <span className="badge" style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", fontSize: "0.7rem" }}>Spay</span>}
                        {appt.is_neuter && <span className="badge" style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", fontSize: "0.7rem" }}>Neuter</span>}
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
          <p className="text-muted">No appointments recorded for this cat.</p>
        )}
      </Section>

      {/* Clinic History */}
      {((cat.enhanced_clinic_history && cat.enhanced_clinic_history.length > 0) || (cat.clinic_history && cat.clinic_history.length > 0)) && (
        <Section title="Clinic History">
          <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>Cat appointment records with origin address and source information</p>
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
                        <span style={{ fontWeight: 500, color: "#198754" }}>{appt.origin_address}</span>
                      ) : appt.client_address ? (
                        appt.client_address
                      ) : (
                        <span className="text-muted">{"\u2014"}</span>
                      )}
                    </td>
                    <td>
                      {"partner_org_short" in appt && appt.partner_org_short ? (
                        <span className="badge" style={{ background: appt.partner_org_short === "SCAS" ? "#0d6efd" : appt.partner_org_short === "FFSC" ? "#198754" : "#6c757d", color: "#fff", fontSize: "0.7rem" }} title={`Cat came from ${appt.partner_org_short}`}>
                          {appt.partner_org_short}
                        </span>
                      ) : appt.ownership_type ? (
                        <span className="badge" style={{ background: appt.ownership_type.includes("Feral") ? "#6c757d" : "#0d6efd", color: "#fff", fontSize: "0.7rem" }}>{appt.ownership_type}</span>
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

      {/* ShelterLuv Bio */}
      {cat.description && (
        <Section title="Bio">
          <blockquote style={{ margin: 0, padding: "0.75rem 1rem", borderLeft: "3px solid var(--primary)", background: "var(--section-bg)", borderRadius: "0 6px 6px 0", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {cat.description}
          </blockquote>
          <div className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>From ShelterLuv</div>
        </Section>
      )}

      {/* Lifecycle Timeline */}
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
          <Section title={`Clinical Notes (${sortedEncounters.length} visit${sortedEncounters.length !== 1 ? "s" : ""})`}>
            <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>Notes from ClinicHQ records grouped by appointment</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {sortedEncounters.map(([date, notes], encounterIdx) => {
                const hasMedical = notes.some(n => n.note_type === "medical");
                const appointmentType = notes[0]?.appointment_type ?? "Visit";
                return <EncounterAccordion key={date} date={date} appointmentType={appointmentType} notes={notes} hasMedical={hasMedical} defaultOpen={encounterIdx === 0} />;
              })}
            </div>
          </Section>
        );
      })()}
    </>
  );
}
