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

  // Load prefill from URL query params
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

  const pf = (field: keyof Prefill) =>
    prefill[field] ? "prefilled" : "";

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
            padding: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
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
          height: 10.3in;
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
          padding-bottom: 5px;
          margin-bottom: 7px;
          border-bottom: 3px solid #27ae60;
        }

        .print-header h1 {
          font-size: 16pt;
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
          gap: 12px;
        }

        .header-logo {
          height: 38px;
          width: auto;
        }

        .section {
          margin-bottom: 7px;
        }

        .section-title {
          font-size: 10pt;
          color: #27ae60;
          border-bottom: 1.5px solid #ecf0f1;
          padding-bottom: 2px;
          margin-bottom: 5px;
        }

        .field-row {
          display: flex;
          gap: 8px;
          margin-bottom: 5px;
        }

        .field {
          flex: 1;
          min-width: 0;
        }

        .field.w2 { flex: 2; }
        .field.w3 { flex: 3; }
        .field.w4 { flex: 4; }

        .field label {
          display: block;
          font-size: 7.5pt;
          font-weight: 600;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 2px;
        }

        .field-input {
          border: 1px solid #bdc3c7;
          border-radius: 3px;
          padding: 4px 6px;
          min-height: 20px;
          background: #fff;
          font-size: 9.5pt;
        }

        .field-input.prefilled {
          background: #f9f9f9;
          color: #2c3e50;
        }

        .field-input.sm { min-height: 18px; }
        .field-input.md { min-height: 32px; }
        .field-input.lg { min-height: 55px; }
        .field-input.xl { min-height: 70px; }

        .options-row {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 9pt;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }

        .options-label {
          font-weight: 600;
          color: #2c3e50;
          min-width: 90px;
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

        .checkbox {
          width: 11px;
          height: 11px;
          border: 1.5px solid #27ae60;
          border-radius: 2px;
          background: #fff;
          flex-shrink: 0;
        }

        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .info-box {
          background: #f0fdf4;
          border: 1.5px solid #86efac;
          border-radius: 5px;
          padding: 6px 8px;
          margin-bottom: 7px;
        }

        .info-box .title {
          font-weight: 600;
          color: #166534;
          margin-bottom: 4px;
          font-size: 9pt;
        }

        .warning-box {
          background: #fef3c7;
          border: 1.5px solid #fcd34d;
          border-radius: 5px;
          padding: 6px 8px;
          margin-bottom: 7px;
        }

        .warning-box .title {
          font-weight: 600;
          color: #92400e;
          margin-bottom: 3px;
          font-size: 9pt;
        }

        .staff-box {
          border: 1.5px dashed #94a3b8;
          border-radius: 5px;
          padding: 6px 8px;
          margin-bottom: 7px;
          background: #f8fafc;
        }

        .staff-box .title {
          font-weight: 600;
          color: #475569;
          margin-bottom: 4px;
          font-size: 9pt;
        }

        .quick-notes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px;
        }

        .quick-note {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 8.5pt;
          padding: 1px 0;
        }

        .emergency-flag {
          background: #fef2f2;
          border: 1.5px solid #fca5a5;
          border-radius: 5px;
          padding: 4px 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 9pt;
          margin-bottom: 5px;
        }

        .emergency-flag .checkbox {
          border-color: #ef4444;
        }

        .page-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 5px;
          margin-top: auto;
          border-top: 1px solid #ecf0f1;
          font-size: 8.5pt;
          color: #7f8c8d;
        }

        .date-field {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 9pt;
        }

        .date-field .field-input {
          width: 100px;
          display: inline-block;
        }

        @media screen {
          body { background: #f0f9f4 !important; }
          .print-wrapper { padding: 20px; }
          .print-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin: 0 auto 30px auto;
            border-radius: 8px;
            height: auto;
            min-height: 10.3in;
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
          .print-controls .hint {
            font-size: 11px;
            color: #888;
            margin-top: 8px;
            line-height: 1.4;
          }
        }
      `}</style>

      {/* Print Controls */}
      <div className="print-controls">
        <h3>Full Call Sheet (2-page)</h3>
        <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
          Pre-fill from voicemail, then print for Crystal
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
          <label>Quick notes from voicemail</label>
          <textarea value={prefill.notes} onChange={(e) => setPrefill({ ...prefill, notes: e.target.value })} placeholder="Any details mentioned..." />
        </div>
        <button className="print-btn" onClick={() => window.print()}>Print Call Sheet</button>
        <a href="/requests/print" style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>1-Page Quick Sheet</button>
        </a>
        <a href="/requests" style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>Back to Requests</button>
        </a>
        <div className="hint">
          Pre-fill what you know, then print front &amp; back for Crystal. After callback, enter data at <strong>/intake/call-sheet</strong>.
        </div>
      </div>

      {/* ==================== PAGE 1: CONTACT & CATS ==================== */}
      <div className="print-page">
        <div className="print-header">
          <div>
            <h1>TNR Call Sheet</h1>
            <div className="subtitle">Forgotten Felines of Sonoma County &mdash; Callback Form</div>
          </div>
          <div className="header-right">
            <div className="date-field">
              <strong>Date:</strong>
              <div className="field-input sm" style={{ width: "90px" }}></div>
            </div>
            <img src="/logo.png" alt="FFSC" className="header-logo" />
          </div>
        </div>

        {/* Contact Information */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="field-row">
            <div className="field">
              <label>First Name</label>
              <div className={`field-input ${pf("first_name")}`}>{prefill.first_name}</div>
            </div>
            <div className="field">
              <label>Last Name</label>
              <div className={`field-input ${pf("last_name")}`}>{prefill.last_name}</div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className={`field-input ${pf("phone")}`}>{prefill.phone}</div>
            </div>
            <div className="field">
              <label>Email</label>
              <div className={`field-input ${pf("email")}`}>{prefill.email}</div>
            </div>
          </div>
          <div className="options-row">
            <span className="options-label" style={{ minWidth: "120px" }}>Third-party report?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "8px", color: "#7f8c8d" }}>Relationship: ____________________</span>
          </div>
        </div>

        {/* Cat Location */}
        <div className="section">
          <div className="section-title">Cat Location</div>
          <div className="field-row">
            <div className="field w4">
              <label>Street Address (where cats are)</label>
              <div className={`field-input ${pf("address")}`}>{prefill.address}</div>
            </div>
            <div className="field">
              <label>City</label>
              <div className={`field-input ${pf("city")}`}>{prefill.city}</div>
            </div>
            <div className="field" style={{ maxWidth: "80px" }}>
              <label>ZIP</label>
              <div className="field-input"></div>
            </div>
          </div>
          <div className="field-row" style={{ marginBottom: "3px" }}>
            <div style={{ flex: 1 }}>
              <div className="options-row" style={{ marginBottom: "2px" }}>
                <span className="options-label">County:</span>
                <span className="option"><span className="bubble"></span> Sonoma</span>
                <span className="option"><span className="bubble"></span> Marin</span>
                <span className="option"><span className="bubble"></span> Napa</span>
                <span className="option"><span className="bubble"></span> Other: _____</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="options-row" style={{ marginBottom: "2px" }}>
                <span className="options-label">Property:</span>
                <span className="option"><span className="bubble"></span> House</span>
                <span className="option"><span className="bubble"></span> Apt</span>
                <span className="option"><span className="bubble"></span> Business</span>
                <span className="option"><span className="bubble"></span> Rural</span>
                <span className="option"><span className="bubble"></span> Other</span>
              </div>
            </div>
          </div>
        </div>

        {/* About the Cats */}
        <div className="section">
          <div className="section-title">About the Cats</div>
          <div className="two-col">
            <div>
              <div className="options-row">
                <span className="options-label">Ownership:</span>
              </div>
              <div style={{ paddingLeft: "4px", marginBottom: "4px" }}>
                <div className="options-row"><span className="option"><span className="bubble"></span> Stray (no owner)</span></div>
                <div className="options-row"><span className="option"><span className="bubble"></span> Community cat I/someone feeds</span></div>
                <div className="options-row"><span className="option"><span className="bubble"></span> Newcomer (just appeared)</span></div>
                <div className="options-row"><span className="option"><span className="bubble"></span> Neighbor&apos;s cat</span></div>
                <div className="options-row"><span className="option"><span className="bubble"></span> My own pet</span></div>
              </div>
              <div className="options-row">
                <span className="options-label">Cat count:</span>
                <div className="field-input sm" style={{ width: "50px", display: "inline-block" }}></div>
                <span style={{ marginLeft: "8px" }}>Eartipped:</span>
                <div className="field-input sm" style={{ width: "40px", display: "inline-block" }}></div>
              </div>
              <div className="options-row">
                <span className="options-label">Fixed status:</span>
              </div>
              <div style={{ paddingLeft: "4px" }}>
                <div className="options-row">
                  <span className="option"><span className="bubble"></span> None fixed</span>
                  <span className="option"><span className="bubble"></span> Some fixed</span>
                  <span className="option"><span className="bubble"></span> Most/all</span>
                  <span className="option"><span className="bubble"></span> Unknown</span>
                </div>
              </div>
            </div>
            <div>
              <div className="options-row">
                <span className="options-label">Kittens?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ marginLeft: "4px" }}>Count: ____</span>
              </div>
              <div className="options-row">
                <span className="options-label">Kitten age:</span>
              </div>
              <div style={{ paddingLeft: "4px", marginBottom: "4px" }}>
                <div className="options-row">
                  <span className="option"><span className="bubble"></span> Newborn</span>
                  <span className="option"><span className="bubble"></span> 2-5 wks</span>
                  <span className="option"><span className="bubble"></span> 6-8 wks</span>
                  <span className="option"><span className="bubble"></span> 8-12 wks</span>
                  <span className="option"><span className="bubble"></span> 12+ wks</span>
                </div>
              </div>
              <div className="options-row">
                <span className="options-label">Medical?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
              <div className="field" style={{ marginTop: "2px" }}>
                <label>Medical concerns (describe)</label>
                <div className="field-input sm"></div>
              </div>
              <div className="emergency-flag" style={{ marginTop: "5px" }}>
                <span className="checkbox" style={{ borderColor: "#ef4444" }}></span>
                <strong style={{ color: "#dc2626" }}>EMERGENCY?</strong>
                <span style={{ color: "#7f8c8d", fontSize: "8pt" }}>(injured, immediate danger)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Awareness & Referral */}
        <div className="section">
          <div className="section-title">Awareness &amp; Referral</div>
          <div className="options-row">
            <span className="options-label">How long aware?</span>
            <span className="option"><span className="bubble"></span> Days</span>
            <span className="option"><span className="bubble"></span> Weeks</span>
            <span className="option"><span className="bubble"></span> Months</span>
            <span className="option"><span className="bubble"></span> Year+</span>
          </div>
          <div className="options-row">
            <span className="options-label">Colony duration:</span>
            <span className="option"><span className="bubble"></span> &lt;1 mo</span>
            <span className="option"><span className="bubble"></span> 1-6 mo</span>
            <span className="option"><span className="bubble"></span> 6mo-2yr</span>
            <span className="option"><span className="bubble"></span> 2+ yrs</span>
            <span className="option"><span className="bubble"></span> Unknown</span>
          </div>
          <div className="options-row">
            <span className="options-label">Heard from:</span>
            <span className="option"><span className="bubble"></span> Website</span>
            <span className="option"><span className="bubble"></span> Social</span>
            <span className="option"><span className="bubble"></span> Friend</span>
            <span className="option"><span className="bubble"></span> Vet/Shelter</span>
            <span className="option"><span className="bubble"></span> Repeat caller</span>
            <span className="option"><span className="bubble"></span> Other</span>
          </div>
        </div>

        {/* Voicemail notes (if prefilled) */}
        {prefill.notes && (
          <div className="info-box">
            <div className="title">Notes from Voicemail</div>
            <div style={{ fontSize: "9pt", whiteSpace: "pre-wrap" }}>{prefill.notes}</div>
          </div>
        )}

        {/* Page 1 footer */}
        <div className="page-footer">
          <span>Received by: ____________________</span>
          <span>Page 1 of 2</span>
        </div>
      </div>

      {/* ==================== PAGE 2: TRAPPING & NOTES ==================== */}
      <div className="print-page">
        <div className="print-header">
          <div>
            <h1>Trapping Details</h1>
            <div className="subtitle">Forgotten Felines of Sonoma County &mdash; Call Sheet (continued)</div>
          </div>
          <img src="/logo.png" alt="FFSC" className="header-logo" />
        </div>

        {/* Property Access & Logistics */}
        <div className="section">
          <div className="section-title">Property Access &amp; Logistics</div>
          <div className="two-col">
            <div>
              <div className="options-row">
                <span className="options-label">Property access?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Need permission</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
              <div className="options-row">
                <span className="options-label">Caller is owner?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Renter</span>
                <span className="option"><span className="bubble"></span> Neighbor</span>
              </div>
              <div className="options-row">
                <span className="options-label">Dogs on site?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ fontSize: "8pt", color: "#666" }}>(containable?)</span>
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
              <div className="options-row">
                <span className="options-label">Handleable?</span>
                <span className="option"><span className="bubble"></span> Carrier OK</span>
                <span className="option"><span className="bubble"></span> Trap needed</span>
                <span className="option"><span className="bubble"></span> Mixed</span>
              </div>
            </div>
          </div>
          <div className="field" style={{ marginTop: "3px" }}>
            <label>Access notes (gate codes, parking, hazards)</label>
            <div className="field-input sm"></div>
          </div>
        </div>

        {/* Feeding Schedule */}
        <div className="info-box">
          <div className="title">Feeding Schedule &amp; Best Trapping Times</div>
          <div className="field-row" style={{ marginBottom: "4px" }}>
            <div className="field">
              <label>Who feeds?</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>What time?</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Where do cats eat?</label>
              <div className="field-input sm"></div>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: "4px" }}>
            <span className="options-label">Frequency:</span>
            <span className="option"><span className="bubble"></span> Daily</span>
            <span className="option"><span className="bubble"></span> Few/wk</span>
            <span className="option"><span className="bubble"></span> Occasionally</span>
            <span className="option"><span className="bubble"></span> Rarely</span>
          </div>
          <div className="field">
            <label>Best day/time for trapping?</label>
            <div className="field-input sm"></div>
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
            <div className="quick-note"><span className="checkbox"></span> Wildlife concerns (raccoons etc.)</div>
            <div className="quick-note"><span className="checkbox"></span> Neighbor issues / complaints</div>
            <div className="quick-note"><span className="checkbox"></span> Urgent / time-sensitive</div>
          </div>
        </div>

        {/* Cat Descriptions */}
        <div className="section">
          <div className="section-title">Cat Descriptions</div>
          <div style={{ fontSize: "7.5pt", color: "#7f8c8d", marginBottom: "3px" }}>
            Colors, markings, distinguishing features, names if known
          </div>
          <div className="field-input md"></div>
        </div>

        {/* Situation Notes */}
        <div className="section">
          <div className="section-title">Situation Notes</div>
          <div style={{ fontSize: "7.5pt", color: "#7f8c8d", marginBottom: "3px" }}>
            Details, behaviors, access instructions, hazards, callback preferences, anything else relevant
          </div>
          <div className="field-input lg"></div>
        </div>

        {/* Staff Assessment */}
        <div className="staff-box">
          <div className="title">Staff Assessment</div>
          <div className="field-row" style={{ marginBottom: "3px" }}>
            <div style={{ flex: 1 }}>
              <div className="options-row">
                <span className="options-label">Priority:</span>
                <span className="option"><span className="bubble"></span> High</span>
                <span className="option"><span className="bubble"></span> Normal</span>
                <span className="option"><span className="bubble"></span> Low</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="options-row">
                <span className="options-label">Triage:</span>
                <span className="option"><span className="bubble"></span> FFR</span>
                <span className="option"><span className="bubble"></span> Wellness</span>
                <span className="option"><span className="bubble"></span> Owned</span>
                <span className="option"><span className="bubble"></span> Out of area</span>
                <span className="option"><span className="bubble"></span> Review</span>
              </div>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Assigned to</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Scheduled date</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Callback needed?</label>
              <div className="options-row" style={{ marginTop: "2px" }}>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
            </div>
          </div>
        </div>

        {/* Page 2 footer */}
        <div className="page-footer">
          <span>Forgotten Felines of Sonoma County &bull; forgottenfelines.org</span>
          <span>Page 2 of 2</span>
        </div>
      </div>
    </div>
  );
}
