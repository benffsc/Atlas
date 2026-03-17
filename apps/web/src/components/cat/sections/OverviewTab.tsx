"use client";

import { Section } from "@/components/layouts";
import { QuickNotes } from "@/components/common";
import { JournalSection } from "@/components/sections";
import { VerificationBadge, LastVerified } from "@/components/badges";
import { formatDateLocal } from "@/lib/formatters";
import type { CatDetailData } from "@/lib/cat-types";
import type { EntityType } from "@/hooks/useEntityDetail";

interface OverviewTabProps {
  data: CatDetailData;
  preview: { handleClick: (type: EntityType, id: string) => (e: React.MouseEvent) => void };
}

export function OverviewTab({ data, preview }: OverviewTabProps) {
  const cat = data.cat!;

  return (
    <>
      {/* Staff Quick Notes */}
      <QuickNotes
        entityType="cat"
        entityId={cat.cat_id}
        entries={data.journal}
        onNoteAdded={data.fetchJournal}
      />

      {/* Origin Information */}
      {(cat.primary_origin_place || (cat.partner_orgs && cat.partner_orgs.length > 0)) && (
        <Section title="Origin Information">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            {cat.primary_origin_place && (
              <div>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Origin Address</div>
                <div style={{ fontWeight: 500 }}>
                  <a href={`/places/${cat.primary_origin_place.place_id}`} style={{ color: "#0d6efd", textDecoration: "none" }} onClick={preview.handleClick("place", cat.primary_origin_place.place_id)}>
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
                    <span key={org.org_id} className="badge"
                      style={{
                        background: org.org_name_short === "SCAS" ? "#0d6efd" : org.org_name_short === "FFSC" ? "#198754" : "#6c757d",
                        color: "#fff", fontSize: "0.8rem", padding: "0.35rem 0.75rem",
                      }}
                      title={`${org.org_name} - First seen: ${formatDateLocal(org.first_seen)}, ${org.appointment_count} appointments`}>
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

      {/* Medical Overview */}
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

      {/* Medical Summary */}
      {(cat.tests?.length > 0 || cat.procedures?.length > 0 || cat.conditions?.length > 0) && (
        <Section title="Medical Summary">
          <div className="detail-grid">
            {data.felvFivStatus.hasAnyTest && (
              <div className="detail-item">
                <span className="detail-label">FeLV/FIV Status</span>
                <span className="detail-value">
                  {data.felvFivStatus.felvResult && (
                    <span className="badge" style={{ background: data.felvFivStatus.felvResult === "negative" ? "#198754" : data.felvFivStatus.felvResult === "positive" ? "#dc3545" : "#ffc107", color: data.felvFivStatus.felvResult === "positive" || data.felvFivStatus.felvResult === "negative" ? "#fff" : "#000", marginRight: "0.25rem" }}>
                      FeLV: {data.felvFivStatus.felvResult.toUpperCase()}
                    </span>
                  )}
                  {data.felvFivStatus.fivResult && (
                    <span className="badge" style={{ background: data.felvFivStatus.fivResult === "negative" ? "#198754" : data.felvFivStatus.fivResult === "positive" ? "#dc3545" : "#ffc107", color: data.felvFivStatus.fivResult === "positive" || data.felvFivStatus.fivResult === "negative" ? "#fff" : "#000" }}>
                      FIV: {data.felvFivStatus.fivResult.toUpperCase()}
                    </span>
                  )}
                  {data.felvFivStatus.testDate && (
                    <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>({formatDateLocal(data.felvFivStatus.testDate)})</span>
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
                  {cat.vitals[0].temperature_f}&deg;F
                  <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>({formatDateLocal(cat.vitals[0].recorded_at)})</span>
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Identifiers */}
      {cat.identifiers && cat.identifiers.length > 0 && (
        <Section title="Identifiers">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {cat.identifiers.map((ident, idx) => (
              <div key={idx} className="identifier-badge">
                <strong>{ident.type}:</strong>{" "}
                <code>{ident.value}</code>
                {ident.source && <span className="text-muted" style={{ marginLeft: "0.5rem" }}>({ident.source})</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Journal */}
      <Section title="Journal">
        <JournalSection entries={data.journal} entityType="cat" entityId={cat.cat_id} onEntryAdded={data.fetchJournal} />
      </Section>

      {/* Metadata */}
      <Section title="Metadata">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Data Source</span>
            <span className="detail-value">
              {cat.data_source === "clinichq" ? "ClinicHQ" : cat.data_source === "petlink" ? "PetLink (microchip only)" : cat.data_source === "legacy_import" ? "Legacy Import" : cat.data_source || "Unknown"}
            </span>
          </div>
          {cat.first_appointment_date && (
            <div className="detail-item"><span className="detail-label">First Appointment</span><span className="detail-value">{formatDateLocal(cat.first_appointment_date)}</span></div>
          )}
          {cat.last_appointment_date && (
            <div className="detail-item"><span className="detail-label">Last Appointment</span><span className="detail-value">{formatDateLocal(cat.last_appointment_date)}</span></div>
          )}
          {cat.total_appointments > 0 && (
            <div className="detail-item"><span className="detail-label">Total Appointments</span><span className="detail-value">{cat.total_appointments}</span></div>
          )}
          <div className="detail-item"><span className="detail-label">Atlas Created</span><span className="detail-value">{formatDateLocal(cat.created_at)}</span></div>
          <div className="detail-item"><span className="detail-label">Last Updated</span><span className="detail-value">{formatDateLocal(cat.updated_at)}</span></div>
          <div className="detail-item">
            <span className="detail-label">Verification</span>
            <span className="detail-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <VerificationBadge table="cats" recordId={cat.cat_id} verifiedAt={cat.verified_at} verifiedBy={cat.verified_by_name} onVerify={() => data.fetchCat()} />
              {cat.verified_at && <LastVerified verifiedAt={cat.verified_at} verifiedBy={cat.verified_by_name} />}
            </span>
          </div>
        </div>
      </Section>
    </>
  );
}
