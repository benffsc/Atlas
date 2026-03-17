"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { formatPhone, formatDateLocal } from "@/lib/formatters";
import type { RequestDetail } from "@/hooks/useEntityDetail";

interface RequestPreviewContentProps {
  request: RequestDetail;
  onClose: () => void;
}

/**
 * Rich request preview panel for the split-view on the requests list page.
 * Shows contact info, colony stats, trapping logistics, and action-relevant data
 * so staff can triage without opening the full page.
 */
export function RequestPreviewContent({ request: r, onClose }: RequestPreviewContentProps) {
  const createdDate = new Date(r.created_at);
  const endDate = r.resolved_at ? new Date(r.resolved_at) : new Date();
  const daysOpen = Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));

  const altRate = r.colony_alteration_rate != null ? `${Math.round(r.colony_alteration_rate * 100)}%` : null;

  const stats = [
    { label: "Est. Cats", value: r.estimated_cat_count ?? "\u2014" },
    { label: "Linked Cats", value: r.linked_cat_count ?? 0 },
    { label: "Peak Count", value: r.peak_count ?? "\u2014" },
    { label: r.resolved_at ? "Duration" : "Days Open", value: `${daysOpen}d`, color: !r.resolved_at && daysOpen > 30 ? "#dc2626" : undefined },
    ...(altRate ? [{ label: "TNR Coverage", value: altRate, color: r.colony_alteration_rate! >= 0.7 ? "#16a34a" : r.colony_alteration_rate! >= 0.3 ? "#d97706" : "#dc2626" }] : []),
    ...(r.eartip_count != null ? [{ label: "Eartipped", value: r.eartip_count }] : []),
  ];

  const badges = (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexWrap: "wrap" }}>
      <StatusBadge status={r.status} />
      {r.priority && <PriorityBadge priority={r.priority} />}
      {r.is_emergency && <span className="badge" style={{ background: "#dc2626", color: "#fff", fontSize: "0.65rem" }}>EMERGENCY</span>}
      {r.has_kittens && <span className="badge" style={{ background: "#f59e0b", color: "#000", fontSize: "0.65rem" }}>KITTENS</span>}
      {r.has_medical_concerns && <span className="badge" style={{ background: "#dc2626", color: "#fff", fontSize: "0.65rem" }}>MEDICAL</span>}
    </div>
  );

  const contact = {
    phone: r.requester_phone || r.site_contact_phone || null,
    email: r.requester_email || r.site_contact_email || null,
  };

  const sections = [];

  // Notes (the most important thing for triage)
  if (r.notes) {
    sections.push({
      id: "notes",
      title: "Notes",
      content: (
        <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--foreground)" }}>
          {r.notes.length > 300 ? r.notes.slice(0, 300) + "\u2026" : r.notes}
        </p>
      ),
    });
  }

  // Contact & People
  sections.push({
    id: "contact",
    title: "Contact",
    content: (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
        {r.requester_name && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>{r.requester_name}</span>
              {r.requester_role_at_submission && r.requester_role_at_submission !== "unknown" && (
                <span className="badge" style={{ fontSize: "0.6rem", background: r.requester_role_at_submission.includes("trapper") ? "#fef3c7" : "#e0e7ff", color: r.requester_role_at_submission.includes("trapper") ? "#92400e" : "#3730a3" }}>
                  {r.requester_role_at_submission.replace(/_/g, " ").toUpperCase()}
                </span>
              )}
              {r.requester_is_site_contact && <span className="badge" style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534" }}>Site Contact</span>}
            </div>
            {r.requester_phone && <div><a href={`tel:${r.requester_phone}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{formatPhone(r.requester_phone)}</a></div>}
            {r.requester_email && <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>{r.requester_email}</div>}
          </div>
        )}
        {r.site_contact_name && !r.requester_is_site_contact && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>{r.site_contact_name}</span>
              <span className="badge" style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534" }}>Site Contact</span>
            </div>
            {r.site_contact_phone && <div><a href={`tel:${r.site_contact_phone}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{formatPhone(r.site_contact_phone)}</a></div>}
            {r.site_contact_email && <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>{r.site_contact_email}</div>}
          </div>
        )}
        {!r.site_contact_name && !r.requester_is_site_contact && r.requester_role_at_submission?.includes("trapper") && (
          <div style={{ color: "#92400e", fontSize: "0.8rem", fontWeight: 500 }}>Site contact needed</div>
        )}
      </div>
    ),
  });

  // Location
  sections.push({
    id: "location",
    title: "Location",
    content: (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
        {r.place_name && <div style={{ fontWeight: 600 }}>{r.place_name}</div>}
        {r.place_address && <div style={{ color: "var(--text-secondary)" }}>{r.place_address}</div>}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {r.place_kind && r.place_kind !== "unknown" && <span className="badge" style={{ fontSize: "0.65rem", background: "#f3f4f6", color: "#374151" }}>{r.place_kind.replace(/_/g, " ")}</span>}
          {r.place_service_zone && <span className="badge" style={{ fontSize: "0.65rem", background: "#dbeafe", color: "#1d4ed8" }}>Zone: {r.place_service_zone}</span>}
          {r.place_city && <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{r.place_city}</span>}
        </div>
        {r.place_coordinates && (
          <a href={`/map?lat=${r.place_coordinates.lat}&lng=${r.place_coordinates.lng}&zoom=17`}
            style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}>
            View on Map
          </a>
        )}
      </div>
    ),
  });

  // Colony Assessment
  if (r.colony_size_estimate != null || r.colony_duration || r.handleability || r.count_confidence) {
    sections.push({
      id: "colony",
      title: "Colony Assessment",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
          {r.colony_size_estimate != null && <FieldCell label="Colony Size" value={String(r.colony_size_estimate)} />}
          {r.colony_verified_altered != null && <FieldCell label="Altered" value={String(r.colony_verified_altered)} />}
          {r.colony_work_remaining != null && <FieldCell label="Remaining" value={String(r.colony_work_remaining)} highlight={r.colony_work_remaining > 0} />}
          {altRate && <FieldCell label="Coverage" value={altRate} />}
          {r.handleability && <FieldCell label="Handleability" value={r.handleability.replace(/_/g, " ")} />}
          {r.count_confidence && <FieldCell label="Count Confidence" value={r.count_confidence.replace(/_/g, " ")} />}
          {r.colony_duration && <FieldCell label="Colony Duration" value={r.colony_duration.replace(/_/g, " ")} />}
          {r.awareness_duration && <FieldCell label="Awareness" value={r.awareness_duration.replace(/_/g, " ")} />}
          {r.cats_are_friendly != null && <FieldCell label="Cats Friendly" value={r.cats_are_friendly ? "Yes" : "No"} />}
        </div>
      ),
    });
  }

  // Trapping Logistics
  const hasTrappingInfo = r.dogs_on_site || r.trap_savvy || r.previous_tnr || r.traps_overnight_safe != null || r.permission_status || r.best_times_seen;
  if (hasTrappingInfo) {
    sections.push({
      id: "trapping",
      title: "Trapping Logistics",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
          {r.dogs_on_site && <FieldCell label="Dogs on Site" value={r.dogs_on_site} highlight={r.dogs_on_site.toLowerCase() === "yes"} />}
          {r.trap_savvy && <FieldCell label="Trap-Savvy" value={r.trap_savvy} highlight={r.trap_savvy.toLowerCase() === "yes"} />}
          {r.previous_tnr && <FieldCell label="Previous TNR" value={r.previous_tnr} />}
          {r.traps_overnight_safe != null && <FieldCell label="Traps Overnight" value={r.traps_overnight_safe ? "Yes" : "No"} good={r.traps_overnight_safe} />}
          {r.permission_status && <FieldCell label="Permission" value={r.permission_status.replace(/_/g, " ")} />}
          {r.property_type && <FieldCell label="Property Type" value={r.property_type.replace(/_/g, " ")} />}
          {r.best_times_seen && <FieldCell label="Best Times Seen" value={r.best_times_seen} />}
          {r.best_trapping_time && <FieldCell label="Best Trap Time" value={r.best_trapping_time} />}
        </div>
      ),
    });
  }

  // Feeding
  if (r.is_being_fed != null || r.feeder_name) {
    sections.push({
      id: "feeding",
      title: "Feeding",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
          <FieldCell label="Being Fed" value={r.is_being_fed ? "Yes" : r.is_being_fed === false ? "No" : "\u2014"} good={r.is_being_fed ?? undefined} />
          {r.feeder_name && <FieldCell label="Feeder" value={r.feeder_name} />}
          {r.feeding_frequency && <FieldCell label="Frequency" value={r.feeding_frequency.replace(/_/g, " ")} />}
          {r.feeding_time && <FieldCell label="Time" value={r.feeding_time} />}
          {r.feeding_location && <FieldCell label="Location" value={r.feeding_location} />}
        </div>
      ),
    });
  }

  // Urgency
  if (r.is_emergency || (r.urgency_reasons && r.urgency_reasons.length > 0) || r.urgency_notes || r.medical_description) {
    sections.push({
      id: "urgency",
      title: "Urgency & Medical",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {r.urgency_reasons && r.urgency_reasons.length > 0 && (
            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
              {r.urgency_reasons.map((reason, i) => (
                <span key={i} className="badge" style={{ fontSize: "0.65rem", background: "#fef2f2", color: "#dc2626" }}>{reason.replace(/_/g, " ")}</span>
              ))}
            </div>
          )}
          {r.urgency_notes && <p style={{ margin: 0, color: "var(--text-secondary)" }}>{r.urgency_notes}</p>}
          {r.medical_description && <p style={{ margin: 0, color: "#dc2626" }}>{r.medical_description}</p>}
        </div>
      ),
    });
  }

  // Assigned Trappers
  if (r.current_trappers && r.current_trappers.length > 0) {
    sections.push({
      id: "trappers",
      title: "Assigned Trappers",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {r.current_trappers.map((t) => (
            <div key={t.trapper_person_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <a href={`/trappers/${t.trapper_person_id}`} style={{ fontWeight: 500, color: "var(--primary)", textDecoration: "none" }}>{t.trapper_name}</a>
              {t.is_primary && <span className="badge" style={{ fontSize: "0.6rem", background: "#dbeafe", color: "#1d4ed8" }}>Primary</span>}
              {t.is_ffsc_trapper && <span className="badge" style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534" }}>FFSC</span>}
            </div>
          ))}
        </div>
      ),
    });
  } else if (r.primary_trapper_name) {
    sections.push({
      id: "trappers",
      title: "Trapper",
      content: <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{r.primary_trapper_name}</div>,
    });
  }

  // Linked Cats
  if (r.cats && r.cats.length > 0) {
    sections.push({
      id: "cats",
      title: `Linked Cats (${r.cats.length})`,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
          {r.cats.slice(0, 6).map((cat) => (
            <div key={cat.cat_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <a href={`/cats/${cat.cat_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{cat.cat_name || "Unnamed"}</a>
              {cat.altered_status && (
                <span className="badge" style={{ fontSize: "0.6rem", background: cat.altered_status.toLowerCase() === "yes" || cat.altered_status.toLowerCase() === "spayed" || cat.altered_status.toLowerCase() === "neutered" ? "#dcfce7" : "#fef2f2", color: cat.altered_status.toLowerCase() === "yes" || cat.altered_status.toLowerCase() === "spayed" || cat.altered_status.toLowerCase() === "neutered" ? "#166534" : "#dc2626" }}>
                  {cat.altered_status}
                </span>
              )}
              {cat.microchip && <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{cat.microchip.slice(-6)}</span>}
            </div>
          ))}
          {r.cats.length > 6 && <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>+{r.cats.length - 6} more...</span>}
        </div>
      ),
    });
  }

  // Record info (compact)
  sections.push({
    id: "record",
    title: "Record",
    content: (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
        <div>Created: {formatDateLocal(r.created_at)}</div>
        {r.resolved_at && <div>Resolved: {formatDateLocal(r.resolved_at)}</div>}
        <div>Assignment: {(r.assignment_status || "pending").replace(/_/g, " ")}</div>
      </div>
    ),
  });

  return (
    <EntityPreviewPanel
      title={r.summary || r.place_name || "Request"}
      detailHref={`/requests/${r.request_id}`}
      onClose={onClose}
      badges={badges}
      stats={stats}
      contact={contact}
      sections={sections}
    />
  );
}

// --- Sub-components ---

function FieldCell({ label, value, highlight, good }: { label: string; value: string; highlight?: boolean; good?: boolean }) {
  const valueColor = good === true ? "#16a34a" : good === false ? "#dc2626" : highlight ? "#d97706" : undefined;
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>{label}</div>
      <div style={{ fontWeight: 500, color: valueColor }}>{value}</div>
    </div>
  );
}
