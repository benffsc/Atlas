"use client";

import { useState } from "react";
import { URGENT_SITUATION_EXAMPLES } from "@/lib/intake-options";

export default function PrintableIntakeForm() {
  const [includeKittenPage, setIncludeKittenPage] = useState(true);

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
            page-break-after: always;
            max-height: 10in;
            overflow: hidden;
          }
          .print-page:last-child { page-break-after: auto; }
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
          min-height: 10in;
          max-height: 10in;
          padding: 0.5in;
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
          align-items: flex-start;
          padding-bottom: 12px;
          margin-bottom: 14px;
          border-bottom: 3px solid #3498db;
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
          background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
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

        .intro-note {
          background: #e8f6f3;
          border-left: 4px solid #1abc9c;
          padding: 8px 12px;
          margin-bottom: 14px;
          font-size: 9pt;
          border-radius: 0 6px 6px 0;
        }

        .section {
          margin-bottom: 12px;
        }

        .section-title {
          font-size: 11pt;
          color: #3498db;
          border-bottom: 2px solid #ecf0f1;
          padding-bottom: 4px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .section-icon {
          font-size: 14pt;
        }

        .field-row {
          display: flex;
          gap: 12px;
          margin-bottom: 6px;
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
          font-size: 9pt;
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
          min-height: 26px;
          background: #fff;
        }

        .field-input.sm { min-height: 22px; padding: 4px 6px; }
        .field-input.lg { min-height: 80px; }
        .field-input.md { min-height: 50px; }

        .options-row {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10pt;
          margin-bottom: 4px;
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
          width: 14px;
          height: 14px;
          border: 2px solid #3498db;
          border-radius: 50%;
          background: #fff;
          flex-shrink: 0;
        }

        .checkbox {
          width: 14px;
          height: 14px;
          border: 2px solid #3498db;
          border-radius: 3px;
          background: #fff;
          flex-shrink: 0;
        }

        .hint {
          font-size: 8pt;
          color: #95a5a6;
          margin-left: 4px;
        }

        .third-party-box {
          border: 2px solid #f39c12;
          background: #fef9e7;
          padding: 10px 12px;
          margin-bottom: 14px;
          border-radius: 8px;
        }

        .third-party-box .title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 8px;
          color: #e67e22;
        }

        .emergency-box {
          border: 2px solid #e74c3c;
          background: #fdedec;
          padding: 10px 12px;
          margin-bottom: 14px;
          border-radius: 8px;
        }

        .emergency-box .title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          color: #e74c3c;
          margin-bottom: 4px;
        }

        .emergency-box .note {
          font-size: 9pt;
          color: #7f8c8d;
        }

        .info-card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 12px;
          border-left: 4px solid #3498db;
        }

        .staff-section {
          background: #f0f3f4;
          border: 2px dashed #bdc3c7;
          border-radius: 8px;
          padding: 12px;
          margin-top: 12px;
        }

        .staff-section .section-title {
          color: #7f8c8d;
          border-bottom-color: #bdc3c7;
        }

        .signature-area {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid #ecf0f1;
        }

        .signature-area .consent {
          font-size: 8pt;
          color: #7f8c8d;
          max-width: 2.5in;
        }

        .signature-area .sig-fields {
          display: flex;
          gap: 20px;
          font-size: 10pt;
        }

        .footer {
          margin-top: auto;
          padding-top: 8px;
          font-size: 8pt;
          color: #95a5a6;
          text-align: center;
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
          .print-controls h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #2c3e50;
          }
          .print-controls label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 14px;
            cursor: pointer;
          }
          .print-controls input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #3498db;
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
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: #fff;
          }
          .print-controls .print-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(52,152,219,0.4);
          }
          .print-controls .back-btn {
            background: #f0f0f0;
            color: #333;
          }
        }
      `}</style>

      {/* Print Controls */}
      <div className="print-controls">
        <h3>Print Options</h3>
        <label>
          <input
            type="checkbox"
            checked={includeKittenPage}
            onChange={(e) => setIncludeKittenPage(e.target.checked)}
          />
          Include Kitten Page
        </label>
        <button className="print-btn" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <a href="/intake/queue" style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>← Back to Queue</button>
        </a>
      </div>

      {/* ==================== PAGE 1: Main Intake Form ==================== */}
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>Help Request Form</h1>
            <div className="subtitle">Tell us about the cats that need help</div>
          </div>
          <div className="org-badge">
            <strong>Forgotten Felines</strong>
            (707) 576-7999<br />
            forgottenfelines.com
          </div>
        </div>

        {/* Intro Note */}
        <div className="intro-note">
          <strong>Thank you for reaching out!</strong> Please fill out this form completely so we can best help the cats in your area.
          Fill bubbles completely: ●
        </div>

        {/* Third-Party Report */}
        <div className="third-party-box">
          <div className="title">
            <span className="checkbox"></span>
            Reporting on behalf of someone else?
            <span className="hint">(neighbor, property manager, etc.)</span>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Your relationship</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Property owner name</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Owner phone/email</label>
              <div className="field-input sm"></div>
            </div>
          </div>
        </div>

        {/* Section 1: Contact */}
        <div className="section">
          <div className="section-title">
            <span className="section-icon">👤</span>
            Your Contact Information
          </div>
          <div className="field-row">
            <div className="field">
              <label>First Name *</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Last Name *</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field w2">
              <label>Email *</label>
              <div className="field-input sm"></div>
            </div>
          </div>
        </div>

        {/* Section 2: Location */}
        <div className="section">
          <div className="section-title">
            <span className="section-icon">📍</span>
            Where are the cats?
          </div>
          <div className="field-row">
            <div className="field w3">
              <label>Street Address *</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>City</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field half">
              <label>ZIP</label>
              <div className="field-input sm"></div>
            </div>
          </div>
          <div className="options-row">
            <span className="options-label">County:</span>
            <span className="option"><span className="bubble"></span> Sonoma</span>
            <span className="option"><span className="bubble"></span> Marin</span>
            <span className="option"><span className="bubble"></span> Napa</span>
            <span className="option"><span className="bubble"></span> Other: _______</span>
          </div>
        </div>

        {/* Section 3: About the Cats */}
        <div className="section">
          <div className="section-title">
            <span className="section-icon">🐱</span>
            About the Cats
          </div>
          <div className="options-row">
            <span className="options-label">What type?</span>
            <span className="option"><span className="bubble"></span> Stray (no owner)</span>
            <span className="option"><span className="bubble"></span> Community cat I feed</span>
            <span className="option"><span className="bubble"></span> New arrival</span>
            <span className="option"><span className="bubble"></span> Neighbor's cat</span>
            <span className="option"><span className="bubble"></span> My pet</span>
          </div>
          <div className="field-row" style={{ alignItems: "center" }}>
            <div className="field" style={{ flex: "0 0 120px" }}>
              <label>How many cats?</label>
              <div className="field-input sm" style={{ width: "60px" }}></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label">Fixed (ear-tip)?</span>
              <span className="option"><span className="bubble"></span> None</span>
              <span className="option"><span className="bubble"></span> Some</span>
              <span className="option"><span className="bubble"></span> Most/All</span>
              <span className="option"><span className="bubble"></span> Unknown</span>
            </div>
          </div>

          <div className="info-card" style={{ marginTop: "8px" }}>
            <div className="options-row" style={{ marginBottom: "2px" }}>
              <span className="options-label">Do you feed them?</span>
              <span className="option"><span className="bubble"></span> Yes</span>
              <span className="option"><span className="bubble"></span> No</span>
              <span style={{ marginLeft: "12px" }}>How often?</span>
              <span className="option"><span className="bubble"></span> Daily</span>
              <span className="option"><span className="bubble"></span> Few times/wk</span>
              <span className="option"><span className="bubble"></span> Occasionally</span>
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label">How long aware?</span>
              <span className="option"><span className="bubble"></span> &lt;2 wks</span>
              <span className="option"><span className="bubble"></span> Few wks</span>
              <span className="option"><span className="bubble"></span> Few months</span>
              <span className="option"><span className="bubble"></span> 1+ year</span>
              <span style={{ marginLeft: "12px" }}>Come inside?</span>
              <span className="option"><span className="bubble"></span> Yes</span>
              <span className="option"><span className="bubble"></span> Sometimes</span>
              <span className="option"><span className="bubble"></span> Never</span>
            </div>
          </div>

          <div className="options-row">
            <span className="options-label">Kittens present?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "8px" }}>How many? ____</span>
            <span className="hint" style={{ marginLeft: "12px", color: "#3498db", fontWeight: 600 }}>
              → If yes, complete Page 2
            </span>
          </div>
        </div>

        {/* Emergency */}
        <div className="emergency-box">
          <div className="title">
            <span className="checkbox"></span>
            This is an urgent situation
            <span className="hint">({URGENT_SITUATION_EXAMPLES})</span>
          </div>
          <div className="note">
            <strong>Note:</strong> FFSC is a spay/neuter clinic, NOT a 24hr hospital. For life-threatening emergencies:
            <strong> Pet Care Hospital (707) 579-3900</strong>
            <span style={{ marginLeft: "12px" }}>
              <span className="checkbox" style={{ width: "12px", height: "12px", display: "inline-block", verticalAlign: "middle" }}></span>
              <span style={{ marginLeft: "4px" }}>I acknowledge this</span>
            </span>
          </div>
        </div>

        {/* Section 4: Situation */}
        <div className="section">
          <div className="section-title">
            <span className="section-icon">📋</span>
            Tell Us More
          </div>
          <div className="options-row">
            <span className="option"><span className="bubble"></span> Medical concerns</span>
            <span className="option"><span className="bubble"></span> Property access available</span>
            <span className="option"><span className="bubble"></span> I'm the property owner</span>
            <span className="option"><span className="bubble"></span> Others also feeding</span>
          </div>
          <div className="options-row">
            <span className="options-label">How did you hear?</span>
            <span className="option"><span className="bubble"></span> Website</span>
            <span className="option"><span className="bubble"></span> Social media</span>
            <span className="option"><span className="bubble"></span> Friend</span>
            <span className="option"><span className="bubble"></span> Vet/shelter</span>
            <span className="option"><span className="bubble"></span> Other</span>
          </div>
        </div>

        {/* Section 5: Description */}
        <div className="section">
          <div className="section-title">
            <span className="section-icon">📝</span>
            Describe the Situation
          </div>
          <div style={{ fontSize: "9pt", color: "#7f8c8d", marginBottom: "6px" }}>
            Cat descriptions • Medical concerns • Best times to reach you • Where cats hang out • Access notes
          </div>
          <div className="field-input lg"></div>
        </div>

        {/* Signature */}
        <div className="signature-area">
          <div className="consent">
            By submitting, you agree to be contacted by Forgotten Felines regarding this request.
          </div>
          <div className="sig-fields">
            <span><strong>Date:</strong> _______________</span>
            <span><strong>Signature:</strong> _________________________________</span>
          </div>
        </div>

        {/* Staff Section */}
        <div className="staff-section">
          <div className="section-title">
            <span className="section-icon">📎</span>
            Office Use Only
          </div>
          <div className="field-row" style={{ alignItems: "center" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>Date received</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>Received by</label>
              <div className="field-input sm"></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "60px" }}>Source:</span>
              <span className="option"><span className="bubble"></span> Phone</span>
              <span className="option"><span className="bubble"></span> Paper</span>
              <span className="option"><span className="bubble"></span> Walk-in</span>
            </div>
          </div>
          <div className="options-row">
            <span className="options-label" style={{ minWidth: "60px" }}>Priority:</span>
            <span className="option"><span className="bubble"></span> High</span>
            <span className="option"><span className="bubble"></span> Normal</span>
            <span className="option"><span className="bubble"></span> Low</span>
            <span style={{ marginLeft: "20px" }}><span className="options-label">Triage:</span></span>
            <span className="option"><span className="bubble"></span> FFR</span>
            <span className="option"><span className="bubble"></span> Wellness</span>
            <span className="option"><span className="bubble"></span> Owned</span>
            <span className="option"><span className="bubble"></span> Out of area</span>
            <span className="option"><span className="bubble"></span> Review</span>
          </div>
        </div>
      </div>

      {/* ==================== PAGE 2: Kitten Details ==================== */}
      {includeKittenPage && (
        <div className="print-page">
          {/* Header */}
          <div className="print-header">
            <div>
              <h1>Kitten Details</h1>
              <div className="subtitle">Complete if kittens are present at the location</div>
            </div>
            <div className="org-badge">
              <strong>Forgotten Felines</strong>
              Kitten Program
            </div>
          </div>

          <div className="field-row" style={{ marginBottom: "14px" }}>
            <div className="field w2">
              <label>Requester Name (from page 1)</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="field-input sm"></div>
            </div>
          </div>

          {/* Section 6: Kitten Info */}
          <div className="section">
            <div className="section-title">
              <span className="section-icon">🐱</span>
              Kitten Information
            </div>

            <div className="field-row" style={{ alignItems: "center" }}>
              <div className="field" style={{ flex: "0 0 140px" }}>
                <label>How many kittens?</label>
                <div className="field-input sm" style={{ width: "60px" }}></div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label">Age range:</span>
                <span className="option"><span className="bubble"></span> Under 4 wks</span>
                <span className="option"><span className="bubble"></span> 4-8 wks</span>
                <span className="option"><span className="bubble"></span> 8-12 wks</span>
                <span className="option"><span className="bubble"></span> 12-16 wks</span>
                <span className="option"><span className="bubble"></span> 4+ months</span>
                <span className="option"><span className="bubble"></span> Mixed</span>
              </div>
            </div>

            <div className="field" style={{ marginTop: "6px", marginBottom: "8px" }}>
              <label>If mixed ages, describe (e.g., "3 at 8 weeks, 2 at 5 months")</label>
              <div className="field-input sm"></div>
            </div>

            <div className="options-row">
              <span className="options-label">Behavior:</span>
              <span className="option"><span className="bubble"></span> Friendly (handleable)</span>
              <span className="option"><span className="bubble"></span> Shy but can pick up</span>
              <span className="option"><span className="bubble"></span> Shy/hissy (young)</span>
              <span className="option"><span className="bubble"></span> Unhandleable (older)</span>
              <span className="option"><span className="bubble"></span> Unknown</span>
            </div>

            <div className="info-card" style={{ marginTop: "8px" }}>
              <div className="options-row" style={{ marginBottom: "2px" }}>
                <span className="options-label">Contained?</span>
                <span className="option"><span className="bubble"></span> Yes, all caught</span>
                <span className="option"><span className="bubble"></span> Some caught</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span style={{ marginLeft: "20px" }}><span className="options-label">Mom present?</span></span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unsure</span>
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label">Mom fixed?</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
                <span className="option"><span className="bubble"></span> Unsure</span>
                <span style={{ marginLeft: "20px" }}><span className="options-label">Can bring in?</span></span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> Need help</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
            </div>

            <div className="field" style={{ marginTop: "10px" }}>
              <label>Kitten details (colors, where they hide, feeding times, trap-savvy)</label>
              <div className="field-input md"></div>
            </div>
          </div>

          {/* Foster Program Info */}
          <div style={{ background: "#e8f6f3", borderLeft: "4px solid #1abc9c", padding: "12px", borderRadius: "0 8px 8px 0", marginBottom: "14px" }}>
            <strong style={{ color: "#16a085" }}>💚 About Our Foster Program</strong>
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "9pt", lineHeight: "1.5" }}>
              <li><strong>Age matters:</strong> Under 12 weeks is ideal for socialization. 12-16 weeks needs intensive work.</li>
              <li><strong>Behavior matters:</strong> Friendly/handleable kittens are prioritized for foster placement.</li>
              <li><strong>Mom helps:</strong> Spayed mom with kittens increases foster likelihood.</li>
              <li>Older or feral kittens (12+ weeks, hard to handle) may need Feral Fix & Return (FFR) instead.</li>
              <li><strong>Space is limited</strong> and foster placement is not guaranteed until day of assessment.</li>
            </ul>
          </div>

          {/* Staff Section */}
          <div className="staff-section">
            <div className="section-title">
              <span className="section-icon">📋</span>
              Kitten Assessment (Office Use)
            </div>

            <div className="field-row" style={{ alignItems: "center", marginBottom: "8px" }}>
              <div className="field" style={{ flex: "0 0 180px" }}>
                <label>Assessment by</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field" style={{ flex: "0 0 120px" }}>
                <label>Date</label>
                <div className="field-input sm"></div>
              </div>
            </div>

            <div className="options-row">
              <span className="options-label">Outcome:</span>
              <span className="option"><span className="bubble"></span> Foster intake</span>
              <span className="option"><span className="bubble"></span> FFR candidate</span>
              <span className="option"><span className="bubble"></span> Pending space</span>
              <span className="option"><span className="bubble"></span> Declined</span>
            </div>

            <div className="options-row">
              <span className="options-label">Foster readiness:</span>
              <span className="option"><span className="bubble"></span> High (friendly, ideal age)</span>
              <span className="option"><span className="bubble"></span> Medium (needs work)</span>
              <span className="option"><span className="bubble"></span> Low (FFR likely)</span>
            </div>

            <div className="options-row">
              <span className="options-label">Urgency factors:</span>
              <span className="option"><span className="checkbox"></span> Bottle babies</span>
              <span className="option"><span className="checkbox"></span> Medical needs</span>
              <span className="option"><span className="checkbox"></span> Unsafe location</span>
              <span className="option"><span className="checkbox"></span> Mom unfixed</span>
            </div>

            <div className="field" style={{ marginTop: "8px" }}>
              <label>Staff notes (foster contact, follow-up, trapping plan)</label>
              <div className="field-input md"></div>
            </div>
          </div>

          <div className="footer">
            Forgotten Felines of Sonoma County • Helping community cats since 1990 • Page 2 of 2
          </div>
        </div>
      )}
    </div>
  );
}
