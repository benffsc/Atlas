"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatPhone } from "@/lib/formatters";
import { fetchApi } from "@/lib/api-client";

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
  // Location
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates?: { lat: number; lng: number } | null;
  // Requester
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  // Enhanced intake
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
  // Call sheet trapping logistics (MIG_2495)
  dogs_on_site: string | null;
  trap_savvy: string | null;
  previous_tnr: string | null;
  handleability: string | null;
  fixed_status: string | null;
  ownership_status: string | null;
  has_medical_concerns: boolean;
  medical_description: string | null;
  important_notes: string[] | null;
  // County info
  county: string | null;
  // Kitten details
  kitten_behavior: string | null;
  kitten_contained: string | null;
  mom_present: string | null;
  mom_fixed: string | null;
  can_bring_in: string | null;
  kitten_age_estimate: string | null;
  kitten_notes: string | null;
  // Trapper assignment
  current_trappers: Array<{
    trapper_person_id: string;
    trapper_name: string;
    trapper_type: string | null;
    is_primary: boolean;
    assigned_at: string;
  }> | null;
}

function formatValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return dateStr;
  }
}

function Bubble({ filled, label }: { filled: boolean; label: string }) {
  return (
    <span className="option">
      <span className={`bubble ${filled ? "filled" : ""}`}></span> {label}
    </span>
  );
}

function Check({ checked, crossed, label }: { checked?: boolean; crossed?: boolean; label: string }) {
  return (
    <span className="option">
      <span className={`checkbox ${checked ? "checked" : crossed ? "crossed" : ""}`}>
        {checked ? "✓" : crossed ? "✗" : ""}
      </span> {label}
    </span>
  );
}

