"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Prefill {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  notes: string;
}

const EMPTY_PREFILL: Prefill = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  notes: "",
};

export default function FullCallSheetPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <FullCallSheet />
    </Suspense>
  );
}

function FullCallSheet() {
  const searchParams = useSearchParams();
  const [prefill, setPrefill] = useState<Prefill>(EMPTY_PREFILL);
  const [includeKittenPage, setIncludeKittenPage] = useState(true);

  useEffect(() => {
    const p: Prefill = { ...EMPTY_PREFILL };
    if (searchParams.get("name")) {
      const parts = (searchParams.get("name") || "").split(" ");
      p.first_name = parts[0] || "";
      p.last_name = parts.slice(1).join(" ") || "";
    }
    if (searchParams.get("first_name")) p.first_name = searchParams.get("first_name") || "";
    if (searchParams.get("last_name")) p.last_name = searchParams.get("last_name") || "";
    if (searchParams.get("phone")) p.phone = searchParams.get("phone") || "";
    if (searchParams.get("email")) p.email = searchParams.get("email") || "";
    if (searchParams.get("address")) p.address = searchParams.get("address") || "";
    if (searchParams.get("city")) p.city = searchParams.get("city") || "";
    if (searchParams.get("notes")) p.notes = searchParams.get("notes") || "";
    if (Object.values(p).some(Boolean)) setPrefill(p);
  }, [searchParams]);

  const pf = (field: keyof Prefill) => prefill[field] ? "prefilled" : "";

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

        .checkbox {
          width: 13px;
          height: 13px;
          border: 1.5px solid #27ae60;
          border-radius: 2px;
          background: #fff;
          flex-shrink: 0;
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
            max-height: calc(100vh - 40px);
            overflow-y: auto;
          }
          .print-controls h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #27ae60;
          }
          .print-controls .ctrl-field {
            margin-bottom: 8px;
          }
          .print-controls .ctrl-field label {
            display: block;
            font-size: 11px;
            color: #666;
            margin-bottom: 3px;
            text-transform: none;
            letter-spacing: 0;
          }
          .print-controls .ctrl-field input,
          .print-controls .ctrl-field textarea {
            width: 100%;
            padding: 7px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 13px;
            box-sizing: border-box;
          }
          .print-controls .ctrl-field textarea {
            min-height: 50px;
            resize: vertical;
          }
          .print-controls .toggle-label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 14px;
            cursor: pointer;
            text-transform: none;
            letter-spacing: 0;
          }
          .print-controls .toggle-label input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #27ae60;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 10px 16px;
            margin-top: 10px;
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

      {/* ── Print Controls Panel ─────────────────────────── */}
      <div className="print-controls">
        <h3>TNR Call Sheet</h3>
        <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
          Pre-fill from voicemail, then print front &amp; back
        </p>
        <div className="ctrl-field">
          <label>First Name</label>
          <input value={prefill.first_name} onChange={(e) => setPrefill({ ...prefill, first_name: e.target.value })} placeholder="First name..." />
        </div>
        <div className="ctrl-field">
          <label>Last Name</label>
          <input value={prefill.last_name} onChange={(e) => setPrefill({ ...prefill, last_name: e.target.value })} placeholder="Last name..." />
        </div>
        <div className="ctrl-field">
          <label>Phone</label>
          <input value={prefill.phone} onChange={(e) => setPrefill({ ...prefill, phone: e.target.value })} placeholder="Callback number..." />
        </div>
        <div className="ctrl-field">
          <label>Email</label>
          <input value={prefill.email} onChange={(e) => setPrefill({ ...prefill, email: e.target.value })} placeholder="Email if known..." />
        </div>
        <div className="ctrl-field">
          <label>Address</label>
          <input value={prefill.address} onChange={(e) => setPrefill({ ...prefill, address: e.target.value })} placeholder="Cat location..." />
        </div>
        <div className="ctrl-field">
          <label>City</label>
          <input value={prefill.city} onChange={(e) => setPrefill({ ...prefill, city: e.target.value })} placeholder="City..." />
        </div>
        <div className="ctrl-field">
          <label>Voicemail notes</label>
          <textarea value={prefill.notes} onChange={(e) => setPrefill({ ...prefill, notes: e.target.value })} placeholder="Any details mentioned..." />
        </div>

        <label className="toggle-label">
          <input type="checkbox" checked={includeKittenPage} onChange={(e) => setIncludeKittenPage(e.target.checked)} />
          Include Kitten Section
        </label>

        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
        <a href="/requests/print" style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>Quick 1-Page Sheet</button>
        </a>
        <a href="/requests" style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>Back to Requests</button>
        </a>
        <div className="ctrl-hint">
          Print front &amp; back for Crystal. After callback, enter data at <strong>/intake/call-sheet</strong>.
        </div>
      </div>

      {/* ═══════════════════ PAGE 1 (FRONT): Contact & Cats ═══════════════════ */}
      <div className="print-page">
        <div className="print-header">
          <div>
            <h1>TNR Call Sheet</h1>
            <div className="subtitle">Forgotten Felines of Sonoma County</div>
          </div>
          <div className="header-right">
            <div className="date-field">
              <strong>Date:</strong>
              <div className="field-input sm" style={{ width: "100px" }}></div>
            </div>
            <img src="/logo.png" alt="FFSC" className="header-logo" />
          </div>
        </div>

        {/* Contact Information */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="field-row">
            <div className="field">
              <label>First Name *</label>
              <div className={`field-input sm ${pf("first_name")}`}>{prefill.first_name}</div>
            </div>
            <div className="field">
              <label>Last Name *</label>
              <div className={`field-input sm ${pf("last_name")}`}>{prefill.last_name}</div>
            </div>
            <div className="field">
              <label>Phone *</label>
              <div className={`field-input sm ${pf("phone")}`}>{prefill.phone}</div>
            </div>
            <div className="field w2">
              <label>Email</label>
              <div className={`field-input sm ${pf("email")}`}>{prefill.email}</div>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "125px" }}>Third-party report?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "10px" }}>Relationship: ______________________</span>
          </div>
        </div>

        {/* Cat Location */}
        <div className="section">
          <div className="section-title">Where Are the Cats?</div>
          <div className="field-row">
            <div className="field w3">
              <label>Street Address *</label>
              <div className={`field-input sm ${pf("address")}`}>{prefill.address}</div>
            </div>
            <div className="field">
              <label>City</label>
              <div className={`field-input sm ${pf("city")}`}>{prefill.city}</div>
            </div>
            <div className="field half">
              <label>ZIP</label>
              <div className="field-input sm"></div>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "55px" }}>County:</span>
            <span className="option"><span className="bubble"></span> Sonoma</span>
            <span className="option"><span className="bubble"></span> Marin</span>
            <span className="option"><span className="bubble"></span> Napa</span>
            <span className="option"><span className="bubble"></span> Other: ________</span>
            <span style={{ marginLeft: "20px" }}><span className="options-label" style={{ minWidth: "60px" }}>Property:</span></span>
            <span className="option"><span className="bubble"></span> House</span>
            <span className="option"><span className="bubble"></span> Apt</span>
            <span className="option"><span className="bubble"></span> Business</span>
            <span className="option"><span className="bubble"></span> Rural</span>
            <span className="option"><span className="bubble"></span> Other</span>
          </div>
        </div>

        {/* About the Cats */}
        <div className="section">
          <div className="section-title">About the Cats</div>
          <div className="options-row">
            <span className="options-label" style={{ minWidth: "65px" }}>Type:</span>
            <span className="option"><span className="bubble"></span> Stray (no owner)</span>
            <span className="option"><span className="bubble"></span> Community cat I/someone feeds</span>
            <span className="option"><span className="bubble"></span> Newcomer</span>
            <span className="option"><span className="bubble"></span> Neighbor&apos;s cat</span>
            <span className="option"><span className="bubble"></span> My pet</span>
          </div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
            <div className="field" style={{ flex: "0 0 110px" }}>
              <label>How many cats?</label>
              <div className="field-input sm" style={{ width: "60px" }}></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Eartipped?</span>
              <span className="option"><span className="bubble"></span> None</span>
              <span className="option"><span className="bubble"></span> Some</span>
              <span className="option"><span className="bubble"></span> Most/All</span>
              <span className="option"><span className="bubble"></span> Unknown</span>
            </div>
          </div>

          {/* Feeding info card - matches intake layout */}
          <div className="info-card">
            <div className="options-row" style={{ marginBottom: "2px" }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Feed them?</span>
              <span className="option"><span className="bubble"></span> Yes</span>
              <span className="option"><span className="bubble"></span> No</span>
              <span style={{ marginLeft: "10px", fontWeight: 600 }}>How often?</span>
              <span className="option"><span className="bubble"></span> Daily</span>
              <span className="option"><span className="bubble"></span> Few times/wk</span>
              <span className="option"><span className="bubble"></span> Occasionally</span>
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>How long?</span>
              <span className="option"><span className="bubble"></span> Days</span>
              <span className="option"><span className="bubble"></span> Weeks</span>
              <span className="option"><span className="bubble"></span> Months</span>
              <span className="option"><span className="bubble"></span> Year+</span>
              <span style={{ marginLeft: "10px", fontWeight: 600 }}>Colony duration?</span>
              <span className="option"><span className="bubble"></span> &lt;1 mo</span>
              <span className="option"><span className="bubble"></span> 1-6 mo</span>
              <span className="option"><span className="bubble"></span> 6mo-2yr</span>
              <span className="option"><span className="bubble"></span> 2+ yrs</span>
            </div>
          </div>

          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "80px" }}>Kittens?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "8px" }}>How many? ____</span>
            {includeKittenPage && (
              <span className="hint" style={{ marginLeft: "10px", color: "#27ae60", fontWeight: 600 }}>
                If yes, complete Page 2
              </span>
            )}
          </div>
        </div>

        {/* Emergency */}
        <div className="emergency-box">
          <div className="title">
            <span className="checkbox"></span>
            This is an urgent situation
            <span className="hint">(injured, trapped, abandoned kittens, immediate danger)</span>
          </div>
        </div>

        {/* Additional Details */}
        <div className="section">
          <div className="section-title">Additional Details</div>
          <div className="options-row" style={{ marginBottom: "4px" }}>
            <span className="option"><span className="checkbox"></span> Medical concerns</span>
            <span className="option"><span className="checkbox"></span> Property access available</span>
            <span className="option"><span className="checkbox"></span> Property owner</span>
            <span className="option"><span className="checkbox"></span> Others also feeding</span>
            <span style={{ marginLeft: "14px", fontWeight: 600 }}>Heard from:</span>
            <span className="option"><span className="bubble"></span> Website</span>
            <span className="option"><span className="bubble"></span> Social</span>
            <span className="option"><span className="bubble"></span> Friend</span>
            <span className="option"><span className="bubble"></span> Vet/Shelter</span>
            <span className="option"><span className="bubble"></span> Repeat</span>
          </div>
          <div style={{ fontSize: "7.5pt", color: "#7f8c8d", marginBottom: "4px" }}>
            Describe: cat colors/behavior, medical concerns, access notes, callback preferences, situation details
          </div>
          <div className="field-input lg"></div>
        </div>

        {/* Voicemail notes (if prefilled) */}
        {prefill.notes && (
          <div className="info-box" style={{ marginBottom: "8px" }}>
            <div className="title">Notes from Voicemail</div>
            <div style={{ fontSize: "9pt", whiteSpace: "pre-wrap" }}>{prefill.notes}</div>
          </div>
        )}

        {/* Staff Assessment */}
        <div className="staff-box">
          <div className="section-title">Office Use Only</div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "4px" }}>
            <div className="field" style={{ flex: "0 0 130px" }}>
              <label>Date received</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field" style={{ flex: "0 0 130px" }}>
              <label>Received by</label>
              <div className="field-input sm"></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "50px" }}>Source:</span>
              <span className="option"><span className="bubble"></span> Phone</span>
              <span className="option"><span className="bubble"></span> Paper</span>
              <span className="option"><span className="bubble"></span> Walk-in</span>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "55px" }}>Priority:</span>
            <span className="option"><span className="bubble"></span> High</span>
            <span className="option"><span className="bubble"></span> Normal</span>
            <span className="option"><span className="bubble"></span> Low</span>
            <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "50px" }}>Triage:</span></span>
            <span className="option"><span className="bubble"></span> FFR</span>
            <span className="option"><span className="bubble"></span> Wellness</span>
            <span className="option"><span className="bubble"></span> Owned</span>
            <span className="option"><span className="bubble"></span> Out of area</span>
            <span className="option"><span className="bubble"></span> Review</span>
          </div>
        </div>

        <div className="page-footer">
          <span>Forgotten Felines of Sonoma County &bull; (707) 576-7999 &bull; forgottenfelines.org</span>
          <span>Page 1{includeKittenPage ? " of 2" : ""}</span>
        </div>
      </div>

      {/* ═══════════════════ PAGE 2 (BACK): Trapping & Kittens ═══════════════════ */}
      {includeKittenPage && (
        <div className="print-page">
          <div className="print-header">
            <div>
              <h1>Trapping &amp; Kitten Details</h1>
              <div className="subtitle">Complete during callback &mdash; print on back of Page 1</div>
            </div>
            <img src="/logo.png" alt="FFSC" className="header-logo" />
          </div>

          {/* Requester reference */}
          <div className="field-row" style={{ marginBottom: "10px" }}>
            <div className="field w2">
              <label>Caller Name (from page 1)</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="field-input sm"></div>
            </div>
          </div>

          {/* Property Access & Logistics */}
          <div className="section">
            <div className="section-title">Property Access &amp; Logistics</div>
            <div className="two-col">
              <div>
                <div className="options-row">
                  <span className="options-label">Property access?</span>
                  <span className="option"><span className="bubble"></span> Yes</span>
                  <span className="option"><span className="bubble"></span> Need perm</span>
                  <span className="option"><span className="bubble"></span> No</span>
                </div>
                <div className="options-row">
                  <span className="options-label">Caller is owner?</span>
                  <span className="option"><span className="bubble"></span> Yes</span>
                  <span className="option"><span className="bubble"></span> Renter</span>
                  <span className="option"><span className="bubble"></span> Neighbor</span>
                </div>
                <div className="options-row" style={{ marginBottom: 0 }}>
                  <span className="options-label">Dogs on site?</span>
                  <span className="option"><span className="bubble"></span> Yes</span>
                  <span className="option"><span className="bubble"></span> No</span>
                  <span className="hint">(containable?)</span>
                </div>
              </div>
              <div>
                <div className="options-row">
                  <span className="options-label">Trap-savvy?</span>
                  <span className="option"><span className="bubble"></span> Yes</span>
                  <span className="option"><span className="bubble"></span> No</span>
                  <span className="option"><span className="bubble"></span> Unknown</span>
                </div>
                <div className="options-row">
                  <span className="options-label">Previous TNR?</span>
                  <span className="option"><span className="bubble"></span> Yes</span>
                  <span className="option"><span className="bubble"></span> No</span>
                  <span className="option"><span className="bubble"></span> Partial</span>
                </div>
                <div className="options-row" style={{ marginBottom: 0 }}>
                  <span className="options-label">Handleable?</span>
                  <span className="option"><span className="bubble"></span> Carrier OK</span>
                  <span className="option"><span className="bubble"></span> Trap needed</span>
                  <span className="option"><span className="bubble"></span> Mixed</span>
                </div>
              </div>
            </div>
            <div className="field" style={{ marginTop: "6px" }}>
              <label>Access notes (gate codes, parking, hazards)</label>
              <div className="field-input sm"></div>
            </div>
          </div>

          {/* Feeding & Trapping Schedule */}
          <div className="info-box">
            <div className="title">Best Trapping Times</div>
            <div className="field-row" style={{ marginBottom: "6px" }}>
              <div className="field">
                <label>Who feeds?</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field">
                <label>Feed time?</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field">
                <label>Where do cats eat?</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field">
                <label>Best trapping day/time</label>
                <div className="field-input sm"></div>
              </div>
            </div>
          </div>

          {/* Important Notes */}
          <div className="warning-box">
            <div className="title">Important Notes (check all that apply)</div>
            <div className="quick-notes">
              <div className="quick-note"><span className="checkbox"></span> Withhold food 24hr before</div>
              <div className="quick-note"><span className="checkbox"></span> Other feeders in area</div>
              <div className="quick-note"><span className="checkbox"></span> Cats cross property lines</div>
              <div className="quick-note"><span className="checkbox"></span> Pregnant cat suspected</div>
              <div className="quick-note"><span className="checkbox"></span> Injured/sick cat priority</div>
              <div className="quick-note"><span className="checkbox"></span> Caller can help trap</div>
              <div className="quick-note"><span className="checkbox"></span> Wildlife concerns</div>
              <div className="quick-note"><span className="checkbox"></span> Neighbor issues</div>
              <div className="quick-note"><span className="checkbox"></span> Urgent / time-sensitive</div>
            </div>
          </div>

          {/* Kitten Section */}
          <div className="section">
            <div className="section-title">Kitten Information</div>
            <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
              <div className="field" style={{ flex: "0 0 120px" }}>
                <label>How many kittens?</label>
                <div className="field-input sm" style={{ width: "60px" }}></div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Age range:</span>
                <span className="option"><span className="bubble"></span> Under 4 wks</span>
                <span className="option"><span className="bubble"></span> 4-8 wks</span>
                <span className="option"><span className="bubble"></span> 8-12 wks</span>
                <span className="option"><span className="bubble"></span> 12-16 wks</span>
                <span className="option"><span className="bubble"></span> 4+ months</span>
                <span className="option"><span className="bubble"></span> Mixed</span>
              </div>
            </div>

            <div className="options-row" style={{ marginBottom: "6px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Behavior:</span>
              <span className="option"><span className="bubble"></span> Friendly</span>
              <span className="option"><span className="bubble"></span> Shy but handleable</span>
              <span className="option"><span className="bubble"></span> Feral / hissy</span>
              <span className="option"><span className="bubble"></span> Unknown</span>
            </div>

            <div className="info-card" style={{ marginBottom: "8px" }}>
              <div className="options-row" style={{ marginBottom: "3px" }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Contained?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Some</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Mom present?</span></span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unsure</span>
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Mom fixed?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unsure</span>
                <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Can bring in?</span></span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Need help</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
            </div>

            <div className="field">
              <label>Kitten details (colors, where they hide, feeding schedule)</label>
              <div className="field-input md"></div>
            </div>
          </div>

          {/* Staff Assessment */}
          <div className="staff-box">
            <div className="section-title">Trapping Plan (Office Use)</div>
            <div className="field-row" style={{ alignItems: "center", marginBottom: "4px" }}>
              <div className="field" style={{ flex: "0 0 160px" }}>
                <label>Assigned to</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field" style={{ flex: "0 0 130px" }}>
                <label>Scheduled date</label>
                <div className="field-input sm"></div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "60px" }}>Callback:</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
            </div>
            <div className="options-row" style={{ marginBottom: "4px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Outcome:</span>
              <span className="option"><span className="bubble"></span> Foster intake</span>
              <span className="option"><span className="bubble"></span> FFR candidate</span>
              <span className="option"><span className="bubble"></span> Pending space</span>
              <span className="option"><span className="bubble"></span> Declined</span>
            </div>
            <div className="field">
              <label>Staff notes</label>
              <div className="field-input md"></div>
            </div>
          </div>

          <div className="page-footer">
            <span>Forgotten Felines of Sonoma County &bull; forgottenfelines.org</span>
            <span>Page 2 of 2</span>
          </div>
        </div>
      )}
    </div>
  );
}
