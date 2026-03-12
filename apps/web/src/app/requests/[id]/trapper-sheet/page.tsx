"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { formatPhone } from "@/lib/formatters";
import { fetchApi } from "@/lib/api-client";
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
  IMPORTANT_NOTES_SHORT,
  RECON_CHECKLIST,
  TRAP_DAY_CHECKLIST,
  KITTEN_AGE_ESTIMATE,
  MOM_PRESENT,
  MOM_FIXED,
  CAN_BRING_IN_PRINT,
  KITTEN_CONTAINED,
} from "@/lib/field-options";

interface TrapperSheetData {
  request_id: string;
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

export default function TrapperSheetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const [data, setData] = useState<TrapperSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeKittenPage, setIncludeKittenPage] = useState(false);
  const [mode, setMode] = useState<"trap" | "recon">(
    searchParams.get("mode") === "recon" ? "recon" : "trap"
  );

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await fetchApi<TrapperSheetData>(`/api/requests/${id}`);
        setData(result);
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

  const importantNotes = (data.important_notes || []).map(n => n.toLowerCase());
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
  const totalPages = showKittenPage ? 2 : 1;
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
      `}</style>

      {/* Print Controls */}
      <PrintControlsPanel
        title={sheetTitle}
        description={`Dense 1-page layout${showKittenPage ? " + kitten page" : ""}. Print via Ctrl+P.`}
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
          subtitle="Forgotten Felines of Sonoma County"
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

        {/* Notes */}
        <div className="section">
          <div className="section-title">Notes</div>
          {data.notes && (
            <EditableTextArea value={data.notes} size="sm" style={{ marginBottom: "3px" }} />
          )}
          <EditableTextArea placeholder="Trapper notes..." size="md" />
        </div>

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

        <PrintFooter
          left={`Ref: ${data.request_id.slice(0, 8)} | ${formatPrintValue(data.status)} | ${formatPrintDate(data.created_at)}`}
          right={`Page 1 of ${totalPages}`}
        />
      </div>

      {/* ═══════════════════ PAGE 2: Kitten Details ═══════════════════ */}
      {showKittenPage && (
        <div className="print-page">
          <PrintHeader
            title="Kitten Details"
            subtitle={`${data.place_address || data.place_name || "Location"} — ${data.requester_name || "Requester"}`}
          />

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

          <div className="field-row" style={{ marginTop: "8px" }}>
            <EditableField
              label="Contact (from page 1)"
              value={
                [
                  data.requester_name,
                  data.requester_phone ? formatPhone(data.requester_phone) : null,
                ]
                  .filter(Boolean)
                  .join(" — ") || null
              }
              style={{ flex: 2 }}
            />
          </div>

          <PrintFooter
            left={`Ref: ${data.request_id.slice(0, 8)} | Forgotten Felines of Sonoma County`}
            right="Page 2 of 2"
          />
        </div>
      )}
    </div>
  );
}
