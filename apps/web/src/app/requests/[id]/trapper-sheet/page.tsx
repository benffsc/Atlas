"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { formatPhone } from "@/lib/formatters";
import { fetchApi } from "@/lib/api-client";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import { formatPrintValue, formatPrintDate } from "@/lib/print-helpers";
import { buildCallSheetUrl } from "@/lib/print-documents";
import {
  Bubble,
  Check,
  EditableField,
  EditableTextArea,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";
import {
  getShortLabels,
  RECON_CHECKLIST_OPTIONS,
  TRAP_DAY_CHECKLIST_OPTIONS,
  MOM_FIXED_OPTIONS,
  CAN_BRING_IN_OPTIONS,
  KITTEN_CONTAINED_OPTIONS,
} from "@/lib/form-options";
import {
  IMPORTANT_NOTES_SHORT,
  MOM_PRESENT,
} from "@/lib/field-options";

// Derived from centralized registry (form-options.ts)
const RECON_CHECKLIST = getShortLabels(RECON_CHECKLIST_OPTIONS);
const TRAP_DAY_CHECKLIST = getShortLabels(TRAP_DAY_CHECKLIST_OPTIONS);
const MOM_FIXED = getShortLabels(MOM_FIXED_OPTIONS);
const CAN_BRING_IN_PRINT = getShortLabels(CAN_BRING_IN_OPTIONS);
const KITTEN_CONTAINED = getShortLabels(KITTEN_CONTAINED_OPTIONS);

interface TrapperSheetData {
  request_id: string;
  place_id: string | null;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  kitten_count: number | null;
  kitten_age_weeks: number | null;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  preferred_language: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  created_at: string;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates?: { lat: number; lng: number } | null;
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  permission_status: string | null;
  property_owner_contact: string | null;
  access_notes: string | null;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  property_type: string | null;
  colony_duration: string | null;
  location_description: string | null;
  eartip_count: number | null;
  count_confidence: string | null;
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_frequency: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  urgency_notes: string | null;
  best_contact_times: string | null;
  feeding_location: string | null;
  feeding_time: string | null;
  is_property_owner: boolean | null;
  dogs_on_site: string | null;
  trap_savvy: string | null;
  previous_tnr: string | null;
  handleability: string | null;
  fixed_status: string | null;
  ownership_status: string | null;
  has_medical_concerns: boolean;
  medical_description: string | null;
  important_notes: string[] | null;
  county: string | null;
  kitten_behavior: string | null;
  kitten_contained: string | null;
  mom_present: string | null;
  mom_fixed: string | null;
  can_bring_in: string | null;
  kitten_age_estimate: string | null;
  kitten_notes: string | null;
  current_trappers: Array<{
    trapper_person_id: string;
    trapper_name: string;
    trapper_type: string | null;
    is_primary: boolean;
    assigned_at: string;
  }> | null;
}

interface RelatedPerson {
  id: string;
  person_id: string | null;
  relationship_type: string;
  relationship_notes: string | null;
  notify_before_release: boolean;
  preferred_language: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  referred_by_display_name: string | null;
  info_completeness: string;
  contact_address: string | null;
}

interface JournalEntry {
  id: string;
  entry_kind: string;
  body: string;
  created_at: string;
  created_by_staff_name: string | null;
}

interface CorridorPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  relationship: string;
  place_role: string | null;
  cat_count: number;
  primary_contact: string | null;
  request_status: string | null;
}

