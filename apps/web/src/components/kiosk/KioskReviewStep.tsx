"use client";

import { Icon } from "@/components/ui/Icon";
import {
  type ScoringResult,
  type IndirectQuestion,
  SITUATION_LABELS,
  SITUATION_DESCRIPTIONS,
} from "@/lib/kiosk-questions";
import type { KioskContactData } from "./KioskContactStep";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";

interface KioskReviewStepProps {
  answers: Record<string, string>;
  questions: IndirectQuestion[];
  scoring: ScoringResult;
  contact: KioskContactData;
  place: ResolvedPlace | null;
  freeformAddress: string;
}

/**
 * Review step — shows classification result + summary of answers.
 * User confirms or goes back to edit.
 */
export function KioskReviewStep({
  answers,
  questions,
  scoring,
  contact,
  place,
  freeformAddress,
}: KioskReviewStepProps) {
  const classLabel = SITUATION_LABELS[scoring.classification];
  const classDescription = SITUATION_DESCRIPTIONS[scoring.classification];
  const locationDisplay = place?.display_name || place?.formatted_address || freeformAddress || "Not provided";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <h2
        style={{
          fontSize: "1.35rem",
          fontWeight: 700,
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        Review your request
      </h2>

      {/* Classification card */}
      <div
        style={{
          background: "var(--primary-bg, rgba(59,130,246,0.08))",
          border: "2px solid var(--primary)",
          borderRadius: 16,
          padding: "1.25rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.5rem",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="sparkles" size={20} color="#fff" />
          </div>
          <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--primary)" }}>
            {classLabel}
          </div>
        </div>
        <p
          style={{
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {classDescription}
        </p>
      </div>

      {/* Summary */}
      <div
        style={{
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {/* Contact */}
        <SummaryRow label="Name" value={contact.firstName} />
        <SummaryRow label="Phone" value={contact.phone} />
        {contact.email && <SummaryRow label="Email" value={contact.email} />}
        <SummaryRow label="Location" value={locationDisplay} />

        {/* Key answers */}
        {questions.map((q) => {
          const selectedValue = answers[q.id];
          if (!selectedValue) return null;
          const option = q.options.find((o) => o.value === selectedValue);
          if (!option) return null;
          return <SummaryRow key={q.id} label={q.text} value={option.label} />;
        })}
      </div>

      {scoring.confidence < 0.3 && (
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--warning-text)",
            background: "var(--warning-bg)",
            border: "1px solid var(--warning-border)",
            borderRadius: 10,
            padding: "0.75rem 1rem",
            lineHeight: 1.4,
          }}
        >
          Your answers suggest a mixed situation. Our team will review and follow up with the best path forward.
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid var(--card-border, #e5e7eb)",
        gap: "1rem",
      }}
    >
      <span
        style={{
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          flexShrink: 0,
          maxWidth: "40%",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.9rem",
          color: "var(--text-primary)",
          textAlign: "right",
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  );
}
