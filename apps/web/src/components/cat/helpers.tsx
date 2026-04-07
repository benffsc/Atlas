"use client";

import { useState } from "react";
import type { FieldSourceValue, ClinicalNote } from "@/lib/cat-types";
import { formatDateLocal } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";

// Source display names
const SOURCE_LABELS: Record<string, string> = {
  clinichq: "ClinicHQ",
  shelterluv: "ShelterLuv",
  petlink: "PetLink",
  airtable: "Airtable",
  web_intake: "Web Intake",
  atlas_ui: "Beacon",
  legacy_import: "Legacy",
};

const getSourceLabel = (source: string) => SOURCE_LABELS[source] || source;

/**
 * Medical chart condition/status indicator.
 * positive=true means "yes" is good (like spayed/neutered)
 * positive=false means "yes" is bad (like has disease)
 */
export function ConditionCheck({
  label,
  status,
  date,
  severity,
  positive = false,
}: {
  label: string;
  status: "yes" | "no" | "unknown";
  date?: string;
  severity?: string;
  positive?: boolean;
}) {
  const isGood = positive ? status === "yes" : status === "no";
  const isBad = positive ? status === "no" : status === "yes";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        marginBottom: "0.25rem",
        background: isBad
          ? "var(--danger-bg)"
          : isGood
            ? "var(--success-bg)"
            : "var(--section-bg)",
        borderRadius: "6px",
        border: `1px solid ${isBad ? "var(--danger-border)" : isGood ? "var(--success-border)" : "var(--border)"}`,
        color: isBad
          ? "var(--danger-text)"
          : isGood
            ? "var(--success-text)"
            : "var(--foreground)",
      }}
    >
      <span
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          fontWeight: "bold",
          background: isBad ? "#dc3545" : isGood ? "#198754" : "var(--muted)",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {isBad ? "\u2717" : isGood ? "\u2713" : "?"}
      </span>
      <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
      {severity && (
        <span
          className="badge"
          style={{
            background:
              severity === "severe"
                ? "#dc3545"
                : severity === "moderate"
                  ? "#fd7e14"
                  : "#ffc107",
            color: severity === "mild" ? "#000" : "#fff",
            fontSize: "0.7rem",
          }}
        >
          {severity}
        </span>
      )}
      {date && (
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {date}
        </span>
      )}
    </div>
  );
}

/**
 * Multi-source field display — shows primary value with source and alternate values.
 */