export default function TrapperSheetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const { nameFull } = useOrgConfig();

  const [data, setData] = useState<TrapperSheetData | null>(null);
  const [relatedPeople, setRelatedPeople] = useState<RelatedPerson[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [corridorPlaces, setCorridorPlaces] = useState<CorridorPlace[]>([]);
  const [corridorNotes, setCorridorNotes] = useState<Array<{ body: string; date: string; actor: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeKittenPage, setIncludeKittenPage] = useState(false);
  const [mode, setMode] = useState<"trap" | "recon">(
    searchParams.get("mode") === "recon" ? "recon" : "trap"
  );

  useEffect(() => {
    async function fetchData() {
      try {
        const [result, rpData, jData] = await Promise.all([
          fetchApi<TrapperSheetData>(`/api/requests/${id}`),
          fetchApi<{ related_people: RelatedPerson[] }>(`/api/requests/${id}/related-people`).catch(() => ({ related_people: [] })),
          fetchApi<{ entries: JournalEntry[] }>(`/api/journal?request_id=${id}&include_related=true`).catch(() => ({ entries: [] })),
        ]);
        setData(result);
        setRelatedPeople(rpData.related_people || []);
        setJournalEntries((jData.entries || []).slice(0, 5));

        // Fetch corridor places if we have a place_id
        if (result.place_id) {
          fetchApi<{ mode: string; places: CorridorPlace[] }>(`/api/places/${result.place_id}/colony-context`)
            .then((ctx) => {
              if (ctx.mode === "colony" || ctx.mode === "corridor") {
                const others = (ctx.places || []).filter(p => p.relationship !== "self");
                setCorridorPlaces(others);
              }
            })
            .catch(() => {});

          // Fetch recent brain dumps / journal entries for the place
          fetchApi<{ entries: Array<{ body: string; created_at: string; created_by_staff_name: string | null; occurred_at: string | null }> }>(
            `/api/journal?place_id=${result.place_id}&limit=3`
          )
            .then((jData) => {
              const notes = (jData.entries || []).map(e => ({
                body: e.body,
                date: e.occurred_at || e.created_at,
                actor: e.created_by_staff_name,
              }));
              setCorridorNotes(notes);
            })
            .catch(() => {});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading request");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  if (loading) return <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "#e74c3c", fontFamily: "Helvetica, Arial, sans-serif" }}>{error}</div>;
  if (!data) return <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>Request not found</div>;

  // Derived flags
  const propertyType = data.property_type?.toLowerCase() || "";
  const isHouse = propertyType.includes("house") || propertyType.includes("sfh");
  const isApt = propertyType.includes("apt") || propertyType.includes("apartment") || propertyType.includes("condo");
  const isBusiness = propertyType.includes("business") || propertyType.includes("commercial");
  const isRural = propertyType.includes("rural") || propertyType.includes("farm") || propertyType.includes("ranch");

  const county = data.county?.toLowerCase() || "";
  const isSonoma = county.includes("sonoma") || (!county && !!data.place_city?.toLowerCase().includes("sonoma"));
  const isMarin = county.includes("marin");

  const duration = data.colony_duration?.toLowerCase() || "";
  const durationLessThanMonth = duration.includes("<1") || duration.includes("less than 1");
  const duration1to6 = duration.includes("1-6") || duration.includes("1 to 6");
  const duration6to2 = duration.includes("6mo") || duration.includes("6 month") || duration.includes("year");
  const duration2plus = duration.includes("2+") || duration.includes("years");

  const handleability = data.handleability?.toLowerCase() || "";
  const isFriendly = handleability.includes("friendly") || handleability.includes("carrier") || data.cats_are_friendly === true;
  const isTrapNeeded = handleability.includes("trap") || handleability.includes("feral");
  const isMixed = handleability.includes("mixed");

  const ownership = data.ownership_status?.toLowerCase() || "";
  const isOwner = ownership.includes("owner") || ownership.includes("yes") || data.is_property_owner === true;
  const isRenter = ownership.includes("rent");

  const permGranted = data.permission_status === "granted" || data.permission_status === "yes";
  const permDenied = data.permission_status === "denied" || data.permission_status === "no";
  const permPending = data.permission_status === "pending";

  const importantNotes = [
    ...(data.important_notes || []),
    ...(data.urgency_reasons || []),
  ].map(n => n.toLowerCase());
  const hasWithholdFood = importantNotes.some(n => n.includes("withhold"));
  const hasOtherFeeders = importantNotes.some(n => n.includes("other feeder"));
  const hasCrossPropLines = importantNotes.some(n => n.includes("cross") || n.includes("property line"));
  const hasPregnant = importantNotes.some(n => n.includes("pregnant"));
  const hasInjured = importantNotes.some(n => n.includes("injured") || n.includes("sick"));
  const hasCallerHelp = importantNotes.some(n => n.includes("caller") && n.includes("help"));
  const hasWildlife = importantNotes.some(n => n.includes("wildlife") || n.includes("raccoon"));
  const hasNeighborIssues = importantNotes.some(n => n.includes("neighbor"));
  const hasUrgent = importantNotes.some(n => n.includes("urgent") || n.includes("time-sensitive"));

  const kittenAge = data.kitten_age_weeks || 0;
  const kittenUnder4 = kittenAge > 0 && kittenAge < 4;
  const kitten4to8 = kittenAge >= 4 && kittenAge < 8;
  const kitten8to12 = kittenAge >= 8 && kittenAge < 12;
  const kitten12to16 = kittenAge >= 12 && kittenAge < 16;
  const kitten4plus = kittenAge >= 16;

  const hasUrgencyAlert = (data.urgency_reasons && data.urgency_reasons.length > 0) || data.has_medical_concerns;
  const showKittenPage = data.has_kittens || includeKittenPage;
  const totalPages = 2;
  const isRecon = mode === "recon";
  const sheetTitle = isRecon ? "Recon Sheet" : "Trapper Assignment Sheet";

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        ${PRINT_BASE_CSS}
        ${PRINT_EDITABLE_CSS}

        .trapper-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #166534;
          color: #fff;
          padding: 4px 10px;
          border-radius: 5px;
          margin-bottom: 6px;
        }
        .trapper-header .trapper-names { font-size: 11pt; font-weight: 600; }
        .trapper-header .trapper-date { font-size: 9.5pt; }

        /* Bake margins into element so screen preview = print output */
        .print-page {
          padding: 0.40in 0.50in 0.35in !important;
        }
        @media print {
          @page { margin: 0 !important; }
          .print-page {
            padding: 0.40in 0.50in 0.35in !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
          }
        }
        @media screen {
          .print-wrapper { padding-right: 320px; }
        }
      `}</style>

      {/* Print Controls */}
      <PrintControlsPanel
        title={sheetTitle}
        description="Front: case info. Back: field notes. Print double-sided via Ctrl+P."
        backHref={`/requests/${id}`}
        backLabel="Back to Request"
      >
        <div style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 600, color: "#666" }}>
          Mode
        </div>
        <div className="mode-selector">
          <button className={mode === "trap" ? "active" : ""} onClick={() => setMode("trap")}>
            Trap
          </button>
          <button className={mode === "recon" ? "active" : ""} onClick={() => setMode("recon")}>
            Recon
          </button>
        </div>
        {!data.has_kittens && (
          <label>
            <input type="checkbox" checked={includeKittenPage} onChange={(e) => setIncludeKittenPage(e.target.checked)} />
            Include kitten page
          </label>
        )}
        <div className="ctrl-hint">ID: {data.request_id.slice(0, 8)}</div>
        <a
          href={buildCallSheetUrl({ name: data.requester_name, phone: data.requester_phone, email: data.requester_email, address: data.place_address || data.place_name })}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "block", marginTop: "12px", textAlign: "center", fontSize: "13px", color: "#27ae60", textDecoration: "underline" }}
        >
          Print TNR Call Sheet
        </a>
      </PrintControlsPanel>

      {/* ═══════════════════ PAGE 1 ═══════════════════ */}
      <div className="print-page">
        <PrintHeader
          title={sheetTitle}
          subtitle={nameFull}
          rightContent={
            <div className={`priority-badge priority-${data.priority}`}>
              {data.priority}
            </div>
          }
        />

        {/* Assignment / Recon Bar */}
        <div className="trapper-header">
          <div className="trapper-names">
            {isRecon ? "Recon By: " : "Assigned: "}
            {data.current_trappers && data.current_trappers.length > 0
              ? data.current_trappers.map(t => t.trapper_name).join(", ")
              : "_______________________"}
          </div>
          <div className="trapper-date">
            {data.scheduled_date
              ? `Scheduled: ${formatPrintDate(data.scheduled_date)}${data.scheduled_time_range ? ` (${data.scheduled_time_range})` : ""}`
              : "Scheduled: ______________"}
          </div>
        </div>

        {/* Urgency Alert */}
        {hasUrgencyAlert && (
          <div className="emergency-box">
            <div className="title">
              <span className="checkbox checked">✓</span>
              URGENT: {data.urgency_reasons?.map(r => formatPrintValue(r)).join(", ")}
              {data.urgency_deadline && ` — Deadline: ${formatPrintDate(data.urgency_deadline)}`}
            </div>
            {data.urgency_notes && (
              <div style={{ marginTop: "3px", fontSize: "9pt", fontStyle: "italic" }}>
                {data.urgency_notes}
              </div>
            )}
            {data.has_medical_concerns && data.medical_description && (
              <div style={{ marginTop: "3px", fontSize: "9pt" }}>
                <strong>Medical:</strong> {data.medical_description}
              </div>
            )}
          </div>
        )}

        {/* CONTACT + LOCATION side by side */}
        <div className="two-col" style={{ marginBottom: "6px" }}>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Contact</div>
            <EditableField
              value={data.requester_name}
              placeholder="Contact name"
              style={{ marginBottom: "3px" }}
            />
            <EditableField
              value={
                [
                  data.requester_phone ? formatPhone(data.requester_phone) : "",
                  data.requester_email,
                ]
                  .filter(Boolean)
                  .join(" | ") || null
              }
              placeholder="Phone | Email"
              style={{ marginBottom: "3px" }}
            />
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "40px" }}>Pref:</span>
              <Bubble filled={data.preferred_contact_method === "call"} label="Call" />
              <Bubble filled={data.preferred_contact_method === "text"} label="Text" />
              <Bubble filled={data.preferred_contact_method === "email"} label="Email" />
            </div>
            {data.property_owner_contact && data.property_owner_contact !== data.requester_name && (
              <div style={{ fontSize: "8.5pt", marginTop: "2px" }}>Property owner: <strong>{data.property_owner_contact}</strong></div>
            )}
            {data.preferred_language && data.preferred_language !== "en" && (
              <div style={{ marginTop: "3px", padding: "2px 6px", background: "#eef2ff", borderRadius: "3px", fontSize: "8.5pt", fontWeight: 700, color: "#4338ca", display: "inline-block" }}>
                LANGUAGE: {data.preferred_language.toUpperCase()}
              </div>
            )}
          </div>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Location</div>
            <EditableField
              value={data.place_address || data.place_name}
              placeholder="Address"
              style={{ marginBottom: "3px" }}
            />
            <EditableField
              value={[data.place_city, "CA", data.place_postal_code].filter(Boolean).join(", ") || null}
              placeholder="City, State, ZIP"
              style={{ marginBottom: "3px" }}
            />
            <div className="options-row" style={{ marginBottom: 0 }}>
              <Bubble filled={isSonoma} label="Sonoma" />
              <Bubble filled={isMarin} label="Marin" />
              <span style={{ marginLeft: "8px" }}></span>
              <Bubble filled={isHouse} label="House" />
              <Bubble filled={isApt} label="Apt" />
              <Bubble filled={isBusiness} label="Biz" />
              <Bubble filled={isRural} label="Rural" />
            </div>
          </div>
        </div>

        {data.location_description && (
          <div className="info-card" style={{ fontSize: "8.5pt" }}>
            <strong>Location:</strong> {data.location_description}
          </div>
        )}

        {/* Corridor Addresses (if multi-site) */}
        {corridorPlaces.length > 0 && (
          <div className="info-card" style={{ fontSize: "8.5pt", background: "#f0fdf4", borderColor: "#bbf7d0" }}>
            <strong>Corridor ({corridorPlaces.length + 1} addresses):</strong>
            <div style={{ marginTop: "2px", display: "flex", flexDirection: "column", gap: "1px" }}>
              {corridorPlaces.map(p => (
                <div key={p.place_id}>
                  <strong>{p.display_name || p.formatted_address}</strong>
                  {p.primary_contact && <span> &mdash; {p.primary_contact}</span>}
                  {p.cat_count > 0 && <span> ({p.cat_count} cats)</span>}
                  {p.request_status && (
                    <span style={{ marginLeft: "4px", fontStyle: "italic", color: "#555" }}>
                      [{p.request_status === "completed" ? "Done" : p.request_status}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Field Intel (brain dumps from journal) */}
        {corridorNotes.length > 0 && (
          <div className="info-card" style={{ fontSize: "8.5pt", background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <strong>Recent Intel:</strong>
            <div style={{ marginTop: "2px", display: "flex", flexDirection: "column", gap: "2px" }}>
              {corridorNotes.map((n, i) => (
                <div key={i} style={{ borderLeft: "2px solid #93c5fd", paddingLeft: "5px" }}>
                  <span style={{ color: "#555" }}>
                    {new Date(n.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {n.actor && ` — ${n.actor}`}:
                  </span>{" "}
                  {n.body.length > 150 ? n.body.slice(0, 150) + "..." : n.body}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CATS section */}
        <div className="section">
          <div className="section-title">Cats</div>
          <div className="options-row" style={{ marginBottom: "2px" }}>
            <span style={{ fontWeight: 700, fontSize: "11pt", marginRight: "6px" }}>
              {data.estimated_cat_count ?? "?"}
            </span>
            <span className="hint" style={{ marginRight: "8px" }}>
              ({data.count_confidence ? formatPrintValue(data.count_confidence) : "unk"})
            </span>
            <span className="options-label" style={{ minWidth: "55px" }}>Eartipped:</span>
            <Bubble filled={data.eartip_count === 0} label="None" />
            <Bubble filled={data.eartip_count !== null && data.eartip_count > 0} label={`${data.eartip_count ?? "?"}`} />
            <Bubble filled={data.eartip_count === null} label="Unk" />
            <span style={{ marginLeft: "8px" }}></span>
            <span className="options-label" style={{ minWidth: "50px" }}>Colony:</span>
            <Bubble filled={durationLessThanMonth} label="<1mo" />
            <Bubble filled={duration1to6} label="1-6mo" />
            <Bubble filled={duration6to2} label="6mo-2yr" />
            <Bubble filled={duration2plus} label="2+yr" />
          </div>
          <div className="options-row" style={{ marginBottom: "2px" }}>
            <span className="options-label" style={{ minWidth: "30px" }}>Fed:</span>
            <Bubble filled={data.is_being_fed === true} label="Yes" />
            <Bubble filled={data.is_being_fed === false} label="No" />
            {data.feeder_name && <span style={{ fontSize: "8.5pt" }}>by &ldquo;{data.feeder_name}&rdquo;</span>}
            {data.feeding_frequency && <span style={{ fontSize: "8.5pt", marginLeft: "4px" }}>{data.feeding_frequency}</span>}
            {data.feeding_location && <span style={{ fontSize: "8.5pt", marginLeft: "4px" }}>@ {data.feeding_location}</span>}
            {data.feeding_time && <span style={{ fontSize: "8.5pt", marginLeft: "4px" }}>({data.feeding_time})</span>}
            <span style={{ marginLeft: "12px" }}></span>
            <span className="options-label" style={{ minWidth: "50px" }}>Kittens:</span>
            <Bubble filled={data.has_kittens === true} label="Yes" />
            <Bubble filled={data.has_kittens === false} label="No" />
            {data.has_kittens && data.kitten_count && <span style={{ fontSize: "8.5pt", marginLeft: "3px" }}>({data.kitten_count})</span>}
            {showKittenPage && <span className="hint" style={{ marginLeft: "4px", color: "#27ae60", fontWeight: 600 }}>See pg 2</span>}
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "70px" }}>Handleable:</span>
            <Bubble filled={isFriendly} label="Carrier OK" />
            <Bubble filled={isTrapNeeded} label="Trap needed" />
            <Bubble filled={isMixed} label="Mixed" />
          </div>
        </div>

        {/* ACCESS & LOGISTICS + TRAPPING SCHEDULE side by side */}
        <div className="two-col" style={{ marginBottom: "6px" }}>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Access &amp; Logistics</div>
            <div className="options-row">
              <span className="options-label" style={{ minWidth: "70px" }}>Permission:</span>
              <Bubble filled={permGranted} label="Yes" />
              <Bubble filled={permPending} label="Pending" />
              <Bubble filled={permDenied} label="No" />
            </div>
            <div className="options-row">
              <span className="options-label" style={{ minWidth: "70px" }}>Traps safe:</span>
              <Bubble filled={data.traps_overnight_safe === true} label="Yes" />
              <Bubble filled={data.traps_overnight_safe === false} label="No" />
            </div>
            <div className="options-row">
              <span className="options-label" style={{ minWidth: "70px" }}>Owner:</span>
              <Bubble filled={isOwner} label="Yes" />
              <Bubble filled={isRenter} label="Renter" />
            </div>
            <div className="options-row">
              <span className="options-label" style={{ minWidth: "70px" }}>Dogs:</span>
              <Bubble filled={data.dogs_on_site === "yes"} label="Yes" />
              <Bubble filled={data.dogs_on_site === "no"} label="No" />
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Trap-savvy:</span>
              <Bubble filled={data.trap_savvy === "yes"} label="Yes" />
              <Bubble filled={data.trap_savvy === "no"} label="No" />
              <Bubble filled={!data.trap_savvy || data.trap_savvy === "unknown"} label="Unk" />
            </div>
          </div>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Trapping Schedule</div>
            <EditableField label="Best contact times" value={data.best_contact_times} placeholder="Times to reach contact" style={{ marginBottom: "3px" }} />
            <EditableField label="Feeding time" value={data.feeding_time} placeholder="When cats are fed" style={{ marginBottom: "3px" }} />
            <EditableField label="Where cats eat" value={data.feeding_location} placeholder="Feeding location" style={{ marginBottom: "3px" }} />
            <EditableField label="Best trapping day/time" value={data.best_times_seen} placeholder="When cats are seen" style={{ marginBottom: 0 }} />
          </div>
        </div>

        {data.access_notes && (
          <div className="info-card" style={{ fontSize: "8.5pt" }}>
            <strong>Access:</strong> {data.access_notes}
          </div>
        )}

        {/* Important Notes */}
        <div className="warning-box">
          <div className="title">Important Notes</div>
          <div className="quick-notes">
            {IMPORTANT_NOTES_SHORT.map((label, i) => {
              const checks = [hasWithholdFood, hasOtherFeeders, hasCrossPropLines, hasPregnant, hasInjured, hasCallerHelp, hasWildlife, hasNeighborIssues, hasUrgent];
              return (
                <div key={label} className="quick-note"><Check checked={checks[i]} label={label} /></div>
              );
            })}
          </div>
        </div>

        {/* Field Contacts */}
        {relatedPeople.length > 0 && (
          <div className="section">
            <div className="section-title">Field Contacts ({relatedPeople.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {relatedPeople.map((rp) => (
                <div key={rp.id} style={{ display: "flex", gap: "6px", alignItems: "baseline", fontSize: "9pt", borderBottom: "1px solid #eee", paddingBottom: "2px" }}>
                  <span style={{ fontWeight: 700, minWidth: "100px" }}>{rp.display_name || "Unknown"}</span>
                  <span style={{ color: "#555", minWidth: "80px" }}>{formatPrintValue(rp.relationship_type)}</span>
                  {rp.phone && <span>{formatPhone(rp.phone)}</span>}
                  {rp.email && <span style={{ color: "#555" }}>{rp.email}</span>}
                  {rp.contact_address && <span style={{ color: "#555" }}>{rp.contact_address}</span>}
                  {rp.preferred_language && rp.preferred_language !== "en" && (
                    <span style={{ fontWeight: 600, color: "#4338ca", fontSize: "8pt" }}>[{rp.preferred_language.toUpperCase()}]</span>
                  )}
                  {rp.notify_before_release && <span style={{ fontSize: "8pt", color: "#d97706" }}>NOTIFY</span>}
                  {rp.referred_by_display_name && (
                    <span style={{ fontSize: "8pt", color: "#555", fontStyle: "italic" }}>via {rp.referred_by_display_name}</span>
                  )}
                  {rp.info_completeness === "name_only" && (
                    <span style={{ fontSize: "7.5pt", color: "#c2410c", fontWeight: 600 }}>NAME ONLY</span>
                  )}
                </div>
              ))}
              {relatedPeople.some(rp => rp.relationship_notes) && (
                <div style={{ marginTop: "2px", fontSize: "8.5pt", color: "#555" }}>
                  {relatedPeople.filter(rp => rp.relationship_notes).map(rp => (
                    <div key={rp.id}><strong>{rp.display_name}:</strong> {rp.relationship_notes}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recent Journal */}
        {journalEntries.length > 0 && (
          <div className="section">
            <div className="section-title">Recent Activity ({journalEntries.length})</div>
            <div style={{ fontSize: "8.5pt", display: "flex", flexDirection: "column", gap: "3px" }}>
              {journalEntries.map((entry) => (
                <div key={entry.id} style={{ borderLeft: "2px solid #ccc", paddingLeft: "6px" }}>
                  <span style={{ color: "#555" }}>
                    {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {entry.created_by_staff_name ? ` — ${entry.created_by_staff_name}` : ""}
                  </span>
                  {" "}
                  <span>{entry.body.length > 200 ? entry.body.slice(0, 200) + "..." : entry.body}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Case Situation */}
        {data.notes && (
          <div className="section">
            <div className="section-title">Case Situation</div>
            <div className="info-card" style={{ fontSize: "8.5pt", whiteSpace: "pre-wrap", lineHeight: 1.3 }}>
              {data.notes}
            </div>
          </div>
        )}

        <PrintFooter
          left={`Ref: ${data.request_id.slice(0, 8)} | ${formatPrintValue(data.status)} | ${formatPrintDate(data.created_at)}`}
          right={`Page 1 of ${totalPages}`}
        />
      </div>

      {/* ═══════════════════ PAGE 2: Field Notes (back) ═══════════════════ */}
      <div className="print-page">
        <PrintHeader
          title={isRecon ? "Recon Field Notes" : "Trapper Field Notes"}
          subtitle={`${data.place_address || data.place_name || "Location"} — ${data.requester_name || "Requester"}`}
        />

        {/* Trapper Recon */}
        <div className="staff-box" style={{ background: "#fef3c7", borderColor: "#fcd34d", marginBottom: "6px" }}>
          <div className="section-title" style={{ color: "#92400e" }}>
            {isRecon ? "Recon Notes (site visit)" : "Trapper Recon (site visit)"}
          </div>
          <div className="field-row">
            <div className="field" style={{ flex: "0 0 70px" }}>
              <label>Count</label>
              <div className="field-input sm"><input type="text" placeholder="#" /></div>
            </div>
            <div className="field" style={{ flex: "0 0 100px" }}>
              <label>A / K / Tipped</label>
              <div className="field-input sm"><input type="text" placeholder="0/0/0" /></div>
            </div>
            <EditableField label="Trap locations" placeholder="Where to set traps" />
            <EditableField label="Cat descriptions" placeholder="Colors, markings" />
          </div>
          {isRecon && (
            <EditableTextArea label="Recon observations" placeholder="Site conditions, access, food sources, hiding spots..." size="md" style={{ marginTop: "3px" }} />
          )}
          <div className="options-row" style={{ marginTop: "3px", marginBottom: 0 }}>
            {RECON_CHECKLIST.map(item => (
              <span key={item} className="option"><span className="checkbox"></span> {item}</span>
            ))}
          </div>
        </div>

        {/* Trap Day Checklist — hidden in recon mode */}
        {!isRecon && (
          <div className="section">
            <div className="section-title">Trap Day</div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              {TRAP_DAY_CHECKLIST.map(item => (
                <span key={item} className="option"><span className="checkbox"></span> {item}</span>
              ))}
              <span style={{ marginLeft: "8px" }}>Set: <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "50px", font: "inherit", padding: 0 }} /></span>
              <span style={{ marginLeft: "8px" }}>#Traps: <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "30px", font: "inherit", padding: 0 }} /></span>
              <span style={{ marginLeft: "8px" }}>#Caught: <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "30px", font: "inherit", padding: 0 }} /></span>
              <span style={{ marginLeft: "8px" }}>Return: <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "50px", font: "inherit", padding: 0 }} /></span>
            </div>
          </div>
        )}

        {/* Kitten Details (if applicable) */}
        {showKittenPage && (
          <div className="section">
            <div className="section-title">Kitten Information</div>
            <div className="field-row" style={{ alignItems: "center" }}>
              <div className="field" style={{ flex: "0 0 100px" }}>
                <label>How many?</label>
                <div className={`field-input sm ${data.kitten_count ? "prefilled" : ""}`} style={{ width: "50px" }}>
                  <input type="text" defaultValue={data.kitten_count?.toString() || ""} />
                </div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "55px" }}>Age:</span>
                <Bubble filled={kittenUnder4} label="<4 wks" />
                <Bubble filled={kitten4to8} label="4-8 wks" />
                <Bubble filled={kitten8to12} label="8-12 wks" />
                <Bubble filled={kitten12to16} label="12-16 wks" />
                <Bubble filled={kitten4plus} label="4+ mo" />
              </div>
            </div>
            <div className="options-row" style={{ marginTop: "4px" }}>
              <span className="options-label" style={{ minWidth: "60px" }}>Behavior:</span>
              <Bubble filled={data.kitten_behavior === "friendly"} label="Friendly" />
              <Bubble filled={data.kitten_behavior === "shy"} label="Shy" />
              <Bubble filled={data.kitten_behavior === "feral"} label="Feral" />
              <Bubble filled={!data.kitten_behavior} label="Unknown" />
            </div>
            <div className="info-card" style={{ marginTop: "4px" }}>
              <div className="options-row" style={{ marginBottom: "2px" }}>
                <span className="options-label" style={{ minWidth: "65px" }}>Contained?</span>
                {KITTEN_CONTAINED.map(c => (
                  <Bubble key={c} filled={data.kitten_contained === c.toLowerCase()} label={c} />
                ))}
                <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "75px" }}>Mom present?</span></span>
                {MOM_PRESENT.map(m => (
                  <Bubble key={m} filled={m === "Unsure" ? (!data.mom_present || data.mom_present === "unsure") : data.mom_present === m.toLowerCase()} label={m} />
                ))}
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "65px" }}>Mom fixed?</span>
                {MOM_FIXED.map(m => (
                  <Bubble key={m} filled={m === "Unsure" ? (!data.mom_fixed || data.mom_fixed === "unsure") : data.mom_fixed === m.toLowerCase()} label={m} />
                ))}
                <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "75px" }}>Can bring in?</span></span>
                {CAN_BRING_IN_PRINT.map(c => (
                  <Bubble key={c} filled={data.can_bring_in === c.toLowerCase().replace(" ", "_")} label={c} />
                ))}
              </div>
            </div>
            <EditableTextArea
              label="Kitten details (colors, where they hide, feeding schedule)"
              value={data.kitten_notes}
              placeholder="Describe the kittens..."
              size="md"
              style={{ marginTop: "6px" }}
            />
          </div>
        )}

        {/* Trapper Notes — big blank area for handwriting */}
        <div className="section" style={{ flex: 1 }}>
          <div className="section-title">Trapper Notes</div>
          <EditableTextArea placeholder="Notes from the field..." size="xl" />
        </div>

        <PrintFooter
          left={`Ref: ${data.request_id.slice(0, 8)} | ${nameFull}`}
          right="Page 2 of 2"
        />
      </div>
    </div>
  );
}
