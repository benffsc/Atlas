"use client";

import { useState } from "react";

export default function TrapperCallSheet() {
  const [prefill, setPrefill] = useState({ name: "", phone: "", address: "", notes: "" });

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.4in; }
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
          min-height: 10.2in;
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
          padding-bottom: 6px;
          margin-bottom: 8px;
          border-bottom: 3px solid #27ae60;
        }

        .print-header h1 {
          font-size: 18pt;
          margin: 0;
          color: #27ae60;
        }

        .print-header .subtitle {
          font-size: 9pt;
          color: #7f8c8d;
          margin-top: 2px;
        }

        .header-logo {
          height: 45px;
          width: auto;
        }

        .section {
          margin-bottom: 8px;
        }

        .section-title {
          font-size: 11pt;
          color: #27ae60;
          border-bottom: 2px solid #ecf0f1;
          padding-bottom: 4px;
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

        .field label {
          display: block;
          font-size: 8pt;
          font-weight: 600;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 3px;
        }

        .field-input {
          border: 1px solid #bdc3c7;
          border-radius: 4px;
          padding: 6px 8px;
          min-height: 24px;
          background: #fff;
        }

        .field-input.prefilled {
          background: #f9f9f9;
          color: #2c3e50;
          font-size: 10pt;
        }

        .field-input.sm { min-height: 22px; }
        .field-input.md { min-height: 36px; }
        .field-input.lg { min-height: 60px; }
        .field-input.xl { min-height: 80px; }

        .options-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 9.5pt;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }

        .options-label {
          font-weight: 600;
          color: #2c3e50;
          min-width: 100px;
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
          margin-bottom: 8px;
        }

        .info-box .title {
          font-weight: 600;
          color: #166534;
          margin-bottom: 6px;
          font-size: 9.5pt;
        }

        .warning-box {
          background: #fef3c7;
          border: 1.5px solid #fcd34d;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 8px;
        }

        .warning-box .title {
          font-weight: 600;
          color: #92400e;
          margin-bottom: 4px;
          font-size: 9.5pt;
        }

        .quick-notes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          margin-bottom: 6px;
        }

        .quick-note {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 9pt;
          padding: 2px 0;
        }

        .date-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 6px;
          margin-top: 6px;
          border-top: 1px solid #ecf0f1;
          font-size: 9.5pt;
        }

        @media screen {
          body { background: #f0f9f4 !important; }
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
            width: 280px;
          }
          .print-controls h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #27ae60;
          }
          .print-controls .field {
            margin-bottom: 10px;
          }
          .print-controls .field label {
            display: block;
            font-size: 11px;
            color: #666;
            margin-bottom: 4px;
          }
          .print-controls .field input,
          .print-controls .field textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 13px;
            box-sizing: border-box;
          }
          .print-controls .field textarea {
            min-height: 60px;
            resize: vertical;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 12px 20px;
            margin-top: 12px;
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
            margin-top: 8px;
          }
          .print-controls .hint {
            font-size: 11px;
            color: #888;
            margin-top: 8px;
            line-height: 1.4;
          }
        }
      `}</style>

      {/* Print Controls - Pre-fill options */}
      <div className="print-controls">
        <h3>Trapper Call Sheet</h3>
        <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
          Pre-fill info from voicemail, or print blank
        </p>
        <div className="field">
          <label>Name (if known)</label>
          <input
            type="text"
            value={prefill.name}
            onChange={(e) => setPrefill({ ...prefill, name: e.target.value })}
            placeholder="From voicemail..."
          />
        </div>
        <div className="field">
          <label>Phone number</label>
          <input
            type="text"
            value={prefill.phone}
            onChange={(e) => setPrefill({ ...prefill, phone: e.target.value })}
            placeholder="Callback number"
          />
        </div>
        <div className="field">
          <label>Address (if mentioned)</label>
          <input
            type="text"
            value={prefill.address}
            onChange={(e) => setPrefill({ ...prefill, address: e.target.value })}
            placeholder="Location if known..."
          />
        </div>
        <div className="field">
          <label>Quick notes from voicemail</label>
          <textarea
            value={prefill.notes}
            onChange={(e) => setPrefill({ ...prefill, notes: e.target.value })}
            placeholder="Any details mentioned..."
          />
        </div>
        <button className="print-btn" onClick={() => window.print()}>
          Print Call Sheet
        </button>
        <a href="/requests" style={{ textDecoration: "none" }}>
          <button className="print-back-btn" style={{ width: "100%" }}>← Back to Requests</button>
        </a>
        <div className="hint">
          Fill in what you know from the voicemail, then print for Crystal to complete during the callback.
        </div>
      </div>

      {/* ==================== CALL SHEET ==================== */}
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>TNR Call Sheet</h1>
            <div className="subtitle">Trapper callback form for gathering TNR details</div>
          </div>
          <img src="/logo.png" alt="Forgotten Felines" className="header-logo" />
        </div>

        {/* Contact Section */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="field-row">
            <div className="field w2">
              <label>Name</label>
              <div className={`field-input ${prefill.name ? 'prefilled' : ''}`}>
                {prefill.name || ''}
              </div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className={`field-input ${prefill.phone ? 'prefilled' : ''}`}>
                {prefill.phone || ''}
              </div>
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <div className="field-input"></div>
            </div>
          </div>
          <div className="field-row">
            <div className="field w3">
              <label>Address where cats are located</label>
              <div className={`field-input ${prefill.address ? 'prefilled' : ''}`}>
                {prefill.address || ''}
              </div>
            </div>
            <div className="field">
              <label>City</label>
              <div className="field-input"></div>
            </div>
          </div>
          <div className="options-row">
            <span className="options-label" style={{ minWidth: "110px" }}>Property type:</span>
            <span className="option"><span className="bubble"></span> House</span>
            <span className="option"><span className="bubble"></span> Apartment</span>
            <span className="option"><span className="bubble"></span> Business</span>
            <span className="option"><span className="bubble"></span> Rural/Farm</span>
            <span className="option"><span className="bubble"></span> Other: ________</span>
          </div>
        </div>

        {/* Cat Details Section */}
        <div className="section">
          <div className="section-title">Cat Details</div>
          <div className="two-col">
            <div>
              <div className="options-row">
                <span className="options-label">How many cats?</span>
                <div className="field-input sm" style={{ width: "60px", display: "inline-block" }}></div>
              </div>
              <div className="options-row">
                <span className="options-label">Eartipped seen?</span>
                <span className="option"><span className="bubble"></span> None</span>
                <span className="option"><span className="bubble"></span> Some</span>
                <span className="option"><span className="bubble"></span> Most</span>
              </div>
              <div className="options-row">
                <span className="options-label">Kittens?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ marginLeft: "6px" }}>How many? ____</span>
              </div>
            </div>
            <div>
              <div className="options-row">
                <span className="options-label">How long aware?</span>
                <span className="option"><span className="bubble"></span> Weeks</span>
                <span className="option"><span className="bubble"></span> Months</span>
                <span className="option"><span className="bubble"></span> Year+</span>
              </div>
              <div className="options-row">
                <span className="options-label">Feeding them?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Someone else</span>
              </div>
              <div className="options-row">
                <span className="options-label">Medical issues?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unknown</span>
              </div>
            </div>
          </div>
          <div className="field" style={{ marginTop: "6px" }}>
            <label>Cat descriptions (colors, distinguishing features, names if known)</label>
            <div className="field-input md"></div>
          </div>
        </div>

        {/* Trapping Logistics Section */}
        <div className="section">
          <div className="section-title">Trapping Logistics</div>
          <div className="two-col">
            <div>
              <div className="options-row">
                <span className="options-label">Property access?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Need permission</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
              <div className="options-row">
                <span className="options-label">Is caller owner?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No (renter)</span>
                <span className="option"><span className="bubble"></span> No (neighbor)</span>
              </div>
              <div className="options-row">
                <span className="options-label">Dogs on site?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ fontSize: "8pt", color: "#666" }}>(can be contained?)</span>
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
        </div>

        {/* Feeding & Timing */}
        <div className="info-box">
          <div className="title">Feeding Schedule & Best Trapping Times</div>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <div className="field">
              <label>What time do they feed?</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Where do cats eat? (porch, yard, etc.)</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Best day/time for trapping?</label>
              <div className="field-input sm"></div>
            </div>
          </div>
        </div>

        {/* Quick Checkboxes */}
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
            <div className="quick-note"><span className="checkbox"></span> Urgent/time-sensitive</div>
          </div>
        </div>

        {/* Additional Details - Large */}
        <div className="section">
          <div className="section-title">Additional Details & Notes</div>
          <div style={{ fontSize: "8pt", color: "#7f8c8d", marginBottom: "6px" }}>
            Situation details, cat behaviors, access instructions, hazards, callback preferences, anything else relevant
          </div>
          <div className={`field-input xl ${prefill.notes ? 'prefilled' : ''}`}>
            {prefill.notes || ''}
          </div>
        </div>

        {/* Date/Trapper line */}
        <div className="date-line">
          <span><strong>Call Date:</strong> ________________</span>
          <span><strong>Trapper:</strong> ________________</span>
          <span><strong>Callback needed?</strong> <span className="checkbox" style={{ display: "inline-block", verticalAlign: "middle" }}></span> Yes <span className="checkbox" style={{ display: "inline-block", verticalAlign: "middle", marginLeft: "8px" }}></span> No</span>
        </div>
      </div>
    </div>
  );
}
