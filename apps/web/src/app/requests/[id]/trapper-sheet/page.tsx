"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatPhone } from "@/lib/formatters";

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
  latitude: number | null;
  longitude: number | null;
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
  feeding_schedule: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
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
  // Trapper assignment
  trappers: Array<{
    person_id: string;
    display_name: string;
    trapper_type: string;
    assignment_type: string;
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

// Bubble component - shows filled if value matches
function Bubble({ filled, label }: { filled: boolean; label: string }) {
  return (
    <span className="option">
      <span className={`bubble ${filled ? "filled" : ""}`}></span> {label}
    </span>
  );
}

// Checkbox component - shows checked/crossed
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
        const response = await fetch(`/api/requests/${id}`);
        if (!response.ok) throw new Error("Failed to load request");
        const result = await response.json();
        if (result.success) {
          setData(result.data);
        } else {
          throw new Error(result.error?.message || "Failed to load request");
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

  // Split requester name
  const nameParts = (data.requester_name || "").split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

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
  const isNapa = county.includes("napa");

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

  // Ownership status
  const ownership = data.ownership_status?.toLowerCase() || "";
  const isOwner = ownership.includes("owner") || ownership.includes("yes");
  const isRenter = ownership.includes("rent");
  const isNeighbor = ownership.includes("neighbor");

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

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.4in; }
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
          .print-header { margin-bottom: 10px !important; }
          .section { margin-bottom: 10px !important; }
        }

        body { margin: 0; padding: 0; }

        .print-wrapper {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 10pt;
          line-height: 1.3;
          color: #2c3e50;
        }

        .print-page {
          width: 8.5in;
          height: 10.2in;
          padding: 0.4in;
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
          padding-bottom: 8px;
          margin-bottom: 12px;
          border-bottom: 3px solid #27ae60;
        }

        .print-header h1 {
          font-size: 16pt;
          margin: 0;
          color: #27ae60;
        }

        .print-header .subtitle {
          font-size: 9pt;
          color: #7f8c8d;
          margin-top: 2px;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .header-logo {
          height: 42px;
          width: auto;
        }

        .priority-badge {
          padding: 4px 12px;
          border-radius: 4px;
          font-weight: 700;
          font-size: 10pt;
          text-transform: uppercase;
        }

        .priority-urgent { background: #dc2626; color: #fff; }
        .priority-high { background: #ea580c; color: #fff; }
        .priority-normal { background: #16a34a; color: #fff; }
        .priority-low { background: #6b7280; color: #fff; }

        .section {
          margin-bottom: 12px;
        }

        .section-title {
          font-size: 11pt;
          color: #27ae60;
          border-bottom: 1.5px solid #ecf0f1;
          padding-bottom: 3px;
          margin-bottom: 8px;
        }

        .field-row {
          display: flex;
          gap: 12px;
          margin-bottom: 8px;
        }

        .field {
          flex: 1;
          min-width: 0;
        }

        .field.w2 { flex: 2; }
        .field.w3 { flex: 3; }
        .field.w4 { flex: 4; }
        .field.half { flex: 0.5; }

        .field label {
          display: block;
          font-size: 8pt;
          font-weight: 600;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 2px;
        }

        .field-input {
          border: 1px solid #bdc3c7;
          border-radius: 4px;
          padding: 6px 8px;
          min-height: 28px;
          background: #fff;
          font-size: 10pt;
        }

        .field-input.prefilled {
          background: #f0fdf4;
          color: #2c3e50;
        }

        .field-input.sm { min-height: 26px; padding: 5px 7px; }
        .field-input.md { min-height: 55px; }
        .field-input.lg { min-height: 80px; }
        .field-input.xl { min-height: 110px; }

        .options-row {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 9.5pt;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }

        .options-label {
          font-weight: 600;
          color: #2c3e50;
          min-width: 90px;
          font-size: 9.5pt;
        }

        .option {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-right: 12px;
        }

        .bubble {
          width: 13px;
          height: 13px;
          border: 1.5px solid #27ae60;
          border-radius: 50%;
          background: #fff;
          flex-shrink: 0;
        }

        .bubble.filled {
          background: #27ae60;
        }

        .checkbox {
          width: 13px;
          height: 13px;
          border: 1.5px solid #27ae60;
          border-radius: 2px;
          background: #fff;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 9pt;
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
          gap: 16px;
        }

        .info-box {
          background: #f0fdf4;
          border: 1.5px solid #86efac;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 10px;
        }

        .info-box .title {
          font-weight: 600;
          color: #166534;
          margin-bottom: 5px;
          font-size: 9.5pt;
        }

        .info-card {
          background: #f8f9fa;
          border-radius: 6px;
          padding: 6px 10px;
          margin-bottom: 8px;
          border-left: 3px solid #27ae60;
        }

        .warning-box {
          background: #fef3c7;
          border: 1.5px solid #fcd34d;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 10px;
        }

        .warning-box .title {
          font-weight: 600;
          color: #92400e;
          margin-bottom: 5px;
          font-size: 9.5pt;
        }

        .staff-box {
          border: 1.5px dashed #94a3b8;
          border-radius: 6px;
          padding: 10px 12px;
          margin-top: 10px;
          background: #f8fafc;
        }

        .staff-box .section-title {
          color: #7f8c8d;
          border-bottom-color: #bdc3c7;
        }

        .quick-notes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }

        .quick-note {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 9pt;
          padding: 2px 0;
        }

        .emergency-box {
          border: 1.5px solid #e74c3c;
          background: #fdedec;
          padding: 6px 10px;
          margin-bottom: 10px;
          border-radius: 6px;
        }

        .emergency-box .title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          color: #e74c3c;
          font-size: 9.5pt;
        }

        .emergency-box .checkbox {
          border-color: #e74c3c;
        }

        .emergency-box .checkbox.checked {
          background: #e74c3c;
          border-color: #e74c3c;
        }

        .page-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 6px;
          margin-top: auto;
          border-top: 1px solid #ecf0f1;
          font-size: 8pt;
          color: #95a5a6;
        }

        .date-field {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 10pt;
        }

        .date-field .field-input {
          width: 100px;
          display: inline-block;
        }

        .hint {
          font-size: 7.5pt;
          color: #95a5a6;
          margin-left: 3px;
        }

        .trapper-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #166534;
          color: #fff;
          padding: 6px 12px;
          border-radius: 6px;
          margin-bottom: 10px;
        }

        .trapper-header .trapper-names {
          font-size: 12pt;
          font-weight: 600;
        }

        .trapper-header .trapper-date {
          font-size: 10pt;
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
          Pre-filled from request data. Print front &amp; back.
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

      {/* ═══════════════════ PAGE 1: Contact, Location & Cats ═══════════════════ */}
      <div className="print-page">
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

        {/* Trapper Assignment Header */}
        <div className="trapper-header">
          <div className="trapper-names">
            {data.trappers && data.trappers.length > 0
              ? `Assigned: ${data.trappers.map(t => t.display_name).join(", ")}`
              : "Assigned: _______________________"}
          </div>
          <div className="trapper-date">
            {data.scheduled_date
              ? `Scheduled: ${formatDate(data.scheduled_date)}${data.scheduled_time_range ? ` (${data.scheduled_time_range})` : ""}`
              : "Scheduled: ______________"}
          </div>
        </div>

        {/* Urgency Alert */}
        {(data.urgency_reasons && data.urgency_reasons.length > 0) || data.has_medical_concerns ? (
          <div className="emergency-box">
            <div className="title">
              <span className="checkbox checked">✓</span>
              URGENT SITUATION
              <span className="hint">
                {data.urgency_reasons?.map(r => formatValue(r)).join(" | ")}
                {data.urgency_deadline && ` (Deadline: ${formatDate(data.urgency_deadline)})`}
              </span>
            </div>
            {data.has_medical_concerns && data.medical_description && (
              <div style={{ marginTop: "4px", fontSize: "9pt" }}>
                <strong>Medical:</strong> {data.medical_description}
              </div>
            )}
          </div>
        ) : null}

        {/* Contact Information */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="field-row">
            <div className="field">
              <label>First Name</label>
              <div className={`field-input sm ${firstName ? "prefilled" : ""}`}>{firstName}</div>
            </div>
            <div className="field">
              <label>Last Name</label>
              <div className={`field-input sm ${lastName ? "prefilled" : ""}`}>{lastName}</div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className={`field-input sm ${data.requester_phone ? "prefilled" : ""}`}>
                {data.requester_phone ? formatPhone(data.requester_phone) : ""}
              </div>
            </div>
            <div className="field w2">
              <label>Email</label>
              <div className={`field-input sm ${data.requester_email ? "prefilled" : ""}`}>{data.requester_email || ""}</div>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "100px" }}>Preferred contact:</span>
            <Bubble filled={data.preferred_contact_method === "call"} label="Call" />
            <Bubble filled={data.preferred_contact_method === "text"} label="Text" />
            <Bubble filled={data.preferred_contact_method === "email"} label="Email" />
            {data.property_owner_contact && (
              <span style={{ marginLeft: "10px" }}>Property owner: <strong>{data.property_owner_contact}</strong></span>
            )}
          </div>
        </div>

        {/* Cat Location */}
        <div className="section">
          <div className="section-title">Where Are the Cats?</div>
          <div className="field-row">
            <div className="field w3">
              <label>Street Address</label>
              <div className={`field-input sm ${data.place_address ? "prefilled" : ""}`}>{data.place_address || data.place_name || ""}</div>
            </div>
            <div className="field">
              <label>City</label>
              <div className={`field-input sm ${data.place_city ? "prefilled" : ""}`}>{data.place_city || ""}</div>
            </div>
            <div className="field half">
              <label>ZIP</label>
              <div className={`field-input sm ${data.place_postal_code ? "prefilled" : ""}`}>{data.place_postal_code || ""}</div>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: "4px" }}>
            <span className="options-label" style={{ minWidth: "55px" }}>County:</span>
            <Bubble filled={isSonoma} label="Sonoma" />
            <Bubble filled={isMarin} label="Marin" />
            <Bubble filled={isNapa} label="Napa" />
            <Bubble filled={!isSonoma && !isMarin && !isNapa && !!county} label={`Other: ${county || "____"}`} />
            <span style={{ marginLeft: "20px" }}><span className="options-label" style={{ minWidth: "60px" }}>Property:</span></span>
            <Bubble filled={isHouse} label="House" />
            <Bubble filled={isApt} label="Apt" />
            <Bubble filled={isBusiness} label="Business" />
            <Bubble filled={isRural} label="Rural" />
          </div>
          {data.location_description && (
            <div className="info-card" style={{ marginTop: "4px" }}>
              <strong>Location notes:</strong> {data.location_description}
            </div>
          )}
          {data.latitude && data.longitude && (
            <div style={{ fontSize: "8pt", color: "#9ca3af" }}>
              GPS: {data.latitude.toFixed(5)}, {data.longitude.toFixed(5)}
            </div>
          )}
        </div>

        {/* About the Cats */}
        <div className="section">
          <div className="section-title">About the Cats</div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
            <div className="field" style={{ flex: "0 0 110px" }}>
              <label>How many cats?</label>
              <div className={`field-input sm ${data.estimated_cat_count ? "prefilled" : ""}`} style={{ width: "60px" }}>
                {data.estimated_cat_count ?? ""}
              </div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Eartipped:</span>
              <Bubble filled={data.eartip_count === 0} label="None" />
              <Bubble filled={data.eartip_count !== null && data.eartip_count > 0 && data.eartip_count < (data.estimated_cat_count || 99)} label={`Some (${data.eartip_count ?? "?"})`} />
              <Bubble filled={data.eartip_count !== null && data.eartip_count >= (data.estimated_cat_count || 1)} label="Most/All" />
              <Bubble filled={data.eartip_count === null} label="Unknown" />
            </div>
          </div>

          {/* Feeding info card */}
          <div className="info-card">
            <div className="options-row" style={{ marginBottom: "2px" }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Feed them?</span>
              <Bubble filled={data.is_being_fed === true} label="Yes" />
              <Bubble filled={data.is_being_fed === false} label="No" />
              {data.feeder_name && <span style={{ marginLeft: "10px" }}>Feeder: <strong>{data.feeder_name}</strong></span>}
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Colony age:</span>
              <Bubble filled={durationLessThanMonth} label="<1 mo" />
              <Bubble filled={duration1to6} label="1-6 mo" />
              <Bubble filled={duration6to2} label="6mo-2yr" />
              <Bubble filled={duration2plus} label="2+ yrs" />
              {data.feeding_schedule && <span style={{ marginLeft: "10px" }}>Schedule: <strong>{data.feeding_schedule}</strong></span>}
            </div>
          </div>

          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "80px" }}>Kittens?</span>
            <Bubble filled={data.has_kittens === true} label="Yes" />
            <Bubble filled={data.has_kittens === false} label="No" />
            {data.has_kittens && data.kitten_count && <span style={{ marginLeft: "8px" }}>Count: <strong>{data.kitten_count}</strong></span>}
            <span className="hint" style={{ marginLeft: "10px", color: "#27ae60", fontWeight: 600 }}>
              If yes, see Page 2
            </span>
          </div>
        </div>

        {/* Additional Details */}
        <div className="section">
          <div className="section-title">Additional Details</div>
          <div className="options-row" style={{ marginBottom: "4px" }}>
            <Check checked={data.has_medical_concerns} label="Medical concerns" />
            <Check checked={data.permission_status === "granted"} crossed={data.permission_status === "denied"} label="Access available" />
            <Check checked={isOwner} label="Property owner" />
            <Check checked={hasOtherFeeders} label="Others also feeding" />
          </div>
          {(data.summary || data.notes) && (
            <div className="field-input lg" style={{ whiteSpace: "pre-wrap" }}>
              {data.summary}
              {data.summary && data.notes && "\n"}
              {data.notes}
            </div>
          )}
          {!data.summary && !data.notes && <div className="field-input lg"></div>}
        </div>

        {/* Staff/Office Section */}
        <div className="staff-box">
          <div className="section-title">Request Info (Reference)</div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "4px" }}>
            <div className="field" style={{ flex: "0 0 130px" }}>
              <label>Date received</label>
              <div className="field-input sm prefilled">{formatDate(data.created_at)}</div>
            </div>
            <div className="field" style={{ flex: "0 0 130px" }}>
              <label>Status</label>
              <div className="field-input sm prefilled">{formatValue(data.status)}</div>
            </div>
            <div className="field" style={{ flex: "0 0 120px" }}>
              <label>Request ID</label>
              <div className="field-input sm prefilled" style={{ fontSize: "8pt" }}>{data.request_id.slice(0, 8)}</div>
            </div>
            <div className="field">
              <label>Count Confidence</label>
              <div className={`field-input sm ${data.count_confidence ? "prefilled" : ""}`}>{formatValue(data.count_confidence) || ""}</div>
            </div>
          </div>
        </div>

        <div className="page-footer">
          <span>Forgotten Felines of Sonoma County &bull; (707) 576-7999 &bull; forgottenfelines.org</span>
          <span>Page 1 of 2</span>
        </div>
      </div>

      {/* ═══════════════════ PAGE 2: Access, Trapping & Kittens ═══════════════════ */}
      <div className="print-page">
        <div className="print-header">
          <div>
            <h1>Trapping &amp; Kitten Details</h1>
            <div className="subtitle">
              {data.place_address || data.place_name || "Location"} &mdash; {data.requester_name || "Requester"}
            </div>
          </div>
          <img src="/logo.png" alt="FFSC" className="header-logo" />
        </div>

        {/* Requester reference */}
        <div className="field-row" style={{ marginBottom: "10px" }}>
          <div className="field w2">
            <label>Caller Name (from page 1)</label>
            <div className={`field-input sm ${data.requester_name ? "prefilled" : ""}`}>{data.requester_name || ""}</div>
          </div>
          <div className="field">
            <label>Phone</label>
            <div className={`field-input sm ${data.requester_phone ? "prefilled" : ""}`}>
              {data.requester_phone ? formatPhone(data.requester_phone) : ""}
            </div>
          </div>
        </div>

        {/* Property Access & Logistics */}
        <div className="section">
          <div className="section-title">Property Access &amp; Logistics</div>
          <div className="two-col">
            <div>
              <div className="options-row">
                <span className="options-label">Property access?</span>
                <Bubble filled={data.permission_status === "granted"} label="Yes" />
                <Bubble filled={data.permission_status === "pending"} label="Need perm" />
                <Bubble filled={data.permission_status === "denied"} label="No" />
              </div>
              <div className="options-row">
                <span className="options-label">Caller is owner?</span>
                <Bubble filled={isOwner} label="Yes" />
                <Bubble filled={isRenter} label="Renter" />
                <Bubble filled={isNeighbor} label="Neighbor" />
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label">Dogs on site?</span>
                <Bubble filled={data.dogs_on_site === "yes"} label="Yes" />
                <Bubble filled={data.dogs_on_site === "no"} label="No" />
                <span className="hint">(containable?)</span>
              </div>
            </div>
            <div>
              <div className="options-row">
                <span className="options-label">Trap-savvy?</span>
                <Bubble filled={data.trap_savvy === "yes"} label="Yes" />
                <Bubble filled={data.trap_savvy === "no"} label="No" />
                <Bubble filled={!data.trap_savvy || data.trap_savvy === "unknown"} label="Unknown" />
              </div>
              <div className="options-row">
                <span className="options-label">Previous TNR?</span>
                <Bubble filled={data.previous_tnr === "yes"} label="Yes" />
                <Bubble filled={data.previous_tnr === "no"} label="No" />
                <Bubble filled={data.previous_tnr === "partial"} label="Partial" />
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label">Handleable?</span>
                <Bubble filled={isFriendly} label="Carrier OK" />
                <Bubble filled={isTrapNeeded} label="Trap needed" />
                <Bubble filled={isMixed} label="Mixed" />
              </div>
            </div>
          </div>
          <div className="field" style={{ marginTop: "6px" }}>
            <label>Access notes (gate codes, parking, hazards)</label>
            <div className={`field-input sm ${data.access_notes ? "prefilled" : ""}`}>{data.access_notes || ""}</div>
          </div>
        </div>

        {/* Feeding & Trapping Schedule */}
        <div className="info-box">
          <div className="title">Best Trapping Times</div>
          <div className="field-row" style={{ marginBottom: "6px" }}>
            <div className="field">
              <label>Who feeds?</label>
              <div className={`field-input sm ${data.feeder_name ? "prefilled" : ""}`}>{data.feeder_name || ""}</div>
            </div>
            <div className="field">
              <label>Feed time?</label>
              <div className={`field-input sm ${data.feeding_schedule ? "prefilled" : ""}`}>{data.feeding_schedule || ""}</div>
            </div>
            <div className="field">
              <label>Where do cats eat?</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Best trapping day/time</label>
              <div className={`field-input sm ${data.best_times_seen ? "prefilled" : ""}`}>{data.best_times_seen || ""}</div>
            </div>
          </div>
        </div>

        {/* Important Notes */}
        <div className="warning-box">
          <div className="title">Important Notes (check all that apply)</div>
          <div className="quick-notes">
            <div className="quick-note"><Check checked={hasWithholdFood} label="Withhold food 24hr before" /></div>
            <div className="quick-note"><Check checked={hasOtherFeeders} label="Other feeders in area" /></div>
            <div className="quick-note"><Check checked={hasCrossPropLines} label="Cats cross property lines" /></div>
            <div className="quick-note"><Check checked={hasPregnant} label="Pregnant cat suspected" /></div>
            <div className="quick-note"><Check checked={hasInjured} label="Injured/sick cat priority" /></div>
            <div className="quick-note"><Check checked={hasCallerHelp} label="Caller can help trap" /></div>
            <div className="quick-note"><Check checked={hasWildlife} label="Wildlife concerns" /></div>
            <div className="quick-note"><Check checked={hasNeighborIssues} label="Neighbor issues" /></div>
            <div className="quick-note"><Check checked={hasUrgent} label="Urgent / time-sensitive" /></div>
          </div>
        </div>

        {/* Kitten Section */}
        <div className="section">
          <div className="section-title">Kitten Information</div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
            <div className="field" style={{ flex: "0 0 120px" }}>
              <label>How many kittens?</label>
              <div className={`field-input sm ${data.kitten_count ? "prefilled" : ""}`} style={{ width: "60px" }}>
                {data.kitten_count ?? ""}
              </div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Age range:</span>
              <Bubble filled={kittenUnder4} label="Under 4 wks" />
              <Bubble filled={kitten4to8} label="4-8 wks" />
              <Bubble filled={kitten8to12} label="8-12 wks" />
              <Bubble filled={kitten12to16} label="12-16 wks" />
              <Bubble filled={kitten4plus} label="4+ months" />
            </div>
          </div>

          <div className="options-row" style={{ marginBottom: "6px" }}>
            <span className="options-label" style={{ minWidth: "70px" }}>Behavior:</span>
            <Bubble filled={isFriendly && data.has_kittens} label="Friendly" />
            <Bubble filled={false} label="Shy but handleable" />
            <Bubble filled={isTrapNeeded && data.has_kittens} label="Feral / hissy" />
            <Bubble filled={!isFriendly && !isTrapNeeded && data.has_kittens} label="Unknown" />
          </div>

          <div className="info-card" style={{ marginBottom: "8px" }}>
            <div className="options-row" style={{ marginBottom: "3px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Contained?</span>
              <Bubble filled={false} label="Yes" />
              <Bubble filled={false} label="Some" />
              <Bubble filled={false} label="No" />
              <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Mom present?</span></span>
              <Bubble filled={false} label="Yes" />
              <Bubble filled={false} label="No" />
              <Bubble filled={false} label="Unsure" />
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Mom fixed?</span>
              <Bubble filled={false} label="Yes" />
              <Bubble filled={false} label="No" />
              <Bubble filled={false} label="Unsure" />
              <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Can bring in?</span></span>
              <Bubble filled={false} label="Yes" />
              <Bubble filled={false} label="Need help" />
              <Bubble filled={false} label="No" />
            </div>
          </div>

          <div className="field">
            <label>Kitten details (colors, where they hide, feeding schedule)</label>
            <div className="field-input md"></div>
          </div>
        </div>

        {/* Trapper Recon Section */}
        <div className="staff-box" style={{ background: "#fef3c7", borderColor: "#fcd34d" }}>
          <div className="section-title" style={{ color: "#92400e" }}>Trapper Recon (fill during site visit)</div>
          <div className="field-row">
            <div className="field">
              <label>Verified Cat Count</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Adults / Kittens / Eartipped</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Best Trap Locations</label>
              <div className="field-input sm"></div>
            </div>
          </div>
          <div className="field" style={{ marginTop: "6px" }}>
            <label>Cat Descriptions (colors, markings, pregnant)</label>
            <div className="field-input sm"></div>
          </div>
          <div className="options-row" style={{ marginTop: "6px" }}>
            <span className="option"><span className="checkbox"></span> Dogs present</span>
            <span className="option"><span className="checkbox"></span> Other feeders</span>
            <span className="option"><span className="checkbox"></span> Wildlife</span>
            <span className="option"><span className="checkbox"></span> Trap-savvy cats</span>
            <span className="option"><span className="checkbox"></span> Safe overnight</span>
            <span className="option"><span className="checkbox"></span> Gate code needed</span>
            <span className="option"><span className="checkbox"></span> Need drop traps</span>
          </div>
        </div>

        {/* Trap Day Checklist */}
        <div className="section" style={{ marginTop: "8px" }}>
          <div className="section-title">Trap Day Checklist</div>
          <div className="options-row">
            <span className="option"><span className="checkbox"></span> Withhold food 24hr</span>
            <span className="option"><span className="checkbox"></span> Contact notified</span>
            <span className="option"><span className="checkbox"></span> Clinic slot confirmed</span>
            <span className="option"><span className="checkbox"></span> Equipment ready</span>
            <span style={{ marginLeft: "16px" }}>Traps set: ______</span>
            <span style={{ marginLeft: "12px" }}># Traps: ____</span>
            <span style={{ marginLeft: "12px" }}># Caught: ____</span>
            <span style={{ marginLeft: "12px" }}>Return: ________</span>
          </div>
        </div>

        <div className="page-footer">
          <span>Forgotten Felines of Sonoma County &bull; forgottenfelines.org</span>
          <span>Page 2 of 2</span>
        </div>
      </div>
    </div>
  );
}
