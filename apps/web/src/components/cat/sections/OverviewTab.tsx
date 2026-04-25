"use client";

import { Section } from "@/components/layouts";
import { JournalSection } from "@/components/sections";
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
      {/* Record Info + Identifiers — side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Record Info (Metadata) */}
        <Section title="Record Info (Metadata)">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {cat.primary_origin_place && (
              <>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Origin Address</div>
                  <div style={{ fontWeight: 500 }}>
                    <a href={`/places/${cat.primary_origin_place.place_id}`} style={{ color: "var(--primary)", textDecoration: "none" }} onClick={preview.handleClick("place", cat.primary_origin_place.place_id)}>
                      {cat.primary_origin_place.formatted_address}
                    </a>
                  </div>
                </div>
              </>
            )}
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Data Source</div>
              <div style={{ fontWeight: 500 }}>
                {cat.data_source === "clinichq" ? "ClinicHQ" : cat.data_source === "petlink" ? "PetLink" : cat.data_source || "Unknown"}
              </div>
            </div>
            {cat.total_appointments > 0 && (
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Total Appointments</div>
                <div style={{ fontWeight: 500 }}>{cat.total_appointments}</div>
              </div>
            )}
            {cat.first_appointment_date && (
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>First Appt</div>
                <div style={{ fontWeight: 500 }}>{formatDateLocal(cat.first_appointment_date)}</div>
              </div>
            )}
            {cat.last_appointment_date && (
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Last Appt</div>
                <div style={{ fontWeight: 500 }}>{formatDateLocal(cat.last_appointment_date)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Created</div>
              <div style={{ fontWeight: 500 }}>{formatDateLocal(cat.created_at)}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Updated</div>
              <div style={{ fontWeight: 500 }}>{formatDateLocal(cat.updated_at)}</div>
            </div>
          </div>
        </Section>

        {/* Identifiers */}
        {cat.identifiers && cat.identifiers.length > 0 && (
          <Section title="Identifiers">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {cat.identifiers.map((ident, idx) => (
                <div key={idx} style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--bg-secondary)",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  fontSize: "0.85rem",
                }}>
                  <strong>{ident.type}:</strong>{" "}
                  <code style={{ fontSize: "0.85rem" }}>{ident.value}</code>
                  {ident.source && <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>({ident.source})</span>}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Journal */}
      <Section title="Journal">
        <JournalSection entries={data.journal} entityType="cat" entityId={cat.cat_id} onEntryAdded={data.fetchJournal} />
      </Section>
    </>
  );
}
