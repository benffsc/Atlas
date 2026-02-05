"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatPhone } from "@/lib/formatters";

interface RequestPrint {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
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
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_schedule: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  // Linked cats
  cats: Array<{
    cat_id: string;
    cat_name: string;
    microchip: string | null;
  }> | null;
  // Kitten info
  kitten_count: number | null;
  kitten_age_weeks: number | null;
}

function formatValue(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
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

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    new: "#3498db",
    triaged: "#9b59b6",
    scheduled: "#27ae60",
    in_progress: "#f39c12",
    completed: "#95a5a6",
    on_hold: "#e67e22",
    cancelled: "#e74c3c"
  };
  return colors[status] || "#7f8c8d";
}

function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    high: "#e74c3c",
    normal: "#27ae60",
    low: "#95a5a6"
  };
  return colors[priority] || "#27ae60";
}

export default function RequestPrintPage() {
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RequestPrint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRequest() {
      try {
        const response = await fetch(`/api/requests/${id}`);
        if (!response.ok) throw new Error("Failed to load request");
        const data = await response.json();
        setRequest(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading request");
      } finally {
        setLoading(false);
      }
    }
    fetchRequest();
  }, [id]);

  if (loading) return <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "#e74c3c", fontFamily: "Helvetica, Arial, sans-serif" }}>{error}</div>;
  if (!request) return <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>Request not found</div>;

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.5in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-controls { display: none !important; }
          .print-page {
            padding: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
          }
        }

        body { margin: 0; padding: 0; }

        .print-wrapper {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 10pt;
          line-height: 1.35;
          color: #2c3e50;
        }

        .print-page {
          width: 8.5in;
          min-height: 10in;
          padding: 0.5in;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
        }

        h1, h2, h3, .section-title {
          font-family: 'Raleway', Helvetica, sans-serif;
          font-weight: 700;
        }

        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 12px;
          margin-bottom: 16px;
          border-bottom: 3px solid #27ae60;
        }

        .print-header h1 {
          font-size: 18pt;
          margin: 0;
          color: #2c3e50;
        }

        .print-header .subtitle {
          font-size: 10pt;
          color: #7f8c8d;
          margin-top: 2px;
        }

        .org-badge {
          background: linear-gradient(135deg, #27ae60 0%, #1e8449 100%);
          color: white;
          padding: 8px 14px;
          border-radius: 8px;
          text-align: right;
          font-size: 9pt;
        }

        .org-badge strong {
          display: block;
          font-size: 10pt;
          margin-bottom: 2px;
        }

        .status-strip {
          display: flex;
          gap: 16px;
          background: #f8f9fa;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          align-items: center;
          flex-wrap: wrap;
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 20px;
          font-weight: 600;
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: white;
        }

        .priority-badge {
          padding: 3px 10px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 8pt;
          text-transform: uppercase;
        }

        .meta-item {
          font-size: 9pt;
          color: #7f8c8d;
        }

        .meta-item strong {
          color: #2c3e50;
        }

        .two-column {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .section {
          margin-bottom: 14px;
        }

        .section-title {
          font-size: 11pt;
          color: #27ae60;
          border-bottom: 2px solid #ecf0f1;
          padding-bottom: 4px;
          margin-bottom: 10px;
        }

        .header-logo {
          height: 50px;
          width: auto;
        }

        .card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 12px;
        }

        .card-highlight {
          border-left: 4px solid #27ae60;
        }

        .card-warning {
          background: #fef9e7;
          border-left: 4px solid #f39c12;
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px 16px;
        }

        .info-grid-3 {
          grid-template-columns: repeat(3, 1fr);
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .info-label {
          font-size: 8pt;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .info-value {
          font-size: 10pt;
          color: #2c3e50;
          font-weight: 500;
        }

        .info-value.large {
          font-size: 12pt;
        }

        .tag {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 9pt;
          font-weight: 500;
        }

        .tag-blue { background: #e8f4fd; color: #2980b9; }
        .tag-green { background: #e8f8f5; color: #27ae60; }
        .tag-orange { background: #fef5e7; color: #e67e22; }
        .tag-red { background: #fdedec; color: #e74c3c; }

        .checklist {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 16px;
        }

        .check-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 9pt;
        }

        .check-yes { color: #27ae60; }
        .check-no { color: #e74c3c; }
        .check-na { color: #7f8c8d; }

        .notes-box {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          padding: 10px 12px;
          min-height: 40px;
          font-size: 10pt;
          line-height: 1.4;
        }

        .cats-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9pt;
          margin-top: 8px;
        }

        .cats-table th {
          text-align: left;
          padding: 6px 8px;
          background: #ecf0f1;
          font-weight: 600;
          color: #2c3e50;
        }

        .cats-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #ecf0f1;
        }

        .cats-table tr:last-child td {
          border-bottom: none;
        }

        .footer {
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px solid #ecf0f1;
          font-size: 8pt;
          color: #95a5a6;
          display: flex;
          justify-content: space-between;
        }

        @media screen {
          body { background: #ecf0f1 !important; }
          .print-wrapper { padding: 20px; }
          .print-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin: 0 auto 30px auto;
            border-radius: 8px;
          }
          .print-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 1000;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 12px 20px;
            margin-bottom: 10px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
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
          .print-controls .print-back-btn {
            background: #f0f0f0;
            color: #333;
          }
        }
      `}</style>

      {/* Controls */}
      <div className="print-controls">
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
        <a href={`/requests/${id}`} style={{ textDecoration: "none" }}>
          <button className="print-back-btn" style={{ width: "100%" }}>← Back to Request</button>
        </a>
      </div>

      {/* PAGE 1 */}
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>FFR Request</h1>
            <div className="subtitle">
              {request.requester_name || "Unknown Requester"} • {request.place_address || "Location TBD"}
            </div>
          </div>
          <img src="/logo.png" alt="Forgotten Felines" className="header-logo" />
        </div>

        {/* Status Strip */}
        <div className="status-strip">
          <span className="status-badge" style={{ background: getStatusColor(request.status) }}>
            {formatValue(request.status)}
          </span>
          <span className="priority-badge" style={{
            background: `${getPriorityColor(request.priority)}20`,
            color: getPriorityColor(request.priority)
          }}>
            {request.priority.toUpperCase()} Priority
          </span>
          {request.scheduled_date && (
            <span className="meta-item">
              <strong>Scheduled:</strong> {formatDate(request.scheduled_date)}
              {request.scheduled_time_range && ` (${request.scheduled_time_range})`}
            </span>
          )}
          <span className="meta-item" style={{ marginLeft: "auto" }}>
            <strong>ID:</strong> {request.request_id.slice(0, 8)}
          </span>
        </div>

        {/* Urgency Alert */}
        {request.urgency_reasons && request.urgency_reasons.length > 0 && (
          <div className="card card-warning" style={{ marginBottom: "14px" }}>
            <strong style={{ color: "#e67e22" }}>Urgency Factors</strong>
            <div style={{ marginTop: "4px" }}>
              {request.urgency_reasons.map((r, i) => (
                <span key={i} className="tag tag-orange" style={{ marginRight: "6px" }}>
                  {formatValue(r)}
                </span>
              ))}
              {request.urgency_deadline && (
                <span className="meta-item" style={{ marginLeft: "8px" }}>
                  Deadline: {formatDate(request.urgency_deadline)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="two-column">
          {/* Left Column */}
          <div>
            {/* Contact Card */}
            <div className="card card-highlight">
              <div className="section-title" style={{ marginTop: 0, border: "none", paddingBottom: 0 }}>
                Contact
              </div>
              <div className="info-grid" style={{ marginTop: "8px" }}>
                <div className="info-item">
                  <span className="info-label">Name</span>
                  <span className="info-value large">{request.requester_name || "—"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Phone</span>
                  <span className="info-value">{request.requester_phone ? formatPhone(request.requester_phone) : "—"}</span>
                </div>
                <div className="info-item" style={{ gridColumn: "span 2" }}>
                  <span className="info-label">Email</span>
                  <span className="info-value">{request.requester_email || "—"}</span>
                </div>
                {request.preferred_contact_method && (
                  <div className="info-item">
                    <span className="info-label">Preferred Contact</span>
                    <span className="info-value">{formatValue(request.preferred_contact_method)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            <div className="section">
              <div className="section-title">Location</div>
              <div className="info-grid">
                <div className="info-item" style={{ gridColumn: "span 2" }}>
                  <span className="info-label">Address</span>
                  <span className="info-value">{request.place_address || "—"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">City</span>
                  <span className="info-value">{request.place_city || "—"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">ZIP</span>
                  <span className="info-value">{request.place_postal_code || "—"}</span>
                </div>
                {request.property_type && (
                  <div className="info-item">
                    <span className="info-label">Property Type</span>
                    <span className="info-value">{formatValue(request.property_type)}</span>
                  </div>
                )}
              </div>
              {request.location_description && (
                <div className="notes-box" style={{ marginTop: "8px" }}>
                  {request.location_description}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div>
            {/* Cat Information */}
            <div className="section">
              <div className="section-title">Cats</div>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Estimated Count</span>
                  <span className="info-value large">{request.estimated_cat_count || "Unknown"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Already Eartipped</span>
                  <span className="info-value">{request.eartip_count ?? "Unknown"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Friendly?</span>
                  <span className="info-value">
                    {request.cats_are_friendly === true ? "Yes" :
                     request.cats_are_friendly === false ? "No" : "Unknown"}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">Has Kittens?</span>
                  <span className="info-value">
                    {request.has_kittens ? `Yes${request.kitten_count ? ` (${request.kitten_count})` : ""}` : "No"}
                  </span>
                </div>
                {request.colony_duration && (
                  <div className="info-item">
                    <span className="info-label">Colony Duration</span>
                    <span className="info-value">{formatValue(request.colony_duration)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Access & Logistics */}
            <div className="section">
              <div className="section-title">Access</div>
              <div className="checklist" style={{ marginBottom: "8px" }}>
                <span className={`check-item ${request.permission_status === "granted" ? "check-yes" : request.permission_status === "denied" ? "check-no" : "check-na"}`}>
                  {request.permission_status === "granted" ? "✓" : request.permission_status === "denied" ? "✗" : "?"} Permission
                </span>
                <span className={`check-item ${request.traps_overnight_safe ? "check-yes" : request.traps_overnight_safe === false ? "check-no" : "check-na"}`}>
                  {request.traps_overnight_safe ? "✓" : request.traps_overnight_safe === false ? "✗" : "?"} Traps safe overnight
                </span>
                <span className={`check-item ${request.access_without_contact ? "check-yes" : request.access_without_contact === false ? "check-no" : "check-na"}`}>
                  {request.access_without_contact ? "✓" : request.access_without_contact === false ? "✗" : "?"} Access w/o contact
                </span>
              </div>
              {request.property_owner_contact && (
                <div className="info-item" style={{ marginBottom: "6px" }}>
                  <span className="info-label">Owner Contact</span>
                  <span className="info-value">{request.property_owner_contact}</span>
                </div>
              )}
              {request.best_times_seen && (
                <div className="info-item" style={{ marginBottom: "6px" }}>
                  <span className="info-label">Best Times Seen</span>
                  <span className="info-value">{request.best_times_seen}</span>
                </div>
              )}
              {request.access_notes && (
                <div className="notes-box" style={{ minHeight: "30px" }}>
                  {request.access_notes}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Feeding Info */}
        {(request.is_being_fed || request.feeder_name) && (
          <div className="section">
            <div className="section-title">Feeding</div>
            <div className="info-grid info-grid-3">
              <div className="info-item">
                <span className="info-label">Being Fed?</span>
                <span className="info-value">{request.is_being_fed ? "Yes" : "No"}</span>
              </div>
              {request.feeder_name && (
                <div className="info-item">
                  <span className="info-label">Feeder</span>
                  <span className="info-value">{request.feeder_name}</span>
                </div>
              )}
              {request.feeding_schedule && (
                <div className="info-item">
                  <span className="info-label">Schedule</span>
                  <span className="info-value">{request.feeding_schedule}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Linked Cats */}
        {request.cats && request.cats.length > 0 && (
          <div className="section">
            <div className="section-title">Linked Cats ({request.cats.length})</div>
            <table className="cats-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Microchip</th>
                </tr>
              </thead>
              <tbody>
                {request.cats.slice(0, 6).map(cat => (
                  <tr key={cat.cat_id}>
                    <td>{cat.cat_name}</td>
                    <td style={{ fontFamily: "monospace" }}>{cat.microchip || "—"}</td>
                  </tr>
                ))}
                {request.cats.length > 6 && (
                  <tr>
                    <td colSpan={2} style={{ color: "#7f8c8d", fontStyle: "italic" }}>
                      +{request.cats.length - 6} more cats...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        {request.summary && (
          <div className="section">
            <div className="section-title">Notes</div>
            <div className="notes-box">
              {request.summary}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          <span>Forgotten Felines of Sonoma County • Feral Fix & Return Program</span>
          <span>Created {formatDate(request.created_at)} • Printed {new Date().toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