export function MultiSourceField({
  label,
  fieldName,
  primaryValue,
  fieldSources,
  formatValue,
}: {
  label: string;
  fieldName: string;
  primaryValue: string | null;
  fieldSources: Record<string, FieldSourceValue[]> | null;
  formatValue?: (val: string) => string;
}) {
  const sources = fieldSources?.[fieldName] || [];
  const currentSource = sources.find((s) => s.is_current);
  const alternateSources = sources.filter(
    (s) => !s.is_current && s.value !== currentSource?.value
  );
  const format = formatValue || ((v: string) => v);

  if (sources.length === 0) {
    return (
      <div>
        <div className="text-muted text-sm">{label}</div>
        <div style={{ fontWeight: 500 }}>{primaryValue || "Unknown"}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-muted text-sm">{label}</div>
      <div
        style={{
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span>
          {format(currentSource?.value || primaryValue || "Unknown")}
        </span>
        {currentSource && (
          <span
            className="badge"
            style={{
              background:
                currentSource.source === "clinichq"
                  ? "#198754"
                  : currentSource.source === "shelterluv"
                    ? "#0d6efd"
                    : "#6c757d",
              color: "#fff",
              fontSize: "0.6rem",
              padding: "0.15rem 0.4rem",
            }}
            title={`From ${getSourceLabel(currentSource.source)}`}
          >
            {getSourceLabel(currentSource.source)}
          </span>
        )}
      </div>
      {alternateSources.length > 0 && (
        <div style={{ marginTop: "0.25rem" }}>
          {alternateSources.map((alt, idx) => (
            <div
              key={idx}
              className="text-muted"
              style={{
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              <span style={{ color: "#6c757d" }}>Also:</span>
              <span style={{ fontStyle: "italic" }}>
                &ldquo;{format(alt.value)}&rdquo;
              </span>
              <span style={{ color: "#6c757d" }}>
                ({getSourceLabel(alt.source)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible encounter row for clinical notes timeline.
 */
export function EncounterAccordion({
  date,
  appointmentType,
  notes,
  hasMedical,
  defaultOpen = false,
}: {
  date: string;
  appointmentType: string;
  notes: ClinicalNote[];
  hasMedical: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const borderColor = hasMedical ? "#0284c7" : "var(--muted)";
  const preview =
    notes[0]?.content.slice(0, 80) +
    (notes[0]?.content.length > 80 ? "\u2026" : "");

  return (
    <div
      style={{
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: "0 4px 4px 0",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "var(--section-bg)",
          border: "none",
          borderBottom: open ? "1px solid var(--border)" : "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--foreground)",
          borderRadius: open ? "0 4px 0 0" : "0 4px 4px 0",
        }}
      >
        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--muted)",
            minWidth: "100px",
            flexShrink: 0,
          }}
        >
          {date}
        </span>
        <span style={{ fontWeight: 500, fontSize: "0.85rem", flexShrink: 0 }}>
          {appointmentType}
        </span>
        {!open && (
          <span
            style={{
              fontSize: "0.8rem",
              color: "var(--muted)",
              flex: 1,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {preview}
          </span>
        )}
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--muted)",
            flexShrink: 0,
            marginLeft: "auto",
          }}
        >
          {notes.length} note{notes.length !== 1 ? "s" : ""}{" "}
          {open ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            background: "var(--section-bg)",
            borderRadius: "0 0 4px 0",
          }}
        >
          {notes.map((note, idx) => (
            <div
              key={idx}
              style={{
                borderLeft: `3px solid ${
                  note.note_type === "medical"
                    ? "#0284c7"
                    : note.note_type === "quick"
                      ? "#7c3aed"
                      : "#9ca3af"
                }`,
                paddingLeft: "0.75rem",
                paddingTop: "0.25rem",
                paddingBottom: "0.25rem",
              }}
            >
              <span
                className="badge"
                style={{
                  background:
                    note.note_type === "medical"
                      ? "#0284c7"
                      : note.note_type === "quick"
                        ? "#7c3aed"
                        : "#6b7280",
                  color: "#fff",
                  fontSize: "0.7rem",
                  textTransform: "uppercase",
                  marginBottom: "0.25rem",
                  display: "inline-block",
                }}
              >
                {note.note_type === "quick"
                  ? "staff notes"
                  : note.note_type === "appointment"
                    ? "visit notes"
                    : "medical"}
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.875rem",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                  fontFamily:
                    note.note_type === "medical"
                      ? "var(--font-mono, monospace)"
                      : "inherit",
                  color: "var(--foreground)",
                }}
              >
                {note.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Lifecycle timeline component.
 */
interface LifecycleEvent {
  event_id: string;
  event_type: string;
  event_subtype: string | null;
  event_at: string;
  metadata: Record<string, unknown> | null;
  person_name: string | null;
  place_name: string | null;
  source_system: string;
}

const EVENT_ICONS: Record<string, string> = {
  intake: "\uD83D\uDCE5",
  tnr_procedure: "\u2702\uFE0F",
  foster_start: "\uD83C\uDFE0",
  foster_end: "\u21A9\uFE0F",
  adoption: "\uD83D\uDC9A",
  return_to_field: "\uD83C\uDF3F",
  transfer: "\uD83D\uDD00",
  mortality: "\uD83D\uDD4A\uFE0F",
};

const EVENT_LABELS: Record<string, string> = {
  intake: "Intake",
  tnr_procedure: "TNR Procedure",
  foster_start: "Foster Start",
  foster_end: "Foster End",
  adoption: "Adoption",
  return_to_field: "Return to Field",
  transfer: "Transfer",
  mortality: "Mortality",
};

export function LifecycleTimeline({
  catId,
  currentStatus,
  lastEventType,
  lastEventAt,
}: {
  catId: string;
  currentStatus: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
}) {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!currentStatus && !lastEventType) return null;

  const fetchEvents = async () => {
    if (events.length > 0) {
      setExpanded(!expanded);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/cats/${catId}/lifecycle`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        setEvents(data.events || []);
        setExpanded(true);
      }
    } catch (err) {
      console.error("Failed to load lifecycle events:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="detail-section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2>Lifecycle</h2>
        <Button
          onClick={fetchEvents}
          loading={loading}
          variant="secondary"
          size="sm"
        >
          {expanded ? "Collapse" : "Show Timeline"}
        </Button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {currentStatus && currentStatus !== "unknown" && (
          <span
            className="badge"
            style={{
              background:
                currentStatus === "adopted"
                  ? "#dcfce7"
                  : currentStatus === "in_foster"
                    ? "#dbeafe"
                    : currentStatus === "tnr_complete"
                      ? "#ccfbf1"
                      : currentStatus === "community_cat"
                        ? "#fef3c7"
                        : currentStatus === "deceased"
                          ? "#f3f4f6"
                          : "#e5e7eb",
              color:
                currentStatus === "adopted"
                  ? "#166534"
                  : currentStatus === "in_foster"
                    ? "#1e40af"
                    : currentStatus === "tnr_complete"
                      ? "#115e59"
                      : currentStatus === "community_cat"
                        ? "#92400e"
                        : currentStatus === "deceased"
                          ? "#374151"
                          : "#374151",
              fontSize: "0.8rem",
              padding: "0.25rem 0.75rem",
            }}
          >
            {currentStatus
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        )}
        {lastEventAt && (
          <span className="text-muted text-sm">
            Last event: {formatDateLocal(lastEventAt)}
            {lastEventType
              ? ` (${EVENT_LABELS[lastEventType] || lastEventType})`
              : ""}
          </span>
        )}
      </div>

      {expanded && events.length > 0 && (
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {events.map((event) => (
            <div
              key={event.event_id}
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "flex-start",
                padding: "0.5rem 0.75rem",
                background: "var(--section-bg)",
                borderRadius: "6px",
                border: "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  fontSize: "1.2rem",
                  flexShrink: 0,
                  lineHeight: "1.5rem",
                }}
              >
                {EVENT_ICONS[event.event_type] || "\uD83D\uDCCB"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                    {EVENT_LABELS[event.event_type] || event.event_type}
                  </span>
                  {event.event_subtype && (
                    <span className="text-muted text-sm">
                      ({event.event_subtype.replace(/_/g, " ")})
                    </span>
                  )}
                  <span className="text-muted text-sm">
                    {formatDateLocal(event.event_at)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    marginTop: "0.25rem",
                  }}
                >
                  {event.person_name && (
                    <span
                      className="text-sm"
                      style={{ color: "var(--primary)" }}
                    >
                      {event.person_name}
                    </span>
                  )}
                  {event.place_name && (
                    <span className="text-muted text-sm">
                      {event.place_name}
                    </span>
                  )}
                  {event.event_type === "adoption" && event.metadata && (
                    <>
                      {event.metadata.fee_group && (
                        <span className="text-muted text-sm">Fee: {String(event.metadata.fee_group)}</span>
                      )}
                      {event.metadata.is_barn_cat && (
                        <span className="badge" style={{
                          fontSize: "0.6rem", padding: "0.1rem 0.4rem",
                          background: "var(--section-bg)", color: "var(--foreground)",
                          border: "1px solid var(--border)",
                        }}>Barn Cat</span>
                      )}
                    </>
                  )}
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.6rem",
                      padding: "0.1rem 0.4rem",
                      background:
                        event.source_system === "shelterluv"
                          ? "#0d6efd"
                          : event.source_system === "clinichq"
                            ? "#198754"
                            : "#6c757d",
                      color: "#fff",
                    }}
                  >
                    {event.source_system}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {expanded && events.length === 0 && !loading && (
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          No lifecycle events recorded.
        </p>
      )}
    </div>
  );
}

/**
 * Data source badge for cats.
 */
export function CatDataSourceBadge({
  dataSource,
}: {
  dataSource: string | null;
}) {
  if (dataSource === "clinichq") {
    return (
      <span
        className="badge"
        style={{ background: "#198754", color: "#fff", fontSize: "0.5em" }}
        title="This cat has been to the clinic - verified ClinicHQ patient"
      >
        ClinicHQ Patient
      </span>
    );
  }
  if (dataSource === "petlink") {
    return (
      <span
        className="badge"
        style={{ background: "#6c757d", color: "#fff", fontSize: "0.5em" }}
        title="PetLink microchip registration only - no clinic history"
      >
        PetLink Only
      </span>
    );
  }
  if (dataSource === "legacy_import") {
    return (
      <span
        className="badge"
        style={{ background: "#ffc107", color: "#000", fontSize: "0.5em" }}
        title="Imported from legacy system"
      >
        Legacy Import
      </span>
    );
  }
  return null;
}

/**
 * Ownership type badge.
 */
export function OwnershipTypeBadge({
  ownershipType,
}: {
  ownershipType: string | null;
}) {
  if (!ownershipType) return null;

  const lowerType = ownershipType.toLowerCase();

  if (
    lowerType.includes("community") ||
    lowerType.includes("feral") ||
    lowerType.includes("stray")
  ) {
    return (
      <span
        className="badge"
        style={{ background: "#dc3545", color: "#fff", fontSize: "0.5em" }}
        title={`Unowned (${ownershipType})`}
      >
        Unowned
      </span>
    );
  }
  if (lowerType === "owned") {
    return (
      <span
        className="badge"
        style={{ background: "#0d6efd", color: "#fff", fontSize: "0.5em" }}
        title="Owned cat - has an owner"
      >
        Owned
      </span>
    );
  }
  if (lowerType === "foster") {
    return (
      <span
        className="badge"
        style={{ background: "#6f42c1", color: "#fff", fontSize: "0.5em" }}
        title="Foster cat - in foster care"
      >
        Foster
      </span>
    );
  }
  return (
    <span
      className="badge"
      style={{ background: "#6c757d", color: "#fff", fontSize: "0.5em" }}
      title={ownershipType}
    >
      {ownershipType}
    </span>
  );
}