export default function TrapperSheetPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<TrapperSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const data = await fetchApi<TrapperSheetData>(`/api/requests/${id}`);
        setData(data);
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

  // Determine property type
  const propertyType = data.property_type?.toLowerCase() || "";
  const isHouse = propertyType.includes("house") || propertyType.includes("sfh");
  const isApt = propertyType.includes("apt") || propertyType.includes("apartment") || propertyType.includes("condo");
  const isBusiness = propertyType.includes("business") || propertyType.includes("commercial");
  const isRural = propertyType.includes("rural") || propertyType.includes("farm") || propertyType.includes("ranch");

  // Determine county
  const county = data.county?.toLowerCase() || "";
  const isSonoma = county.includes("sonoma") || (!county && !!data.place_city?.toLowerCase().includes("sonoma"));
  const isMarin = county.includes("marin");

  // Determine colony duration
  const duration = data.colony_duration?.toLowerCase() || "";
  const durationLessThanMonth = duration.includes("<1") || duration.includes("less than 1");
  const duration1to6 = duration.includes("1-6") || duration.includes("1 to 6");
  const duration6to2 = duration.includes("6mo") || duration.includes("6 month") || duration.includes("year");
  const duration2plus = duration.includes("2+") || duration.includes("years");

  // Handleability mapping
  const handleability = data.handleability?.toLowerCase() || "";
  const isFriendly = handleability.includes("friendly") || handleability.includes("carrier") || data.cats_are_friendly === true;
  const isTrapNeeded = handleability.includes("trap") || handleability.includes("feral");
  const isMixed = handleability.includes("mixed");

  // Ownership / property owner — check both ownership_status and is_property_owner
  const ownership = data.ownership_status?.toLowerCase() || "";
  const isOwner = ownership.includes("owner") || ownership.includes("yes") || data.is_property_owner === true;
  const isRenter = ownership.includes("rent");

  // Permission status: DB stores 'yes' but old code checked 'granted'
  const permGranted = data.permission_status === "granted" || data.permission_status === "yes";
  const permDenied = data.permission_status === "denied" || data.permission_status === "no";
  const permPending = data.permission_status === "pending";

  // Important notes flags
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

  // Kitten age range
  const kittenAge = data.kitten_age_weeks || 0;
  const kittenUnder4 = kittenAge > 0 && kittenAge < 4;
  const kitten4to8 = kittenAge >= 4 && kittenAge < 8;
  const kitten8to12 = kittenAge >= 8 && kittenAge < 12;
  const kitten12to16 = kittenAge >= 12 && kittenAge < 16;
  const kitten4plus = kittenAge >= 16;

  const hasUrgencyAlert = (data.urgency_reasons && data.urgency_reasons.length > 0) || data.has_medical_concerns;
  const totalPages = data.has_kittens ? 2 : 1;

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.35in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
          .print-controls, .tippy-fab, .tippy-chat-panel { display: none !important; }
          .print-wrapper { width: 100% !important; padding: 0 !important; }
          .print-page {
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            padding: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
            overflow: visible !important;
          }
          .print-page:last-child { page-break-after: auto; }
        }

        body { margin: 0; padding: 0; }

        .print-wrapper {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 9.5pt;
          line-height: 1.25;
          color: #2c3e50;
        }

        .print-page {
          width: 8.5in;
          padding: 0.35in;
          box-sizing: border-box;
          background: #fff;
        }

        h1, h2, h3, .section-title {
          font-family: 'Raleway', Helvetica, sans-serif;
          font-weight: 700;
        }

        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 6px;
          margin-bottom: 6px;
          border-bottom: 3px solid #27ae60;
        }

        .print-header h1 {
          font-size: 15pt;
          margin: 0;
          color: #27ae60;
        }

        .print-header .subtitle {
          font-size: 8.5pt;
          color: #7f8c8d;
          margin-top: 1px;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .header-logo {
          height: 36px;
          width: auto;
        }

        .priority-badge {
          padding: 3px 10px;
          border-radius: 4px;
          font-weight: 700;
          font-size: 9.5pt;
          text-transform: uppercase;
        }

        .priority-urgent { background: #dc2626; color: #fff; }
        .priority-high { background: #ea580c; color: #fff; }
        .priority-normal { background: #16a34a; color: #fff; }
        .priority-low { background: #6b7280; color: #fff; }

        .section {
          margin-bottom: 6px;
        }

        .section-title {
          font-size: 10pt;
          color: #27ae60;
          border-bottom: 1.5px solid #ecf0f1;
          padding-bottom: 2px;
          margin-bottom: 4px;
        }

        .field-row {
          display: flex;
          gap: 8px;
          margin-bottom: 4px;
        }

        .field {
          flex: 1;
          min-width: 0;
        }

        .field.w2 { flex: 2; }
        .field.w3 { flex: 3; }
        .field.half { flex: 0.5; }

        .field label {
          display: block;
          font-size: 7.5pt;
          font-weight: 600;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 1px;
        }

        .field-input {
          border: 1px solid #bdc3c7;
          border-radius: 3px;
          padding: 3px 5px;
          min-height: 20px;
          background: #fff;
          font-size: 9.5pt;
        }

        .field-input.prefilled {
          background: #f0fdf4;
          color: #2c3e50;
        }

        .field-input.sm { min-height: 18px; padding: 2px 5px; }
        .field-input.md { min-height: 40px; }

        .options-row {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 9pt;
          margin-bottom: 3px;
          flex-wrap: wrap;
        }

        .options-label {
          font-weight: 600;
          color: #2c3e50;
          min-width: 75px;
          font-size: 9pt;
        }

        .option {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          margin-right: 8px;
        }

        .bubble {
          width: 11px;
          height: 11px;
          border: 1.5px solid #27ae60;
          border-radius: 50%;
          background: #fff;
          flex-shrink: 0;
        }

        .bubble.filled {
          background: #27ae60;
        }

        .checkbox {
          width: 11px;
          height: 11px;
          border: 1.5px solid #27ae60;
          border-radius: 2px;
          background: #fff;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 8pt;
          font-weight: 700;
        }

        .checkbox.checked {
          background: #27ae60;
          color: #fff;
        }

        .checkbox.crossed {
          border-color: #dc2626;
          color: #dc2626;
        }

        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .emergency-box {
          border: 1.5px solid #e74c3c;
          background: #fdedec;
          padding: 5px 8px;
          margin-bottom: 6px;
          border-radius: 5px;
        }

        .emergency-box .title {
          display: flex;
          align-items: center;
          gap: 5px;
          font-weight: 600;
          color: #e74c3c;
          font-size: 9pt;
        }

        .emergency-box .checkbox {
          border-color: #e74c3c;
        }

        .emergency-box .checkbox.checked {
          background: #e74c3c;
          border-color: #e74c3c;
        }

        .warning-box {
          background: #fef3c7;
          border: 1.5px solid #fcd34d;
          border-radius: 5px;
          padding: 4px 8px;
          margin-bottom: 6px;
        }

        .warning-box .title {
          font-weight: 600;
          color: #92400e;
          font-size: 9pt;
          margin-bottom: 3px;
        }

        .info-card {
          background: #f8f9fa;
          border-radius: 4px;
          padding: 4px 8px;
          margin-bottom: 4px;
          border-left: 3px solid #27ae60;
        }

        .info-box {
          background: #f0fdf4;
          border: 1.5px solid #86efac;
          border-radius: 5px;
          padding: 4px 8px;
          margin-bottom: 6px;
        }

        .info-box .title {
          font-weight: 600;
          color: #166534;
          font-size: 9pt;
          margin-bottom: 3px;
        }

        .staff-box {
          border: 1.5px dashed #94a3b8;
          border-radius: 5px;
          padding: 6px 8px;
          background: #f8fafc;
        }

        .staff-box .section-title {
          color: #7f8c8d;
          border-bottom-color: #bdc3c7;
        }

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

        .trapper-header .trapper-names {
          font-size: 11pt;
          font-weight: 600;
        }

        .trapper-header .trapper-date {
          font-size: 9.5pt;
        }

        .quick-notes {
          display: flex;
          flex-wrap: wrap;
          gap: 3px 10px;
        }

        .quick-note {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 8.5pt;
        }

        .page-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 4px;
          margin-top: 6px;
          border-top: 1px solid #ecf0f1;
          font-size: 7.5pt;
          color: #95a5a6;
        }

        .hint {
          font-size: 7pt;
          color: #95a5a6;
        }

        @media screen {
          body { background: #f0f9f4 !important; }
          .print-wrapper { padding: 20px; }
          .print-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin: 0 auto 30px auto;
            border-radius: 8px;
            height: auto;
            min-height: 10in;
          }
          .tippy-fab, .tippy-chat-panel { display: none !important; }
          .print-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 1000;
            width: 280px;
          }
          .print-controls h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #27ae60;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 10px 16px;
            margin-bottom: 8px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
          }
          .print-controls .print-btn {
            background: linear-gradient(135deg, #27ae60 0%, #1e8449 100%);
            color: #fff;
          }
          .print-controls .print-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(39,174,96,0.4);
          }
          .print-controls .back-btn {
            background: #f0f0f0;
            color: #333;
          }
          .print-controls .ctrl-hint {
            font-size: 11px;
            color: #888;
            margin-top: 10px;
            line-height: 1.4;
          }
        }
      `}</style>

      {/* Print Controls Panel */}
      <div className="print-controls">
        <h3>Trapper Assignment Sheet</h3>
        <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
          Dense 1-page layout{data.has_kittens ? " + kitten page" : ""}. Print via Ctrl+P.
        </p>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
        <a href={`/requests/${id}`} style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>Back to Request</button>
        </a>
        <a href={`/requests/${id}/print`} style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>Full Print View</button>
        </a>
        <div className="ctrl-hint">
          ID: {data.request_id.slice(0, 8)}
        </div>
      </div>

      {/* ═══════════════════ PAGE 1: Everything on one page ═══════════════════ */}
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>Trapper Assignment Sheet</h1>
            <div className="subtitle">Forgotten Felines of Sonoma County</div>
          </div>
          <div className="header-right">
            <div className={`priority-badge priority-${data.priority}`}>
              {data.priority}
            </div>
            <img src="/logo.png" alt="FFSC" className="header-logo" />
          </div>
        </div>

        {/* Trapper Assignment Bar */}
        <div className="trapper-header">
          <div className="trapper-names">
            {data.current_trappers && data.current_trappers.length > 0
              ? `Assigned: ${data.current_trappers.map(t => t.trapper_name).join(", ")}`
              : "Assigned: _______________________"}
          </div>
          <div className="trapper-date">
            {data.scheduled_date
              ? `Scheduled: ${formatDate(data.scheduled_date)}${data.scheduled_time_range ? ` (${data.scheduled_time_range})` : ""}`
              : "Scheduled: ______________"}
          </div>
        </div>

        {/* Urgency Alert */}
        {hasUrgencyAlert && (
          <div className="emergency-box">
            <div className="title">
              <span className="checkbox checked">✓</span>
              URGENT: {data.urgency_reasons?.map(r => formatValue(r)).join(", ")}
              {data.urgency_deadline && ` — Deadline: ${formatDate(data.urgency_deadline)}`}
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
            <div className={`field-input sm ${data.requester_name ? "prefilled" : ""}`} style={{ fontWeight: 600, fontSize: "10pt", marginBottom: "3px" }}>
              {data.requester_name || ""}
            </div>
            <div className={`field-input sm ${data.requester_phone ? "prefilled" : ""}`} style={{ marginBottom: "3px" }}>
              {data.requester_phone ? formatPhone(data.requester_phone) : ""}
              {data.requester_email ? ` | ${data.requester_email}` : ""}
            </div>
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
            <div className={`field-input sm ${data.place_address ? "prefilled" : ""}`} style={{ fontWeight: 600, fontSize: "10pt", marginBottom: "3px" }}>
              {data.place_address || data.place_name || ""}
            </div>
            <div className={`field-input sm ${data.place_city ? "prefilled" : ""}`} style={{ marginBottom: "3px" }}>
              {[data.place_city, "CA", data.place_postal_code].filter(Boolean).join(", ")}
            </div>
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

        {/* CATS section — dense single block */}
        <div className="section">
          <div className="section-title">Cats</div>
          <div className="options-row" style={{ marginBottom: "2px" }}>
            <span style={{ fontWeight: 700, fontSize: "11pt", marginRight: "6px" }}>
              {data.estimated_cat_count ?? "?"}
            </span>
            <span className="hint" style={{ marginRight: "8px" }}>
              ({data.count_confidence ? formatValue(data.count_confidence) : "unk"})
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
            {data.has_kittens && <span className="hint" style={{ marginLeft: "4px", color: "#27ae60", fontWeight: 600 }}>See pg 2</span>}
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
            <div className="field" style={{ marginBottom: "3px" }}>
              <label>Best contact times</label>
              <div className={`field-input sm ${data.best_contact_times ? "prefilled" : ""}`}>{data.best_contact_times || ""}</div>
            </div>
            <div className="field" style={{ marginBottom: "3px" }}>
              <label>Feeding time</label>
              <div className={`field-input sm ${data.feeding_time ? "prefilled" : ""}`}>{data.feeding_time || ""}</div>
            </div>
            <div className="field" style={{ marginBottom: "3px" }}>
              <label>Where cats eat</label>
              <div className={`field-input sm ${data.feeding_location ? "prefilled" : ""}`}>{data.feeding_location || ""}</div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Best trapping day/time</label>
              <div className={`field-input sm ${data.best_times_seen ? "prefilled" : ""}`}>{data.best_times_seen || ""}</div>
            </div>
          </div>
        </div>

        {data.access_notes && (
          <div className="info-card" style={{ fontSize: "8.5pt" }}>
            <strong>Access:</strong> {data.access_notes}
          </div>
        )}

        {/* Important Notes — single row of checkboxes */}
        <div className="warning-box">
          <div className="title">Important Notes</div>
          <div className="quick-notes">
            <div className="quick-note"><Check checked={hasWithholdFood} label="Withhold food" /></div>
            <div className="quick-note"><Check checked={hasOtherFeeders} label="Other feeders" /></div>
            <div className="quick-note"><Check checked={hasCrossPropLines} label="Cross prop lines" /></div>
            <div className="quick-note"><Check checked={hasPregnant} label="Pregnant" /></div>
            <div className="quick-note"><Check checked={hasInjured} label="Injured/sick" /></div>
            <div className="quick-note"><Check checked={hasCallerHelp} label="Caller help" /></div>
            <div className="quick-note"><Check checked={hasWildlife} label="Wildlife" /></div>
            <div className="quick-note"><Check checked={hasNeighborIssues} label="Neighbor" /></div>
            <div className="quick-note"><Check checked={hasUrgent} label="Urgent" /></div>
          </div>
        </div>

        {/* Notes area */}
        <div className="section">
          <div className="section-title">Notes</div>
          <div className={`field-input md ${(data.summary || data.notes) ? "prefilled" : ""}`} style={{ whiteSpace: "pre-wrap", fontSize: "9pt" }}>
            {data.summary}
            {data.summary && data.notes && "\n"}
            {data.notes}
          </div>
        </div>

        {/* Trapper Recon — condensed */}
        <div className="staff-box" style={{ background: "#fef3c7", borderColor: "#fcd34d", marginBottom: "6px" }}>
          <div className="section-title" style={{ color: "#92400e" }}>Trapper Recon (site visit)</div>
          <div className="field-row">
            <div className="field" style={{ flex: "0 0 70px" }}>
              <label>Count</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field" style={{ flex: "0 0 100px" }}>
              <label>A / K / Tipped</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Trap locations</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Cat descriptions</label>
              <div className="field-input sm"></div>
            </div>
          </div>
          <div className="options-row" style={{ marginTop: "3px", marginBottom: 0 }}>
            <span className="option"><span className="checkbox"></span> Dogs</span>
            <span className="option"><span className="checkbox"></span> Feeders</span>
            <span className="option"><span className="checkbox"></span> Wildlife</span>
            <span className="option"><span className="checkbox"></span> TrapSavvy</span>
            <span className="option"><span className="checkbox"></span> SafeON</span>
            <span className="option"><span className="checkbox"></span> Gate</span>
            <span className="option"><span className="checkbox"></span> DropTrap</span>
          </div>
        </div>

        {/* Trap Day Checklist — condensed */}
        <div className="section">
          <div className="section-title">Trap Day</div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="option"><span className="checkbox"></span> Food withheld</span>
            <span className="option"><span className="checkbox"></span> Contact notified</span>
            <span className="option"><span className="checkbox"></span> Clinic confirmed</span>
            <span className="option"><span className="checkbox"></span> Equip ready</span>
            <span style={{ marginLeft: "8px" }}>Set: ______</span>
            <span style={{ marginLeft: "8px" }}>#Traps: ____</span>
            <span style={{ marginLeft: "8px" }}>#Caught: ____</span>
            <span style={{ marginLeft: "8px" }}>Return: ______</span>
          </div>
        </div>

        {/* Footer */}
        <div className="page-footer">
          <span>Ref: {data.request_id.slice(0, 8)} | {formatValue(data.status)} | {formatDate(data.created_at)}</span>
          <span>Page 1 of {totalPages}</span>
        </div>
      </div>

      {/* ═══════════════════ PAGE 2: Kitten Details (only if has_kittens) ═══════════════════ */}
      {data.has_kittens && (
        <div className="print-page">
          <div className="print-header">
            <div>
              <h1>Kitten Details</h1>
              <div className="subtitle">
                {data.place_address || data.place_name || "Location"} &mdash; {data.requester_name || "Requester"}
              </div>
            </div>
            <img src="/logo.png" alt="FFSC" className="header-logo" />
          </div>

          {/* Kitten Info */}
          <div className="section">
            <div className="section-title">Kitten Information</div>
            <div className="field-row" style={{ alignItems: "center" }}>
              <div className="field" style={{ flex: "0 0 100px" }}>
                <label>How many?</label>
                <div className={`field-input sm ${data.kitten_count ? "prefilled" : ""}`} style={{ width: "50px" }}>
                  {data.kitten_count ?? ""}
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
                <Bubble filled={data.kitten_contained === "yes"} label="Yes" />
                <Bubble filled={data.kitten_contained === "some"} label="Some" />
                <Bubble filled={data.kitten_contained === "no"} label="No" />
                <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "75px" }}>Mom present?</span></span>
                <Bubble filled={data.mom_present === "yes"} label="Yes" />
                <Bubble filled={data.mom_present === "no"} label="No" />
                <Bubble filled={!data.mom_present || data.mom_present === "unsure"} label="Unsure" />
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "65px" }}>Mom fixed?</span>
                <Bubble filled={data.mom_fixed === "yes"} label="Yes" />
                <Bubble filled={data.mom_fixed === "no"} label="No" />
                <Bubble filled={!data.mom_fixed || data.mom_fixed === "unsure"} label="Unsure" />
                <span style={{ marginLeft: "12px" }}><span className="options-label" style={{ minWidth: "75px" }}>Can bring in?</span></span>
                <Bubble filled={data.can_bring_in === "yes"} label="Yes" />
                <Bubble filled={data.can_bring_in === "need_help"} label="Need help" />
                <Bubble filled={data.can_bring_in === "no"} label="No" />
              </div>
            </div>

            <div className="field" style={{ marginTop: "6px" }}>
              <label>Kitten details (colors, where they hide, feeding schedule)</label>
              <div className={`field-input md ${data.kitten_notes ? "prefilled" : ""}`}>
                {data.kitten_notes || ""}
              </div>
            </div>
          </div>

          {/* Reference contact */}
          <div className="field-row" style={{ marginTop: "8px" }}>
            <div className="field w2">
              <label>Contact (from page 1)</label>
              <div className={`field-input sm ${data.requester_name ? "prefilled" : ""}`}>
                {data.requester_name || ""}
                {data.requester_phone ? ` — ${formatPhone(data.requester_phone)}` : ""}
              </div>
            </div>
          </div>

          <div className="page-footer">
            <span>Ref: {data.request_id.slice(0, 8)} | Forgotten Felines of Sonoma County</span>
            <span>Page 2 of 2</span>
          </div>
        </div>
      )}
    </div>
  );
}
