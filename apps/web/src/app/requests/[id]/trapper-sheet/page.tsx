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

function getPriorityStyle(priority: string): { bg: string; color: string } {
  const styles: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#dc2626", color: "#fff" },
    high: { bg: "#ea580c", color: "#fff" },
    normal: { bg: "#16a34a", color: "#fff" },
    low: { bg: "#6b7280", color: "#fff" }
  };
  return styles[priority] || styles.normal;
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

  const priorityStyle = getPriorityStyle(data.priority);

  return (
    <div className="trapper-sheet">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.4in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-controls { display: none !important; }
          .sheet-page { box-shadow: none !important; margin: 0 !important; }
        }

        body { margin: 0; padding: 0; }

        .trapper-sheet {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 9pt;
          line-height: 1.3;
          color: #1f2937;
        }

        .sheet-page {
          width: 8.5in;
          min-height: 10.5in;
          padding: 0.4in;
          box-sizing: border-box;
          background: #fff;
        }

        h1, h2, .section-header {
          font-family: 'Raleway', Helvetica, sans-serif;
          font-weight: 700;
        }

        /* Header */
        .sheet-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #166534;
          padding-bottom: 8px;
          margin-bottom: 10px;
        }

        .sheet-header h1 {
          font-size: 16pt;
          margin: 0;
          color: #166534;
        }

        .sheet-header .subtitle {
          font-size: 9pt;
          color: #6b7280;
          margin-top: 2px;
        }

        .priority-badge {
          padding: 6px 14px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 10pt;
          text-transform: uppercase;
        }

        /* Info strips */
        .info-strip {
          display: flex;
          gap: 20px;
          background: #f3f4f6;
          padding: 8px 12px;
          border-radius: 6px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }

        .info-strip-item {
          display: flex;
          gap: 4px;
          font-size: 9pt;
        }

        .info-strip-item .label {
          color: #6b7280;
        }

        .info-strip-item .value {
          font-weight: 600;
          color: #1f2937;
        }

        /* Two column layout */
        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        /* Sections */
        .section {
          margin-bottom: 10px;
        }

        .section-header {
          font-size: 10pt;
          color: #166534;
          border-bottom: 2px solid #d1fae5;
          padding-bottom: 3px;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .section-icon {
          font-size: 12pt;
        }

        /* Cards */
        .card {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 8px 10px;
        }

        .card-accent {
          border-left: 3px solid #166534;
        }

        .card-warning {
          background: #fef3c7;
          border-color: #fcd34d;
          border-left: 3px solid #f59e0b;
        }

        /* Info grid */
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 12px;
        }

        .info-row {
          display: flex;
          gap: 4px;
        }

        .info-label {
          font-size: 8pt;
          color: #6b7280;
          min-width: 70px;
        }

        .info-value {
          font-size: 9pt;
          font-weight: 500;
        }

        .info-value.large {
          font-size: 12pt;
          font-weight: 700;
        }

        /* Checklist */
        .checklist {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 3px 12px;
        }

        .check-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 9pt;
        }

        .checkbox {
          width: 14px;
          height: 14px;
          border: 1.5px solid #9ca3af;
          border-radius: 3px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10pt;
          flex-shrink: 0;
        }

        .checkbox.checked {
          background: #166534;
          border-color: #166534;
          color: #fff;
        }

        .checkbox.crossed {
          color: #dc2626;
          border-color: #dc2626;
        }

        /* Write-in fields */
        .write-field {
          border-bottom: 1px solid #d1d5db;
          min-height: 18px;
          margin-top: 2px;
        }

        .write-field.tall {
          min-height: 40px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 4px;
        }

        .write-label {
          font-size: 8pt;
          color: #6b7280;
          margin-top: 6px;
        }

        /* Pre-filled values */
        .prefilled {
          background: #ecfdf5;
          padding: 2px 6px;
          border-radius: 3px;
          font-weight: 500;
        }

        /* Notes area */
        .notes-box {
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 6px 8px;
          min-height: 50px;
          font-size: 9pt;
        }

        /* Recon section */
        .recon-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .recon-box {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 8px;
        }

        .recon-title {
          font-size: 8pt;
          font-weight: 600;
          color: #374151;
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        /* Footer */
        .sheet-footer {
          margin-top: auto;
          padding-top: 8px;
          border-top: 1px solid #e5e7eb;
          font-size: 7pt;
          color: #9ca3af;
          display: flex;
          justify-content: space-between;
        }

        /* Screen controls */
        @media screen {
          body { background: #e5e7eb !important; }
          .trapper-sheet { padding: 20px; }
          .sheet-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin: 0 auto;
            border-radius: 8px;
          }
          .print-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 1000;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 10px 16px;
            margin-bottom: 8px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          }
          .print-controls .btn-print {
            background: linear-gradient(135deg, #166534 0%, #14532d 100%);
            color: #fff;
          }
          .print-controls .btn-back {
            background: #f3f4f6;
            color: #374151;
          }
        }
      `}</style>

      {/* Screen Controls */}
      <div className="print-controls">
        <button className="btn-print" onClick={() => window.print()}>Print Sheet</button>
        <a href={`/requests/${id}`} style={{ textDecoration: "none" }}>
          <button className="btn-back" style={{ width: "100%" }}>Back to Request</button>
        </a>
        <a href={`/requests/${id}/print`} style={{ textDecoration: "none" }}>
          <button className="btn-back" style={{ width: "100%", marginTop: "4px" }}>Full Print View</button>
        </a>
      </div>

      {/* Main Sheet */}
      <div className="sheet-page">
        {/* Header */}
        <div className="sheet-header">
          <div>
            <h1>Trapper Assignment Sheet</h1>
            <div className="subtitle">
              {data.place_address || data.place_name || "Location TBD"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="priority-badge" style={{ background: priorityStyle.bg, color: priorityStyle.color }}>
              {data.priority}
            </div>
            <div style={{ fontSize: "8pt", color: "#6b7280", marginTop: "4px" }}>
              ID: {data.request_id.slice(0, 8)}
            </div>
          </div>
        </div>

        {/* Quick Info Strip */}
        <div className="info-strip">
          <div className="info-strip-item">
            <span className="label">Created:</span>
            <span className="value">{formatDate(data.created_at)}</span>
          </div>
          {data.scheduled_date && (
            <div className="info-strip-item">
              <span className="label">Scheduled:</span>
              <span className="value">{formatDate(data.scheduled_date)} {data.scheduled_time_range && `(${data.scheduled_time_range})`}</span>
            </div>
          )}
          <div className="info-strip-item">
            <span className="label">Status:</span>
            <span className="value">{formatValue(data.status)}</span>
          </div>
          {data.trappers && data.trappers.length > 0 && (
            <div className="info-strip-item">
              <span className="label">Assigned:</span>
              <span className="value">{data.trappers.map(t => t.display_name).join(", ")}</span>
            </div>
          )}
        </div>

        {/* Urgency Alert */}
        {data.urgency_reasons && data.urgency_reasons.length > 0 && (
          <div className="card card-warning" style={{ marginBottom: "10px" }}>
            <strong style={{ color: "#92400e" }}>URGENCY:</strong>{" "}
            {data.urgency_reasons.map(r => formatValue(r)).join(" | ")}
            {data.urgency_deadline && <span> (Deadline: {formatDate(data.urgency_deadline)})</span>}
          </div>
        )}

        {/* Two Column Layout */}
        <div className="two-col">
          {/* Left Column */}
          <div>
            {/* Contact */}
            <div className="section">
              <div className="section-header">
                <span className="section-icon">📞</span> Contact
              </div>
              <div className="card card-accent">
                <div className="info-grid">
                  <div className="info-row">
                    <span className="info-label">Name:</span>
                    <span className="info-value large">{data.requester_name || "—"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Phone:</span>
                    <span className="info-value">{data.requester_phone ? formatPhone(data.requester_phone) : "—"}</span>
                  </div>
                  <div className="info-row" style={{ gridColumn: "span 2" }}>
                    <span className="info-label">Email:</span>
                    <span className="info-value">{data.requester_email || "—"}</span>
                  </div>
                  {data.preferred_contact_method && (
                    <div className="info-row">
                      <span className="info-label">Preferred:</span>
                      <span className="info-value">{formatValue(data.preferred_contact_method)}</span>
                    </div>
                  )}
                  {data.property_owner_contact && (
                    <div className="info-row" style={{ gridColumn: "span 2" }}>
                      <span className="info-label">Owner:</span>
                      <span className="info-value">{data.property_owner_contact}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="section">
              <div className="section-header">
                <span className="section-icon">📍</span> Location
              </div>
              <div className="card">
                <div className="info-value large" style={{ marginBottom: "4px" }}>
                  {data.place_address || data.place_name || "—"}
                </div>
                <div style={{ fontSize: "9pt", color: "#6b7280" }}>
                  {data.place_city}{data.place_postal_code && `, ${data.place_postal_code}`}
                </div>
                {data.property_type && (
                  <div style={{ marginTop: "4px" }}>
                    <span className="info-label">Type:</span> <span className="prefilled">{formatValue(data.property_type)}</span>
                  </div>
                )}
                {data.latitude && data.longitude && (
                  <div style={{ marginTop: "4px", fontSize: "8pt", color: "#9ca3af" }}>
                    GPS: {data.latitude.toFixed(5)}, {data.longitude.toFixed(5)}
                  </div>
                )}
              </div>
              {data.location_description && (
                <div className="notes-box" style={{ marginTop: "6px" }}>
                  {data.location_description}
                </div>
              )}
            </div>

            {/* Access */}
            <div className="section">
              <div className="section-header">
                <span className="section-icon">🚪</span> Access & Logistics
              </div>
              <div className="checklist">
                <div className="check-item">
                  <span className={`checkbox ${data.permission_status === "granted" ? "checked" : data.permission_status === "denied" ? "crossed" : ""}`}>
                    {data.permission_status === "granted" ? "✓" : data.permission_status === "denied" ? "✗" : ""}
                  </span>
                  Permission granted
                </div>
                <div className="check-item">
                  <span className={`checkbox ${data.traps_overnight_safe === true ? "checked" : data.traps_overnight_safe === false ? "crossed" : ""}`}>
                    {data.traps_overnight_safe === true ? "✓" : data.traps_overnight_safe === false ? "✗" : ""}
                  </span>
                  Traps safe overnight
                </div>
                <div className="check-item">
                  <span className={`checkbox ${data.access_without_contact === true ? "checked" : data.access_without_contact === false ? "crossed" : ""}`}>
                    {data.access_without_contact === true ? "✓" : data.access_without_contact === false ? "✗" : ""}
                  </span>
                  Access w/o calling
                </div>
                <div className="check-item">
                  <span className={`checkbox ${data.dogs_on_site === "yes" ? "checked" : data.dogs_on_site === "no" ? "crossed" : ""}`}>
                    {data.dogs_on_site === "yes" ? "✓" : data.dogs_on_site === "no" ? "✗" : ""}
                  </span>
                  Dogs on property
                </div>
              </div>
              {data.access_notes && (
                <div className="notes-box" style={{ marginTop: "6px" }}>
                  <strong>Access notes:</strong> {data.access_notes}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div>
            {/* Cat Info */}
            <div className="section">
              <div className="section-header">
                <span className="section-icon">🐱</span> Cat Information
              </div>
              <div className="card">
                <div className="info-grid">
                  <div className="info-row">
                    <span className="info-label">Est. Count:</span>
                    <span className="info-value large">{data.estimated_cat_count ?? "?"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Eartipped:</span>
                    <span className="info-value">{data.eartip_count ?? "?"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Handleability:</span>
                    <span className="info-value">
                      {data.handleability ? formatValue(data.handleability) : data.cats_are_friendly === true ? "Friendly" : data.cats_are_friendly === false ? "Not Friendly" : "Unknown"}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Kittens:</span>
                    <span className="info-value">
                      {data.has_kittens ? `Yes${data.kitten_count ? ` (${data.kitten_count})` : ""}` : "No"}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Fixed status:</span>
                    <span className="info-value">{data.fixed_status ? formatValue(data.fixed_status) : "Unknown"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Trap-savvy:</span>
                    <span className="info-value">{data.trap_savvy ? formatValue(data.trap_savvy) : "Unknown"}</span>
                  </div>
                  {data.previous_tnr && (
                    <div className="info-row" style={{ gridColumn: "span 2" }}>
                      <span className="info-label">Previous TNR:</span>
                      <span className="info-value">{formatValue(data.previous_tnr)}</span>
                    </div>
                  )}
                  {data.colony_duration && (
                    <div className="info-row" style={{ gridColumn: "span 2" }}>
                      <span className="info-label">Colony age:</span>
                      <span className="info-value">{formatValue(data.colony_duration)}</span>
                    </div>
                  )}
                  {data.count_confidence && (
                    <div className="info-row" style={{ gridColumn: "span 2" }}>
                      <span className="info-label">Count confidence:</span>
                      <span className="info-value">{formatValue(data.count_confidence)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Feeding */}
            <div className="section">
              <div className="section-header">
                <span className="section-icon">🍽️</span> Feeding & Timing
              </div>
              <div className="card" style={{ background: "#ecfdf5" }}>
                <div className="info-grid">
                  <div className="info-row">
                    <span className="info-label">Being fed:</span>
                    <span className="info-value">{data.is_being_fed ? "Yes" : data.is_being_fed === false ? "No" : "?"}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Feeder:</span>
                    <span className="info-value">{data.feeder_name || "—"}</span>
                  </div>
                  <div className="info-row" style={{ gridColumn: "span 2" }}>
                    <span className="info-label">Schedule:</span>
                    <span className="info-value">{data.feeding_schedule || "—"}</span>
                  </div>
                  <div className="info-row" style={{ gridColumn: "span 2" }}>
                    <span className="info-label">Best times:</span>
                    <span className="info-value">{data.best_times_seen || "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes from request */}
            {(data.summary || data.notes) && (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">📝</span> Request Notes
                </div>
                <div className="notes-box">
                  {data.summary}
                  {data.summary && data.notes && <br />}
                  {data.notes}
                </div>
              </div>
            )}

            {/* Medical Concerns Alert */}
            {data.has_medical_concerns && (
              <div className="section">
                <div className="card card-warning">
                  <strong style={{ color: "#92400e" }}>MEDICAL CONCERN:</strong>{" "}
                  {data.medical_description || "See notes for details"}
                </div>
              </div>
            )}

            {/* Important Notes from call sheet */}
            {data.important_notes && data.important_notes.length > 0 && (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">⚠️</span> Important Flags
                </div>
                <div className="checklist" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                  {data.important_notes.map((note, idx) => (
                    <div className="check-item" key={idx}>
                      <span className="checkbox checked">✓</span>
                      {formatValue(note)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recon Section - For Trapper to Fill */}
        <div className="section" style={{ marginTop: "12px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "8px", padding: "10px" }}>
          <div className="section-header" style={{ color: "#92400e", borderBottomColor: "#fcd34d" }}>
            <span className="section-icon">📋</span> Trapper Recon (fill during site visit)
          </div>

          <div className="recon-grid">
            <div className="recon-box">
              <div className="recon-title">Verified Cat Count</div>
              <div className="write-field"></div>
              <div className="write-label">Adults / Kittens / Eartipped</div>
            </div>
            <div className="recon-box">
              <div className="recon-title">Best Trap Locations</div>
              <div className="write-field"></div>
            </div>
            <div className="recon-box">
              <div className="recon-title">Feeding Time Observed</div>
              <div className="write-field"></div>
            </div>
          </div>

          <div style={{ marginTop: "8px" }}>
            <div className="recon-title">Site Assessment Checklist</div>
            <div className="checklist" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "4px 16px", marginTop: "4px" }}>
              <div className="check-item">
                <span className={`checkbox ${data.dogs_on_site === "yes" ? "checked" : data.dogs_on_site === "no" ? "crossed" : ""}`}>
                  {data.dogs_on_site === "yes" ? "✓" : data.dogs_on_site === "no" ? "✗" : ""}
                </span> Dogs present
              </div>
              <div className="check-item"><span className="checkbox"></span> Other feeders</div>
              <div className="check-item"><span className="checkbox"></span> Wildlife (raccoons)</div>
              <div className="check-item">
                <span className={`checkbox ${data.trap_savvy === "yes" ? "checked" : data.trap_savvy === "no" ? "crossed" : ""}`}>
                  {data.trap_savvy === "yes" ? "✓" : data.trap_savvy === "no" ? "✗" : ""}
                </span> Trap-savvy cats
              </div>
              <div className="check-item">
                <span className={`checkbox ${data.traps_overnight_safe === true ? "checked" : data.traps_overnight_safe === false ? "crossed" : ""}`}>
                  {data.traps_overnight_safe === true ? "✓" : data.traps_overnight_safe === false ? "✗" : ""}
                </span> Safe overnight
              </div>
              <div className="check-item"><span className="checkbox"></span> Gate code needed</div>
              <div className="check-item"><span className="checkbox"></span> Parking available</div>
              <div className="check-item"><span className="checkbox"></span> Need drop traps</div>
            </div>
          </div>

          <div style={{ marginTop: "8px" }}>
            <div className="recon-title">Cat Descriptions (colors, markings, pregnant)</div>
            <div className="write-field tall"></div>
          </div>

          <div style={{ marginTop: "8px" }}>
            <div className="recon-title">Notes / Concerns / Plan</div>
            <div className="write-field tall"></div>
          </div>
        </div>

        {/* Trap Day Checklist */}
        <div className="section" style={{ marginTop: "10px" }}>
          <div className="section-header">
            <span className="section-icon">✅</span> Trap Day Prep
          </div>
          <div className="checklist" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "4px 12px" }}>
            <div className="check-item"><span className="checkbox"></span> Withhold food 24hr</div>
            <div className="check-item"><span className="checkbox"></span> Contact notified</div>
            <div className="check-item"><span className="checkbox"></span> Clinic slot confirmed</div>
            <div className="check-item"><span className="checkbox"></span> Equipment ready</div>
            <div className="check-item"><span className="checkbox"></span> Traps set at: _____</div>
            <div className="check-item"><span className="checkbox"></span> # Traps: _____</div>
            <div className="check-item"><span className="checkbox"></span> # Caught: _____</div>
            <div className="check-item"><span className="checkbox"></span> Return date: _____</div>
          </div>
        </div>

        {/* Footer */}
        <div className="sheet-footer">
          <span>Forgotten Felines of Sonoma County</span>
          <span>Printed {new Date().toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
