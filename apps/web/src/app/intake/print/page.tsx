"use client";

import { useState } from "react";
import { PRINT_BASE_CSS } from "@/lib/print-styles";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import {
  Bubble,
  Check,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
  PrintSection,
  FieldRow,
  OptionsRow,
} from "@/components/print";
import {
  getShortLabels,
  getLabels,
  AWARENESS_DURATION_OPTIONS,
  HOME_ACCESS_OPTIONS,
  KITTEN_BEHAVIOR_INTAKE_OPTIONS,
  KITTEN_CONTAINED_OPTIONS,
  MOM_FIXED_OPTIONS,
  CAN_BRING_IN_OPTIONS,
  PRIORITY_OPTIONS,
  TRIAGE_CATEGORY_OPTIONS,
  INTAKE_SOURCE_OPTIONS,
  KITTEN_OUTCOME_OPTIONS,
  KITTEN_READINESS_OPTIONS,
} from "@/lib/form-options";
import {
  COUNTY,
  OWNERSHIP_STATUS,
  EARTIP_STATUS,
  FEEDING_FREQUENCY_PRINT,
  KITTEN_AGE_ESTIMATE,
  MOM_PRESENT,
  KITTEN_URGENCY,
  REFERRAL_SOURCE_PRINT,
} from "@/lib/field-options";

// Derived from centralized registry (form-options.ts)
const AWARENESS_DURATION = getShortLabels(AWARENESS_DURATION_OPTIONS);
const HOME_ACCESS = getShortLabels(HOME_ACCESS_OPTIONS);
const KITTEN_BEHAVIOR_INTAKE = getLabels(KITTEN_BEHAVIOR_INTAKE_OPTIONS);
const KITTEN_CONTAINED_INTAKE = getLabels(KITTEN_CONTAINED_OPTIONS);
const MOM_FIXED = getShortLabels(MOM_FIXED_OPTIONS);
const CAN_BRING_IN_PRINT = getShortLabels(CAN_BRING_IN_OPTIONS);
const PRIORITY = getShortLabels(PRIORITY_OPTIONS);
const TRIAGE_CATEGORY_PRINT = getShortLabels(TRIAGE_CATEGORY_OPTIONS);
const INTAKE_SOURCE = getShortLabels(INTAKE_SOURCE_OPTIONS);
const KITTEN_OUTCOME = getShortLabels(KITTEN_OUTCOME_OPTIONS);
const KITTEN_READINESS = getShortLabels(KITTEN_READINESS_OPTIONS);

type FormVersion = "staff" | "client";

