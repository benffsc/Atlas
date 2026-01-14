"use client";

import { useState } from "react";

export default function PrintableIntakeForm() {
  const [includeKittenPage, setIncludeKittenPage] = useState(true);

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @media print {
          @page {
            size: letter;
            margin: 0.4in 0.5in;
          }

          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .print-controls {
            display: none !important;
          }

          .print-page {
            padding: 0 !important;
            max-width: 100% !important;
            min-height: auto !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
          }

          .print-page:last-child {
            page-break-after: auto;
          }
        }

        body {
          margin: 0;
          padding: 0;
        }

        .print-wrapper {
          font-family: Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.25;
        }

        .print-page {
          width: 8.5in;
          min-height: 11in;
          padding: 0.4in 0.5in;
          box-sizing: border-box;
          background: #fff;
          color: #000;
        }

        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #000;
          padding-bottom: 4px;
          margin-bottom: 6px;
        }

        .print-header h1 {
          font-size: 15pt;
          margin: 0;
        }

        .print-header .org-info {
          text-align: right;
          font-size: 8pt;
        }

        .section {
          margin-bottom: 6px;
        }

        .section-title {
          font-size: 10pt;
          font-weight: bold;
          background: #e0e0e0;
          padding: 2px 6px;
          margin-bottom: 3px;
          border-left: 3px solid #333;
        }

        .field-row {
          display: flex;
          gap: 6px;
          margin-bottom: 2px;
        }

        .field {
          flex: 1;
          min-width: 0;
        }

        .field.w2 { flex: 2; }
        .field.w3 { flex: 3; }
        .field.third { flex: 0.33; }
        .field.quarter { flex: 0.25; }
        .field.half { flex: 0.5; }

        .field label {
          display: block;
          font-size: 9pt;
          font-weight: bold;
          margin-bottom: 0;
        }

        .field-input {
          border: 1px solid #666;
          padding: 5px 6px;
          min-height: 24px;
          background: #fff;
        }

        .field-input.sm { min-height: 22px; padding: 4px 5px; }
        .field-input.description-box { min-height: 0.9in; }
        .field-input.notes-box { min-height: 0.7in; }
        .field-input.staff-notes { min-height: 1in; }

        .checkbox-item {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          font-size: 10pt;
          margin-right: 5px;
        }

        .bubble {
          width: 12px;
          height: 12px;
          border: 2px solid #000;
          border-radius: 50%;
          background: #fff;
          display: inline-block;
          flex-shrink: 0;
        }

        .bubble.square {
          border-radius: 2px;
        }

        .compact-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2px 10px;
        }

        .question-row {
          display: flex;
          align-items: center;
          font-size: 10pt;
          padding: 1px 0;
        }

        .question-row .qlabel {
          min-width: 110px;
          font-weight: bold;
          font-size: 10pt;
        }

        .required-note {
          font-size: 9pt;
          color: #444;
          margin-bottom: 4px;
        }

        .third-party-box {
          border: 2px solid #ffc107;
          background: #fffbeb;
          padding: 3px 6px;
          margin-bottom: 6px;
          font-size: 10pt;
        }

        .emergency-box {
          border: 2px solid #dc3545;
          background: #fff5f5;
          padding: 3px 8px;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .kitten-note {
          background: #e3f2fd;
          border: 1px solid #2196f3;
          padding: 4px 8px;
          font-size: 9pt;
          margin-top: 4px;
        }

        .info-box {
          border: 1px solid #666;
          padding: 8px;
          margin-bottom: 8px;
          font-size: 9pt;
        }

        .info-box ul {
          margin: 4px 0 0 0;
          padding-left: 18px;
        }

        .staff-section {
          background: #f0f0f0;
          border: 1px solid #999;
          padding: 6px;
          margin-top: 6px;
        }

        .staff-section .section-title {
          background: #d0d0d0;
          margin: -6px -6px 6px -6px;
          padding: 3px 8px;
          border-left: 3px solid #666;
        }

        .signature-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 8px;
          padding-top: 6px;
          border-top: 1px solid #999;
          font-size: 10pt;
        }

        .signature-row .consent {
          font-size: 8pt;
          color: #666;
          max-width: 2.5in;
        }

        @media screen {
          body {
            background: #e5e5e5 !important;
          }

          .print-wrapper {
            padding: 20px;
          }

          .print-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            margin: 0 auto 30px auto;
          }

          .print-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            z-index: 1000;
            min-width: 180px;
          }

          .print-controls h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #333;
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
          }

          .print-controls button {
            display: block;
            width: 100%;
            padding: 10px 16px;
            margin-bottom: 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }

          .print-controls button:last-child {
            margin-bottom: 0;
          }

          .print-controls .print-btn {
            background: #0d6efd;
            color: #fff;
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
          Print / Save as PDF
        </button>
        <a href="/intake/queue" className="back-btn" style={{ textDecoration: "none", textAlign: "center" }}>
          ← Back to Queue
        </a>
      </div>

      {/* ==================== PAGE 1: Main Intake Form ==================== */}
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img src="/logo.png" alt="FF" style={{ height: "36px", width: "auto" }} />
            <h1>Forgotten Felines Request Form</h1>
          </div>
          <div className="org-info">
            <strong>Forgotten Felines of Sonoma County</strong><br />
            (707) 576-7999 | info@forgottenfelines.com
          </div>
        </div>

        <div className="required-note">* Required fields — Fill bubbles completely: ●</div>

        {/* Third-Party Report */}
        <div className="third-party-box">
          <div style={{ display: "flex", alignItems: "center", marginBottom: "2px" }}>
            <span className="bubble square"></span>
            <span style={{ fontWeight: "bold", marginLeft: "5px" }}>
              I am reporting on behalf of someone else
            </span>
            <span style={{ fontSize: "9pt", marginLeft: "6px", color: "#666" }}>(volunteer, neighbor, property manager)</span>
          </div>
          <div className="field-row">
            <div className="field third">
              <label>Relationship</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field third">
              <label>Property Owner Name</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field third">
              <label>Owner Phone/Email</label>
              <div className="field-input sm"></div>
            </div>
          </div>
        </div>

        {/* Section 1: Contact */}
        <div className="section">
          <div className="section-title">1. YOUR CONTACT INFO</div>
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
          <div className="section-title">2. CAT LOCATION</div>
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
          <div className="question-row" style={{ marginTop: "2px" }}>
            <span className="qlabel" style={{ minWidth: "50px" }}>County:</span>
            <span className="checkbox-item"><span className="bubble"></span> Sonoma</span>
            <span className="checkbox-item"><span className="bubble"></span> Marin</span>
            <span className="checkbox-item"><span className="bubble"></span> Napa</span>
            <span className="checkbox-item"><span className="bubble"></span> Other: ________</span>
          </div>
        </div>

        {/* Section 3: About the Cats */}
        <div className="section">
          <div className="section-title">3. ABOUT THE CATS</div>
          <div className="question-row">
            <span className="qlabel">Ownership? *</span>
            <span className="checkbox-item"><span className="bubble"></span> Stray/unknown</span>
            <span className="checkbox-item"><span className="bubble"></span> Community colony</span>
            <span className="checkbox-item"><span className="bubble"></span> My cat</span>
            <span className="checkbox-item"><span className="bubble"></span> Neighbor's cat</span>
            <span className="checkbox-item"><span className="bubble"></span> Unsure</span>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="question-row">
              <span className="qlabel" style={{ minWidth: "80px" }}>How many?</span>
              <div className="field-input sm" style={{ width: "40px" }}></div>
            </div>
            <div className="question-row">
              <span className="qlabel" style={{ minWidth: "100px" }}>Fixed (ear-tip)? *</span>
              <span className="checkbox-item"><span className="bubble"></span> None</span>
              <span className="checkbox-item"><span className="bubble"></span> Some</span>
              <span className="checkbox-item"><span className="bubble"></span> Most/All</span>
              <span className="checkbox-item"><span className="bubble"></span> Unknown</span>
            </div>
          </div>
          <div className="question-row">
            <span className="qlabel">How long aware?</span>
            <span className="checkbox-item"><span className="bubble"></span> &lt;1 week</span>
            <span className="checkbox-item"><span className="bubble"></span> &lt;1 month</span>
            <span className="checkbox-item"><span className="bubble"></span> 1-6 months</span>
            <span className="checkbox-item"><span className="bubble"></span> 6-12 months</span>
            <span className="checkbox-item"><span className="bubble"></span> 1+ year</span>
          </div>
          <div className="question-row">
            <span className="qlabel">Kittens present?</span>
            <span className="checkbox-item"><span className="bubble"></span> Yes</span>
            <span className="checkbox-item"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "8px" }}>How many? ____</span>
            <span style={{ marginLeft: "12px", fontSize: "9pt", color: "#1976d2", fontWeight: "bold" }}>
              → If yes, complete Page 2: Kitten Details
            </span>
          </div>
        </div>

        {/* Emergency */}
        <div className="emergency-box">
          <span className="checkbox-item">
            <span className="bubble square" style={{ width: "14px", height: "14px", borderColor: "#dc3545" }}></span>
            <span style={{ fontWeight: "bold", color: "#dc3545" }}>THIS IS AN EMERGENCY</span>
          </span>
          <span style={{ fontSize: "9pt", color: "#666" }}>(injured cat, active labor, immediate danger)</span>
        </div>

        {/* Section 4: Situation */}
        <div className="section">
          <div className="section-title">4. SITUATION</div>
          <div className="compact-grid">
            <div className="question-row">
              <span className="qlabel">Medical concerns?</span>
              <span className="checkbox-item"><span className="bubble"></span> Yes</span>
              <span className="checkbox-item"><span className="bubble"></span> No</span>
              <span className="checkbox-item"><span className="bubble"></span> Unsure</span>
            </div>
            <div className="question-row">
              <span className="qlabel">Cats being fed?</span>
              <span className="checkbox-item"><span className="bubble"></span> Yes</span>
              <span className="checkbox-item"><span className="bubble"></span> No</span>
              <span className="checkbox-item"><span className="bubble"></span> Unsure</span>
            </div>
            <div className="question-row">
              <span className="qlabel">Property access?</span>
              <span className="checkbox-item"><span className="bubble"></span> Yes</span>
              <span className="checkbox-item"><span className="bubble"></span> No</span>
              <span className="checkbox-item"><span className="bubble"></span> Need to check</span>
            </div>
            <div className="question-row">
              <span className="qlabel">Property owner?</span>
              <span className="checkbox-item"><span className="bubble"></span> Yes</span>
              <span className="checkbox-item"><span className="bubble"></span> No (renter)</span>
            </div>
          </div>
          <div className="question-row" style={{ marginTop: "2px" }}>
            <span className="qlabel">How heard about us?</span>
            <span className="checkbox-item"><span className="bubble"></span> Website</span>
            <span className="checkbox-item"><span className="bubble"></span> Social media</span>
            <span className="checkbox-item"><span className="bubble"></span> Friend/family</span>
            <span className="checkbox-item"><span className="bubble"></span> Vet/shelter</span>
            <span className="checkbox-item"><span className="bubble"></span> Other</span>
          </div>
        </div>

        {/* Section 5: Description */}
        <div className="section">
          <div className="section-title">5. DESCRIBE THE SITUATION</div>
          <p style={{ fontSize: "9pt", color: "#444", margin: "1px 0 3px 0" }}>
            Please tell us more about the cats and the situation:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", fontSize: "8pt", color: "#666", marginBottom: "3px" }}>
            <div>• Cat descriptions (colors, markings, ear-tips seen)</div>
            <div>• Best times to reach you / schedule trapping</div>
            <div>• Medical concerns (injuries, illness, pregnant)</div>
            <div>• Feeding schedule & locations where cats are seen</div>
            <div>• How long have you been feeding them?</div>
            <div>• Access notes (gates, dogs, landlord contact needed)</div>
          </div>
          <div className="field-input" style={{ minHeight: "1.6in" }}></div>
        </div>

        {/* Signature */}
        <div className="signature-row">
          <div className="consent">
            By submitting, you agree to be contacted by Forgotten Felines regarding this request.
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <span><strong>Date:</strong> ______________</span>
            <span><strong>Signature:</strong> ______________________________</span>
          </div>
        </div>

        {/* Staff Section */}
        <div className="staff-section">
          <div className="section-title">FOR OFFICE USE ONLY</div>
          <div className="field-row">
            <div className="field">
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "70px" }}>Date rec'd:</span>
                <div className="field-input sm" style={{ flex: 1 }}></div>
              </div>
            </div>
            <div className="field">
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "70px" }}>Rec'd by:</span>
                <div className="field-input sm" style={{ flex: 1 }}></div>
              </div>
            </div>
            <div className="field">
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "50px" }}>Source:</span>
                <span className="checkbox-item"><span className="bubble"></span> Phone</span>
                <span className="checkbox-item"><span className="bubble"></span> Paper</span>
                <span className="checkbox-item"><span className="bubble"></span> Walk-in</span>
              </div>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "55px" }}>Priority:</span>
                <span className="checkbox-item"><span className="bubble"></span> High</span>
                <span className="checkbox-item"><span className="bubble"></span> Normal</span>
                <span className="checkbox-item"><span className="bubble"></span> Low</span>
              </div>
            </div>
            <div className="field w2">
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "55px" }}>Triage:</span>
                <span className="checkbox-item"><span className="bubble"></span> TNR</span>
                <span className="checkbox-item"><span className="bubble"></span> Wellness</span>
                <span className="checkbox-item"><span className="bubble"></span> Owned-redirect</span>
                <span className="checkbox-item"><span className="bubble"></span> Out of area</span>
                <span className="checkbox-item"><span className="bubble"></span> Review</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== PAGE 2: Kitten Details ==================== */}
      {includeKittenPage && (
        <div className="print-page">
          {/* Header */}
          <div className="print-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <img src="/logo.png" alt="FF" style={{ height: "32px", width: "auto" }} />
              <div>
                <h1 style={{ fontSize: "14pt" }}>Kitten Details</h1>
                <div style={{ fontSize: "8pt", color: "#666" }}>Complete if kittens are present at the location</div>
              </div>
            </div>
            <div style={{ fontSize: "10pt" }}>
              <strong>Requester Name:</strong> ________________________________
            </div>
          </div>

          {/* Section 6: Kitten Info */}
          <div className="section">
            <div className="section-title">6. KITTEN INFORMATION</div>

            <div style={{ display: "flex", gap: "16px", marginBottom: "6px" }}>
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "100px" }}>How many kittens?</span>
                <div className="field-input sm" style={{ width: "40px" }}></div>
              </div>
              <div className="question-row">
                <span className="qlabel" style={{ minWidth: "70px" }}>Age (weeks):</span>
                <div className="field-input sm" style={{ width: "40px" }}></div>
              </div>
            </div>

            <div className="question-row" style={{ marginBottom: "6px" }}>
              <span className="qlabel">Age range *</span>
              <span className="checkbox-item"><span className="bubble"></span> Under 4 wks</span>
              <span className="checkbox-item"><span className="bubble"></span> 4-8 wks</span>
              <span className="checkbox-item"><span className="bubble"></span> 8-12 wks</span>
              <span className="checkbox-item"><span className="bubble"></span> 12-16 wks</span>
              <span className="checkbox-item"><span className="bubble"></span> 4+ months</span>
              <span className="checkbox-item"><span className="bubble"></span> Mixed ages</span>
            </div>

            <div style={{ marginBottom: "6px" }}>
              <label style={{ fontWeight: "bold", fontSize: "9pt" }}>If mixed ages, describe (e.g., "3 at 8 weeks, 2 at 5 months"):</label>
              <div className="field-input sm"></div>
            </div>

            <div className="question-row" style={{ marginBottom: "6px" }}>
              <span className="qlabel">Behavior *</span>
              <span className="checkbox-item"><span className="bubble"></span> Friendly (handleable)</span>
              <span className="checkbox-item"><span className="bubble"></span> Shy but can pick up</span>
              <span className="checkbox-item"><span className="bubble"></span> Feral/hissy (young)</span>
              <span className="checkbox-item"><span className="bubble"></span> Feral (older)</span>
              <span className="checkbox-item"><span className="bubble"></span> Unknown</span>
            </div>

            <div className="compact-grid" style={{ marginBottom: "6px" }}>
              <div className="question-row">
                <span className="qlabel">Kittens contained?</span>
                <span className="checkbox-item"><span className="bubble"></span> Yes, all caught</span>
                <span className="checkbox-item"><span className="bubble"></span> Some caught</span>
                <span className="checkbox-item"><span className="bubble"></span> No</span>
              </div>
              <div className="question-row">
                <span className="qlabel">Mom cat present?</span>
                <span className="checkbox-item"><span className="bubble"></span> Yes</span>
                <span className="checkbox-item"><span className="bubble"></span> No</span>
                <span className="checkbox-item"><span className="bubble"></span> Unsure</span>
              </div>
              <div className="question-row">
                <span className="qlabel">Mom fixed (ear-tip)?</span>
                <span className="checkbox-item"><span className="bubble"></span> Yes</span>
                <span className="checkbox-item"><span className="bubble"></span> No</span>
                <span className="checkbox-item"><span className="bubble"></span> Unsure</span>
              </div>
              <div className="question-row">
                <span className="qlabel">Can bring them in?</span>
                <span className="checkbox-item"><span className="bubble"></span> Yes</span>
                <span className="checkbox-item"><span className="bubble"></span> Need help</span>
                <span className="checkbox-item"><span className="bubble"></span> No</span>
              </div>
            </div>

            <div style={{ marginBottom: "8px" }}>
              <label style={{ fontWeight: "bold", fontSize: "9pt" }}>Kitten details (colors, where they hide, feeding times, trap-savvy):</label>
              <div className="field-input notes-box"></div>
            </div>
          </div>

          {/* Foster Info */}
          <div className="info-box">
            <strong>About our foster program:</strong>
            <ul>
              <li><strong>Age matters:</strong> Under 12 weeks is ideal. 12-16 weeks needs intensive socialization. 4+ months is difficult.</li>
              <li><strong>Behavior matters:</strong> Friendly/handleable kittens are prioritized for foster placement.</li>
              <li><strong>Mom helps:</strong> Spayed mom with kittens increases foster likelihood.</li>
              <li><strong>Foster space is limited</strong> and not guaranteed until day of assessment.</li>
              <li>Older or feral kittens (12+ weeks, hard to handle) may need TNR instead of foster.</li>
            </ul>
          </div>

          {/* Staff Section */}
          <div className="staff-section">
            <div className="section-title">FOR OFFICE USE ONLY — KITTEN ASSESSMENT</div>

            <div className="field-row" style={{ marginBottom: "6px" }}>
              <div className="field">
                <div className="question-row">
                  <span className="qlabel" style={{ minWidth: "80px" }}>Assessment by:</span>
                  <div className="field-input sm" style={{ flex: 1 }}></div>
                </div>
              </div>
              <div className="field">
                <div className="question-row">
                  <span className="qlabel" style={{ minWidth: "50px" }}>Date:</span>
                  <div className="field-input sm" style={{ flex: 1 }}></div>
                </div>
              </div>
            </div>

            <div className="field-row" style={{ marginBottom: "6px" }}>
              <div className="field">
                <div className="question-row">
                  <span className="qlabel" style={{ minWidth: "110px" }}>Kitten outcome:</span>
                  <span className="checkbox-item"><span className="bubble"></span> Foster intake</span>
                  <span className="checkbox-item"><span className="bubble"></span> TNR candidate</span>
                  <span className="checkbox-item"><span className="bubble"></span> Pending space</span>
                  <span className="checkbox-item"><span className="bubble"></span> Declined</span>
                </div>
              </div>
            </div>

            <div className="field-row" style={{ marginBottom: "6px" }}>
              <div className="field">
                <div className="question-row">
                  <span className="qlabel" style={{ minWidth: "110px" }}>Foster readiness:</span>
                  <span className="checkbox-item"><span className="bubble"></span> High (friendly, ideal age)</span>
                  <span className="checkbox-item"><span className="bubble"></span> Medium (needs work)</span>
                  <span className="checkbox-item"><span className="bubble"></span> Low (TNR likely)</span>
                </div>
              </div>
            </div>

            <div className="field-row" style={{ marginBottom: "6px" }}>
              <div className="field">
                <div className="question-row">
                  <span className="qlabel" style={{ minWidth: "110px" }}>Urgency factors:</span>
                  <span className="checkbox-item"><span className="bubble square"></span> Bottle babies</span>
                  <span className="checkbox-item"><span className="bubble square"></span> Medical needs</span>
                  <span className="checkbox-item"><span className="bubble square"></span> Unsafe location</span>
                  <span className="checkbox-item"><span className="bubble square"></span> Mom unfixed</span>
                </div>
              </div>
            </div>

            <div>
              <label style={{ fontWeight: "bold", fontSize: "9pt" }}>Staff notes (foster contact, follow-up needed, trapping plan):</label>
              <div className="field-input staff-notes"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
