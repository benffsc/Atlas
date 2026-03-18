"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import {
  EditableField,
  EditableTextArea,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";
import {
  getShortLabels,
  AWARENESS_DURATION_OPTIONS,
  HAS_PROPERTY_ACCESS_OPTIONS,
  IS_PROPERTY_OWNER_OPTIONS,
  DOGS_ON_SITE_OPTIONS,
  TRAP_SAVVY_OPTIONS,
  PREVIOUS_TNR_OPTIONS,
  KITTEN_CONTAINED_OPTIONS,
  MOM_FIXED_OPTIONS,
  CAN_BRING_IN_OPTIONS,
  KITTEN_OUTCOME_OPTIONS,
  PRIORITY_OPTIONS,
  TRIAGE_CATEGORY_OPTIONS,
} from "@/lib/form-options";
import {
  COUNTY,
  PROPERTY_TYPE_PRINT,
  OWNERSHIP_STATUS,
  EARTIP_STATUS,
  FEEDING_FREQUENCY_PRINT,
  COLONY_DURATION_PRINT,
  HANDLEABILITY,
  IMPORTANT_NOTES,
  KITTEN_AGE_ESTIMATE,
  KITTEN_BEHAVIOR,
  MOM_PRESENT,
  REFERRAL_SOURCE_PRINT,
} from "@/lib/field-options";