export default function PrintableIntakeForm() {
  const { nameFull, nameShort, phone, website } = useOrgConfig();
  const [includeKittenPage, setIncludeKittenPage] = useState(true);
  const [formVersion, setFormVersion] = useState<FormVersion>("client");

  const isStaff = formVersion === "staff";

  const versionBadge = (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "8pt",
        fontWeight: 600,
        background: isStaff ? "#e8f4fd" : "#f0fdf4",
        color: isStaff ? "#2980b9" : "#166534",
      }}
    >
      {isStaff ? "Staff Use" : "Client Form"}
    </span>
  );

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        ${PRINT_BASE_CSS}

        /* ── Intake form sizing overrides ── */
        .print-page { height: 10.2in; }

        ${isStaff ? `
          .print-wrapper { font-size: 10pt; line-height: 1.3; }
          .section { margin-bottom: 14px; }
          .section-title { font-size: 11pt; margin-bottom: 8px; padding-bottom: 3px; }
          .field-row { gap: 12px; margin-bottom: 8px; }
          .field label { font-size: 8pt; margin-bottom: 2px; }
          .field-input { padding: 6px 8px; min-height: 28px; border-radius: 4px; }
          .field-input.sm { min-height: 26px; padding: 5px 7px; }
          .field-input.md { min-height: 60px; }
          .field-input.lg { min-height: 90px; }
          .field-input.xl { min-height: 120px; }
          .options-row { gap: 4px; font-size: 9.5pt; margin-bottom: 4px; }
          .option { gap: 4px; margin-right: 14px; }
          .bubble { width: 14px; height: 14px; }
          .checkbox { width: 14px; height: 14px; }
          .staff-box { padding: 12px 14px; margin-top: 14px; }
          .print-header { margin-bottom: 12px; }
        ` : `
          .print-wrapper { font-size: 9.5pt; }
          .section { margin-bottom: 10px; }
          .section-title { font-size: 10pt; margin-bottom: 6px; }
          .field-row { gap: 10px; margin-bottom: 6px; }
          .field label { font-size: 7.5pt; }
          .field-input { padding: 4px 6px; min-height: 22px; }
          .field-input.sm { min-height: 20px; padding: 3px 5px; }
          .field-input.md { min-height: 45px; }
          .field-input.lg { min-height: 70px; }
          .field-input.xl { min-height: 100px; }
          .options-row { gap: 3px; font-size: 9pt; margin-bottom: 3px; }
          .option { gap: 3px; margin-right: 10px; }
          .bubble { width: 12px; height: 12px; }
          .checkbox { width: 12px; height: 12px; }
          .staff-box { padding: 10px 12px; margin-top: 10px; }
          .print-header { margin-bottom: 10px; }
        `}

        /* ── Intake-specific styles ── */
        .third-party-box {
          border: 1.5px solid #f39c12;
          background: #fef9e7;
          padding: 8px 10px;
          margin-bottom: ${isStaff ? "14px" : "10px"};
          border-radius: 6px;
        }
        .third-party-box .title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          margin-bottom: 6px;
          color: #e67e22;
          font-size: 9pt;
        }

        .signature-area {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid #ecf0f1;
        }
        .signature-area .consent {
          font-size: 7.5pt;
          color: #7f8c8d;
          max-width: 2.5in;
        }
        .signature-area .sig-fields {
          display: flex;
          gap: 20px;
          font-size: 9pt;
        }

        .foster-info {
          background: #f0fdf4;
          border-left: 4px solid #27ae60;
          padding: 12px 14px;
          border-radius: 0 8px 8px 0;
          margin-bottom: 12px;
        }
        .foster-info h3 {
          color: #166534;
          font-size: 11pt;
          margin: 0 0 8px 0;
        }
        .foster-info ul {
          margin: 0;
          padding-left: 18px;
          font-size: 9pt;
          line-height: 1.5;
        }
        .foster-info li { margin-bottom: 4px; }

        @media print {
          .print-header { margin-bottom: 8px !important; }
          .section { margin-bottom: 7px !important; }
          .third-party-box { margin-bottom: 8px !important; }
          .staff-box { margin-top: 6px !important; padding: 8px 10px !important; }
          .signature-area { margin-top: 8px !important; }
        }
      `}</style>

      {/* ── Print Controls ── */}
      <PrintControlsPanel
        title="Print Options"
        backHref="/intake/queue"
        backLabel="← Back to Queue"
      >
        <div style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 600, color: "#666" }}>
          Form Version
        </div>
        <div className="version-selector">
          <button
            className={formVersion === "staff" ? "active" : ""}
            onClick={() => setFormVersion("staff")}
          >
            Staff
          </button>
          <button
            className={formVersion === "client" ? "active" : ""}
            onClick={() => setFormVersion("client")}
          >
            Client
          </button>
        </div>
        <div className="ctrl-hint">
          {isStaff
            ? "Simplified form with larger boxes for phone intake"
            : "Full form with guidance for clients to fill out"}
        </div>
        <label>
          <input
            type="checkbox"
            checked={includeKittenPage}
            onChange={(e) => setIncludeKittenPage(e.target.checked)}
          />
          Include Kitten Page
        </label>
      </PrintControlsPanel>

      {/* ==================== PAGE 1: Main Intake Form ==================== */}
      <div className="print-page">
        <PrintHeader
          title="Help Request Form"
          subtitle={isStaff ? "Phone/walk-in intake form" : "Tell us about the cats that need help"}
          rightContent={versionBadge}
        />

        {/* Intro Note - Client only */}
        {!isStaff && (
          <div className="info-box" style={{ marginBottom: "10px", fontSize: "8.5pt" }}>
            <strong>Thank you for reaching out!</strong> Fill out this form completely so we can best help the cats.
            Fill bubbles completely: ● &nbsp;|&nbsp; <strong>Phone:</strong> {phone} &nbsp;|&nbsp; <strong>Web:</strong> {website}
          </div>
        )}

        {/* Third-Party Report */}
        <div className="third-party-box">
          <div className="title">
            <span className="checkbox"></span>
            Reporting on behalf of someone else?
            {!isStaff && <span className="hint">(neighbor, property manager, etc.)</span>}
          </div>
          <FieldRow style={{ marginBottom: 0 }}>
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
          </FieldRow>
        </div>

        {/* Section 1: Contact */}
        <PrintSection title={isStaff ? "Caller Contact Information" : "Your Contact Information"}>
          <FieldRow style={{ marginBottom: 0 }}>
            <div className="field"><label>First Name *</label><div className="field-input sm"></div></div>
            <div className="field"><label>Last Name *</label><div className="field-input sm"></div></div>
            <div className="field"><label>Phone</label><div className="field-input sm"></div></div>
            <div className="field w2"><label>Email *</label><div className="field-input sm"></div></div>
          </FieldRow>
        </PrintSection>

        {/* Section 2: Location */}
        <PrintSection title="Where are the cats?">
          <FieldRow>
            <div className="field w3"><label>Street Address *</label><div className="field-input sm"></div></div>
            <div className="field"><label>City</label><div className="field-input sm"></div></div>
            <div className="field half"><label>ZIP</label><div className="field-input sm"></div></div>
          </FieldRow>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "55px" }}>County:</span>
            {COUNTY.map(c => <Bubble key={c} filled={false} label={c === "Other" ? "Other: ________" : c} />)}
          </div>
        </PrintSection>

        {/* Section 3: About the Cats */}
        <PrintSection title="About the Cats">
          <OptionsRow label="Type:">
            {OWNERSHIP_STATUS.map(s => <Bubble key={s} filled={false} label={s} />)}
          </OptionsRow>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "4px" }}>
            <div className="field" style={{ flex: "0 0 100px" }}>
              <label>How many cats?</label>
              <div className="field-input sm" style={{ width: "60px" }}></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Eartipped?</span>
              {EARTIP_STATUS.map(s => <Bubble key={s} filled={false} label={s} />)}
            </div>
          </div>

          <div className="info-card" style={{ marginTop: "6px", marginBottom: "6px" }}>
            <div className="options-row" style={{ marginBottom: "2px" }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Feed them?</span>
              <Bubble filled={false} label="Yes" />
              <Bubble filled={false} label="No" />
              <span style={{ marginLeft: "10px", fontWeight: 600 }}>How often?</span>
              {FEEDING_FREQUENCY_PRINT.map(f => <Bubble key={f} filled={false} label={f} />)}
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>How long?</span>
              {AWARENESS_DURATION.map(d => <Bubble key={d} filled={false} label={d} />)}
              <span style={{ marginLeft: "10px", fontWeight: 600 }}>Come inside?</span>
              {HOME_ACCESS.map(h => <Bubble key={h} filled={false} label={h} />)}
            </div>
          </div>

          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "80px" }}>Kittens?</span>
            <Bubble filled={false} label="Yes" />
            <Bubble filled={false} label="No" />
            <span style={{ marginLeft: "8px" }}>How many? ____</span>
            <span className="hint" style={{ marginLeft: "10px", color: "#27ae60", fontWeight: 600 }}>
              If yes, complete Page 2
            </span>
          </div>
        </PrintSection>

        {/* Emergency */}
        <div className="emergency-box">
          <div className="title">
            <span className="checkbox"></span>
            This is an urgent situation
            {!isStaff && <span className="hint">(injured, trapped, abandoned kittens)</span>}
          </div>
          {!isStaff && (
            <div style={{ fontSize: "8pt", color: "#7f8c8d" }}>
              <strong>Note:</strong> {nameShort} is a spay/neuter clinic, NOT a 24hr hospital. For life-threatening emergencies:
              <strong> Pet Care Hospital (707) 579-3900</strong>
              <span style={{ marginLeft: "10px" }}>
                <span className="checkbox" style={{ width: "10px", height: "10px", display: "inline-block", verticalAlign: "middle" }}></span>
                <span style={{ marginLeft: "3px" }}>I acknowledge this</span>
              </span>
            </div>
          )}
          {isStaff && (
            <div style={{ fontSize: "8.5pt", color: "#7f8c8d" }}>
              <strong>Pet Care Hospital:</strong> (707) 579-3900
              <span style={{ marginLeft: "16px" }}>
                <span className="checkbox" style={{ width: "10px", height: "10px", display: "inline-block", verticalAlign: "middle" }}></span>
                <span style={{ marginLeft: "3px" }}>Acknowledged</span>
              </span>
            </div>
          )}
        </div>

        {/* Section 4: Additional Details */}
        <PrintSection title="Additional Details">
          <div className="options-row" style={{ marginBottom: "4px" }}>
            <Check label="Medical concerns" />
            <Check label="Property access available" />
            <Check label={isStaff ? "Property owner" : "I'm the property owner"} />
            <Check label="Others also feeding" />
            {!isStaff && (
              <>
                <span style={{ marginLeft: "14px", fontWeight: 600 }}>Heard from:</span>
                {REFERRAL_SOURCE_PRINT.map(r => <Bubble key={r} filled={false} label={r} />)}
              </>
            )}
          </div>
          {!isStaff && (
            <div style={{ fontSize: "8pt", color: "#7f8c8d", marginBottom: "4px" }}>
              Describe: cat colors/behavior, medical concerns, best times to reach you, where cats are seen, access notes
            </div>
          )}
          <div className="field-input lg"></div>
        </PrintSection>

        {/* Signature - client only */}
        {!isStaff && (
          <div className="signature-area">
            <div className="consent">
              By submitting, you agree to be contacted by {nameFull} regarding this request.
            </div>
            <div className="sig-fields">
              <span><strong>Date:</strong> ____________</span>
              <span><strong>Signature:</strong> ____________________________</span>
            </div>
          </div>
        )}

        {/* Staff Section */}
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
              {INTAKE_SOURCE.slice(0, 3).map(s => <Bubble key={s} filled={false} label={s} />)}
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "50px" }}>Priority:</span>
            {PRIORITY.map(p => <Bubble key={p} filled={false} label={p} />)}
            <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "50px" }}>Triage:</span></span>
            {TRIAGE_CATEGORY_PRINT.map(t => <Bubble key={t} filled={false} label={t} />)}
          </div>
          {isStaff && (
            <div className="field" style={{ marginTop: "8px" }}>
              <label>Staff notes</label>
              <div className="field-input md"></div>
            </div>
          )}
        </div>

        <PrintFooter
          left={`${nameFull} • ${phone} • ${website}`}
          right={`Page 1${includeKittenPage ? " of 2" : ""}`}
        />
      </div>

      {/* ==================== PAGE 2: Kitten Details ==================== */}
      {includeKittenPage && (
        <div className="print-page">
          <PrintHeader
            title="Kitten Details"
            subtitle="Complete if kittens are present at the location"
            rightContent={versionBadge}
          />

          <FieldRow style={{ marginBottom: "12px" }}>
            <div className="field w2">
              <label>Requester Name (from page 1)</label>
              <div className="field-input sm"></div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="field-input sm"></div>
            </div>
          </FieldRow>

          {/* Kitten Info */}
          <PrintSection title="Kitten Information">
            <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
              <div className="field" style={{ flex: "0 0 120px" }}>
                <label>How many kittens?</label>
                <div className="field-input sm" style={{ width: "60px" }}></div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Age range:</span>
                {KITTEN_AGE_ESTIMATE.map(a => <Bubble key={a} filled={false} label={a} />)}
              </div>
            </div>

            <div className="field" style={{ marginTop: "6px", marginBottom: "8px" }}>
              <label>If mixed ages, describe (e.g., &quot;3 at 8 weeks, 2 at 5 months&quot;)</label>
              <div className="field-input sm"></div>
            </div>

            <div className="options-row" style={{ marginBottom: "6px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Behavior:</span>
              {KITTEN_BEHAVIOR_INTAKE.map(b => <Bubble key={b} filled={false} label={b} />)}
            </div>

            <div className="info-card" style={{ marginTop: "6px", marginBottom: "8px" }}>
              <div className="options-row" style={{ marginBottom: "3px" }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Contained?</span>
                {KITTEN_CONTAINED_INTAKE.map(c => <Bubble key={c} filled={false} label={c} />)}
                <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Mom present?</span></span>
                {MOM_PRESENT.map(m => <Bubble key={m} filled={false} label={m} />)}
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Mom fixed?</span>
                {MOM_FIXED.map(m => <Bubble key={m} filled={false} label={m} />)}
                <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Can bring in?</span></span>
                {CAN_BRING_IN_PRINT.map(c => <Bubble key={c} filled={false} label={c} />)}
              </div>
            </div>

            <div className="field" style={{ marginTop: "8px" }}>
              <label>Kitten details (colors, where they hide, feeding times, trap-savvy)</label>
              <div className="field-input md"></div>
            </div>
          </PrintSection>

          {/* Foster Info - Client only */}
          {!isStaff && (
            <div className="foster-info">
              <h3>About Our Foster Program</h3>
              <ul>
                <li><strong>Age matters:</strong> Under 12 weeks is ideal for socialization. 12-16 weeks needs intensive work.</li>
                <li><strong>Behavior matters:</strong> Friendly/handleable kittens are prioritized for foster placement.</li>
                <li><strong>Mom helps:</strong> Spayed mom with kittens increases foster likelihood.</li>
                <li>Older or feral kittens (12+ weeks, hard to handle) may need Feral Fix &amp; Return (FFR) instead.</li>
                <li><strong>Space is limited</strong> and foster placement is not guaranteed until day of assessment.</li>
              </ul>
            </div>
          )}

          {/* Staff Kitten Assessment */}
          <div className="staff-box">
            <div className="section-title">Kitten Assessment (Office Use)</div>
            <FieldRow style={{ alignItems: "center", marginBottom: "6px" }}>
              <div className="field" style={{ flex: "0 0 160px" }}>
                <label>Assessment by</label>
                <div className="field-input sm"></div>
              </div>
              <div className="field" style={{ flex: "0 0 120px" }}>
                <label>Date</label>
                <div className="field-input sm"></div>
              </div>
            </FieldRow>

            <div className="options-row" style={{ marginBottom: "4px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Outcome:</span>
              {KITTEN_OUTCOME.map(o => <Bubble key={o} filled={false} label={o} />)}
            </div>

            <div className="options-row" style={{ marginBottom: "4px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Readiness:</span>
              {KITTEN_READINESS.map(r => <Bubble key={r} filled={false} label={r} />)}
            </div>

            <div className="options-row" style={{ marginBottom: "6px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Urgency:</span>
              {KITTEN_URGENCY.map(u => <Check key={u} label={u} />)}
            </div>

            <div className="field" style={{ marginTop: "6px" }}>
              <label>Staff notes (foster contact, follow-up, trapping plan)</label>
              <div className="field-input lg"></div>
            </div>
          </div>

          <PrintFooter
            left={`${nameFull} • Helping community cats since 1990`}
            right="Page 2 of 2"
          />
        </div>
      )}
    </div>
  );
}
