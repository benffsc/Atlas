"use client";

import { Icon } from "@/components/ui/Icon";
import type { ClinicClassification } from "@/lib/clinic-cat-tree";

interface KioskClinicReviewProps {
  contact: {
    firstName: string;
    lastName?: string;
    phone: string;
    email: string;
  };
  locationDisplay: string;
  classification: ClinicClassification;
  catCount: number | undefined;
  submitError: string | null;
}

const CLASSIFICATION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  community_cat: { label: "Community Cat", color: "var(--primary)", icon: "cat" },
  feral: { label: "Feral / Untouchable", color: "var(--warning-text, #92400e)", icon: "alert-triangle" },
  colony: { label: "Colony", color: "var(--info-text, #1d4ed8)", icon: "users" },
  ambiguous: { label: "Needs Review", color: "var(--warning-text, #92400e)", icon: "help-circle" },
  pet_redirect: { label: "Pet Detected", color: "var(--danger-text, #dc2626)", icon: "home" },
};

/**
 * Clinic-specific review step with classification card.
 * Shows contact, location, and the behavioral classification result.
 *
 * FFS-1102
 */
export function KioskClinicReview({
  contact,
  locationDisplay,
  classification,
  catCount,
  submitError,
}: KioskClinicReviewProps) {
  const classInfo = CLASSIFICATION_LABELS[classification.classification] || CLASSIFICATION_LABELS.community_cat;

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

      {submitError && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: 10,
            color: "var(--danger-text)",
            fontSize: "0.9rem",
            fontWeight: 500,
          }}
        >
          {submitError}
        </div>
      )}

      {/* Classification card */}
      <div
        style={{
          background: "var(--primary-bg, rgba(59,130,246,0.08))",
          border: `2px solid ${classInfo.color}`,
          borderRadius: 16,
          padding: "1rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: classInfo.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={classInfo.icon} size={20} color="#fff" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: classInfo.color }}>
            {classInfo.label}
          </div>
          {catCount != null && (
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              {catCount === 1 ? "1 cat" : `${catCount} cats`}
              {classification.needs_trapper && " \u00B7 Needs trapper"}
              {classification.has_kittens && " \u00B7 Has kittens"}
            </div>
          )}
        </div>
      </div>

      {/* Contact & location summary */}
      <div
        style={{
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <SummaryRow label="Name" value={[contact.firstName, contact.lastName].filter(Boolean).join(" ")} />
        <SummaryRow label="Phone" value={contact.phone} />
        {contact.email && <SummaryRow label="Email" value={contact.email} />}
        <SummaryRow label="Location" value={locationDisplay} />
      </div>
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