// Derived from centralized registry (form-options.ts)
const AWARENESS_DURATION = getShortLabels(AWARENESS_DURATION_OPTIONS);
const HAS_PROPERTY_ACCESS_PRINT = getShortLabels(HAS_PROPERTY_ACCESS_OPTIONS);
const IS_PROPERTY_OWNER = getShortLabels(IS_PROPERTY_OWNER_OPTIONS);
const DOGS_ON_SITE = getShortLabels(DOGS_ON_SITE_OPTIONS);
const TRAP_SAVVY = getShortLabels(TRAP_SAVVY_OPTIONS);
const PREVIOUS_TNR = getShortLabels(PREVIOUS_TNR_OPTIONS);
const KITTEN_CONTAINED = getShortLabels(KITTEN_CONTAINED_OPTIONS);
const MOM_FIXED = getShortLabels(MOM_FIXED_OPTIONS);
const CAN_BRING_IN_PRINT = getShortLabels(CAN_BRING_IN_OPTIONS);
const KITTEN_OUTCOME = getShortLabels(KITTEN_OUTCOME_OPTIONS);
const PRIORITY = getShortLabels(PRIORITY_OPTIONS);
const TRIAGE_CATEGORY_PRINT = getShortLabels(TRIAGE_CATEGORY_OPTIONS);

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
  const { nameFull, phone, website } = useOrgConfig();
  const [prefill, setPrefill] = useState<Prefill>(EMPTY_PREFILL);
  const [includeKittenPage, setIncludeKittenPage] = useState(true);
  const isBlank = searchParams.get("blank") === "true";

  useEffect(() => {
    if (isBlank) {
      const timer = setTimeout(() => window.print(), 300);
      return () => clearTimeout(timer);
    }
  }, [isBlank]);

  useEffect(() => {
    if (isBlank) return;
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
  }, [searchParams, isBlank]);

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        ${PRINT_BASE_CSS}
        ${PRINT_EDITABLE_CSS}

        /* TNR Call Sheet overrides */
        .print-wrapper { font-size: 10pt; line-height: 1.3; }
        .print-page { height: 10.2in; }
        .print-header { margin-bottom: 12px; }
        .print-header h1 { font-size: 16pt; }
        .section { margin-bottom: 12px; }
        .section-title { font-size: 11pt; margin-bottom: 8px; padding-bottom: 3px; }
        .field-row { gap: 12px; margin-bottom: 8px; }
        .field label { font-size: 8pt; margin-bottom: 2px; }
        .field-input { padding: 6px 8px; min-height: 28px; border-radius: 4px; font-size: 10pt; }
        .field-input.sm { min-height: 26px; padding: 5px 7px; }
        .field-input.md { min-height: 55px; }
        .field-input.lg { min-height: 80px; }
        .field-input.xl { min-height: 110px; }
        .options-row { gap: 4px; font-size: 9.5pt; margin-bottom: 6px; }
        .options-label { min-width: 90px; font-size: 9.5pt; }
        .option { gap: 4px; margin-right: 12px; }
        .bubble { width: 13px; height: 13px; }
        .checkbox { width: 13px; height: 13px; }
        .two-col { gap: 16px; }
        .quick-notes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .quick-note { gap: 5px; font-size: 9pt; padding: 2px 0; }

        .date-field {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 10pt;
        }
        .date-field .field-input { width: 100px; display: inline-block; }

        /* Prefill controls (screen only) */
        @media screen {
          .print-controls .ctrl-field { margin-bottom: 8px; }
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
          .print-controls .ctrl-field textarea { min-height: 50px; resize: vertical; }
        }

        @media print {
          .print-header { margin-bottom: 10px !important; }
          .section { margin-bottom: 10px !important; }
        }
      `}</style>

      {/* Print Controls (hidden in blank mode) */}
      {!isBlank && (
        <PrintControlsPanel
          title="TNR Call Sheet"
          description="Pre-fill from voicemail, then print front & back"
          backHref="/requests"
          backLabel="Back to Requests"
        >
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
          <label>
            <input type="checkbox" checked={includeKittenPage} onChange={(e) => setIncludeKittenPage(e.target.checked)} />
            Include Kitten Section
          </label>
          <a href="/requests/print?blank=true" style={{ textDecoration: "none" }}>
            <button className="back-btn" style={{ width: "100%", marginTop: "6px" }}>Print Blank Form</button>
          </a>
          <div className="ctrl-hint">
            Print front &amp; back for Crystal. After callback, enter data at <strong>/intake/call-sheet</strong> &mdash; you can submit to queue or create a request directly.
          </div>
        </PrintControlsPanel>
      )}

      {/* ═══════════════════ PAGE 1 (FRONT): Contact & Cats ═══════════════════ */}
      <div className="print-page">
        <PrintHeader
          title="TNR Call Sheet"
          subtitle={nameFull}
          rightContent={
            <div className="date-field">
              <strong>Date:</strong>
              <div className="field-input sm" style={{ width: "100px" }}>
                <input type="text" placeholder="__/__/____" />
              </div>
            </div>
          }
        />

        {/* Contact Information */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="field-row">
            <EditableField label="First Name *" value={prefill.first_name || null} placeholder="First" />
            <EditableField label="Last Name *" value={prefill.last_name || null} placeholder="Last" />
            <EditableField label="Phone *" value={prefill.phone || null} placeholder="(707) 555-0000" />
            <EditableField label="Email" value={prefill.email || null} placeholder="email@example.com" style={{ flex: 2 }} />
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "125px" }}>Third-party report?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "10px" }}>Relationship: <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "150px", font: "inherit", padding: 0 }} /></span>
          </div>
        </div>

        {/* Cat Location */}
        <div className="section">
          <div className="section-title">Where Are the Cats?</div>
          <div className="field-row">
            <EditableField label="Street Address *" value={prefill.address || null} placeholder="123 Main St" style={{ flex: 3 }} />
            <EditableField label="City" value={prefill.city || null} placeholder="Santa Rosa" />
            <EditableField label="ZIP" placeholder="95401" style={{ flex: 0.5 }} />
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "55px" }}>County:</span>
            {COUNTY.filter(c => c !== "Other").map(c => (
              <span key={c} className="option"><span className="bubble"></span> {c}</span>
            ))}
            <span className="option"><span className="bubble"></span> Other: <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "60px", font: "inherit", padding: 0 }} /></span>
            <span style={{ marginLeft: "20px" }}><span className="options-label" style={{ minWidth: "60px" }}>Property:</span></span>
            {PROPERTY_TYPE_PRINT.map(p => (
              <span key={p} className="option"><span className="bubble"></span> {p}</span>
            ))}
          </div>
        </div>

        {/* About the Cats */}
        <div className="section">
          <div className="section-title">About the Cats</div>
          <div className="options-row">
            <span className="options-label" style={{ minWidth: "65px" }}>Type:</span>
            {OWNERSHIP_STATUS.map(o => (
              <span key={o} className="option"><span className="bubble"></span> {o}</span>
            ))}
          </div>
          <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
            <div className="field" style={{ flex: "0 0 110px" }}>
              <label>How many cats?</label>
              <div className="field-input sm" style={{ width: "60px" }}><input type="text" placeholder="#" /></div>
            </div>
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Eartipped?</span>
              {EARTIP_STATUS.map(e => (
                <span key={e} className="option"><span className="bubble"></span> {e}</span>
              ))}
            </div>
          </div>

          <div className="info-card">
            <div className="options-row" style={{ marginBottom: "2px" }}>
              <span className="options-label" style={{ minWidth: "80px" }}>Feed them?</span>
              <span className="option"><span className="bubble"></span> Yes</span>
              <span className="option"><span className="bubble"></span> No</span>
              <span style={{ marginLeft: "10px", fontWeight: 600 }}>How often?</span>
              {FEEDING_FREQUENCY_PRINT.map(f => (
                <span key={f} className="option"><span className="bubble"></span> {f}</span>
              ))}
            </div>
            <div className="options-row" style={{ marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "80px" }}>How long?</span>
              {AWARENESS_DURATION.map(a => (
                <span key={a} className="option"><span className="bubble"></span> {a === "1+ year" ? "Year+" : a}</span>
              ))}
              <span style={{ marginLeft: "10px", fontWeight: 600 }}>Colony duration?</span>
              {COLONY_DURATION_PRINT.map(c => (
                <span key={c} className="option"><span className="bubble"></span> {c}</span>
              ))}
            </div>
          </div>

          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "80px" }}>Kittens?</span>
            <span className="option"><span className="bubble"></span> Yes</span>
            <span className="option"><span className="bubble"></span> No</span>
            <span style={{ marginLeft: "8px" }}>How many? <input type="text" style={{ border: "none", borderBottom: "1px solid #bdc3c7", width: "30px", font: "inherit", padding: 0 }} /></span>
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
            {REFERRAL_SOURCE_PRINT.map(r => (
              <span key={r} className="option"><span className="bubble"></span> {r}</span>
            ))}
          </div>
          <div style={{ fontSize: "7.5pt", color: "#7f8c8d", marginBottom: "4px" }}>
            Describe: cat colors/behavior, medical concerns, access notes, callback preferences, situation details
          </div>
          <EditableTextArea placeholder="Details..." size="lg" />
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
            <EditableField label="Date received" placeholder="MM/DD/YYYY" style={{ flex: "0 0 130px" }} />
            <EditableField label="Received by" placeholder="Staff initials" style={{ flex: "0 0 130px" }} />
            <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
              <span className="options-label" style={{ minWidth: "50px" }}>Source:</span>
              <span className="option"><span className="bubble"></span> Phone</span>
              <span className="option"><span className="bubble"></span> Paper</span>
              <span className="option"><span className="bubble"></span> Walk-in</span>
            </div>
          </div>
          <div className="options-row" style={{ marginBottom: 0 }}>
            <span className="options-label" style={{ minWidth: "55px" }}>Priority:</span>
            {PRIORITY.map(p => (
              <span key={p} className="option"><span className="bubble"></span> {p}</span>
            ))}
            <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "50px" }}>Triage:</span></span>
            {TRIAGE_CATEGORY_PRINT.map(t => (
              <span key={t} className="option"><span className="bubble"></span> {t}</span>
            ))}
          </div>
        </div>

        <PrintFooter
          left={`${nameFull} &bull; ${phone} &bull; ${website}`}
          right={`Page 1${includeKittenPage ? " of 2" : ""}`}
        />
      </div>

      {/* ═══════════════════ PAGE 2 (BACK): Trapping & Kittens ═══════════════════ */}
      {includeKittenPage && (
        <div className="print-page">
          <PrintHeader
            title="Trapping &amp; Kitten Details"
            subtitle="Complete during callback — print on back of Page 1"
          />

          {/* Requester reference */}
          <div className="field-row" style={{ marginBottom: "10px" }}>
            <EditableField label="Caller Name (from page 1)" placeholder="Name" style={{ flex: 2 }} />
            <EditableField label="Phone" placeholder="(707) 555-0000" />
          </div>

          {/* Property Access & Logistics */}
          <div className="section">
            <div className="section-title">Property Access &amp; Logistics</div>
            <div className="two-col">
              <div>
                <div className="options-row">
                  <span className="options-label">Property access?</span>
                  {HAS_PROPERTY_ACCESS_PRINT.map(a => (
                    <span key={a} className="option"><span className="bubble"></span> {a}</span>
                  ))}
                </div>
                <div className="options-row">
                  <span className="options-label">Caller is owner?</span>
                  {IS_PROPERTY_OWNER.map(o => (
                    <span key={o} className="option"><span className="bubble"></span> {o}</span>
                  ))}
                </div>
                <div className="options-row" style={{ marginBottom: 0 }}>
                  <span className="options-label">Dogs on site?</span>
                  {DOGS_ON_SITE.map(d => (
                    <span key={d} className="option"><span className="bubble"></span> {d}</span>
                  ))}
                  <span className="hint">(containable?)</span>
                </div>
              </div>
              <div>
                <div className="options-row">
                  <span className="options-label">Trap-savvy?</span>
                  {TRAP_SAVVY.map(t => (
                    <span key={t} className="option"><span className="bubble"></span> {t}</span>
                  ))}
                </div>
                <div className="options-row">
                  <span className="options-label">Previous TNR?</span>
                  {PREVIOUS_TNR.map(p => (
                    <span key={p} className="option"><span className="bubble"></span> {p}</span>
                  ))}
                </div>
                <div className="options-row" style={{ marginBottom: 0 }}>
                  <span className="options-label">Handleable?</span>
                  {HANDLEABILITY.filter(h => h !== "Shy but handleable").map(h => (
                    <span key={h} className="option"><span className="bubble"></span> {h}</span>
                  ))}
                </div>
              </div>
            </div>
            <EditableField label="Access notes (gate codes, parking, hazards)" placeholder="Notes..." style={{ marginTop: "6px" }} />
          </div>

          {/* Feeding & Trapping Schedule */}
          <div className="info-box">
            <div className="title">Best Trapping Times</div>
            <div className="field-row" style={{ marginBottom: "6px" }}>
              <EditableField label="Who feeds?" placeholder="Name" />
              <EditableField label="Feed time?" placeholder="Time" />
              <EditableField label="Where do cats eat?" placeholder="Location" />
              <EditableField label="Best trapping day/time" placeholder="Day/time" />
            </div>
          </div>

          {/* Important Notes */}
          <div className="warning-box">
            <div className="title">Important Notes (check all that apply)</div>
            <div className="quick-notes">
              {IMPORTANT_NOTES.map(note => (
                <div key={note} className="quick-note"><span className="checkbox"></span> {note}</div>
              ))}
            </div>
          </div>

          {/* Kitten Section */}
          <div className="section">
            <div className="section-title">Kitten Information</div>
            <div className="field-row" style={{ alignItems: "center", marginBottom: "6px" }}>
              <div className="field" style={{ flex: "0 0 120px" }}>
                <label>How many kittens?</label>
                <div className="field-input sm" style={{ width: "60px" }}><input type="text" placeholder="#" /></div>
              </div>
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Age range:</span>
                {KITTEN_AGE_ESTIMATE.map(a => (
                  <span key={a} className="option"><span className="bubble"></span> {a}</span>
                ))}
              </div>
            </div>

            <div className="options-row" style={{ marginBottom: "6px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Behavior:</span>
              {KITTEN_BEHAVIOR.map(b => (
                <span key={b} className="option"><span className="bubble"></span> {b}</span>
              ))}
            </div>

            <div className="info-card" style={{ marginBottom: "8px" }}>
              <div className="options-row" style={{ marginBottom: "3px" }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Contained?</span>
                {KITTEN_CONTAINED.map(c => (
                  <span key={c} className="option"><span className="bubble"></span> {c}</span>
                ))}
                <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Mom present?</span></span>
                {MOM_PRESENT.map(m => (
                  <span key={m} className="option"><span className="bubble"></span> {m}</span>
                ))}
              </div>
              <div className="options-row" style={{ marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "70px" }}>Mom fixed?</span>
                {MOM_FIXED.map(m => (
                  <span key={m} className="option"><span className="bubble"></span> {m}</span>
                ))}
                <span style={{ marginLeft: "16px" }}><span className="options-label" style={{ minWidth: "80px" }}>Can bring in?</span></span>
                {CAN_BRING_IN_PRINT.map(c => (
                  <span key={c} className="option"><span className="bubble"></span> {c}</span>
                ))}
              </div>
            </div>

            <EditableTextArea
              label="Kitten details (colors, where they hide, feeding schedule)"
              placeholder="Describe the kittens..."
              size="md"
            />
          </div>

          {/* Staff Assessment */}
          <div className="staff-box">
            <div className="section-title">Trapping Plan (Office Use)</div>
            <div className="field-row" style={{ alignItems: "center", marginBottom: "4px" }}>
              <EditableField label="Assigned to" placeholder="Trapper name" style={{ flex: "0 0 160px" }} />
              <EditableField label="Scheduled date" placeholder="MM/DD/YYYY" style={{ flex: "0 0 130px" }} />
              <div className="options-row" style={{ flex: 1, marginBottom: 0 }}>
                <span className="options-label" style={{ minWidth: "60px" }}>Callback:</span>
                <span className="option"><span className="bubble"></span> Yes</span>
                <span className="option"><span className="bubble"></span> No</span>
              </div>
            </div>
            <div className="options-row" style={{ marginBottom: "4px" }}>
              <span className="options-label" style={{ minWidth: "70px" }}>Outcome:</span>
              {KITTEN_OUTCOME.map(o => (
                <span key={o} className="option"><span className="bubble"></span> {o}</span>
              ))}
            </div>
            <EditableTextArea label="Staff notes" placeholder="Notes..." size="md" />
          </div>

          <PrintFooter
            left={`${nameFull} &bull; ${website}`}
            right="Page 2 of 2"
          />
        </div>
      )}
    </div>
  );
}
