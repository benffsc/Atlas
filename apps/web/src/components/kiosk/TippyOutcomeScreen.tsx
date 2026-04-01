"use client";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { TippyOutcome, TippyResourceCard } from "@/lib/tippy-tree";

interface TippyOutcomeScreenProps {
  outcome: TippyOutcome;
  /** "Tell Us More" → continues to location step */
  onContinueToIntake: () => void;
  /** "Done" → back to /kiosk splash */
  onDone: () => void;
}

/**
 * Terminal screen shown when tree traversal resolves an outcome.
 * Shows headline, subtext, resource cards with tap-to-call, and action buttons.
 */
export function TippyOutcomeScreen({
  outcome,
  onContinueToIntake,
  onDone,
}: TippyOutcomeScreenProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Headline section */}
      <div style={{ textAlign: "center", paddingTop: "0.5rem" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: outcome.type === "emergency_vet"
              ? "var(--danger-bg, rgba(239,68,68,0.1))"
              : "var(--primary-bg, rgba(59,130,246,0.08))",
            border: `2px solid ${outcome.type === "emergency_vet" ? "var(--danger-text, #dc2626)" : "var(--primary)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <Icon
            name={outcome.icon}
            size={32}
            color={outcome.type === "emergency_vet" ? "var(--danger-text, #dc2626)" : "var(--primary)"}
          />
        </div>
        <h2
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
            lineHeight: 1.2,
          }}
        >
          {outcome.headline}
        </h2>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 400,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {outcome.subtext}
        </p>
      </div>

      {/* Resource cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {outcome.resources.map((resource, idx) => (
          <ResourceCard key={idx} resource={resource} />
        ))}
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          paddingTop: "0.5rem",
        }}
      >
        {outcome.creates_intake ? (
          <Button
            variant="primary"
            size="lg"
            onClick={onContinueToIntake}
            style={{ minHeight: 56, borderRadius: 14, fontSize: "1.05rem" }}
          >
            Tell Us More
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={onDone}
            style={{ minHeight: 56, borderRadius: 14, fontSize: "1.05rem" }}
          >
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

function ResourceCard({ resource }: { resource: TippyResourceCard }) {
  const isEmergency = resource.urgency === "emergency";

  return (
    <div
      style={{
        background: isEmergency
          ? "var(--danger-bg, rgba(239,68,68,0.05))"
          : "var(--card-bg, #fff)",
        border: isEmergency
          ? "2px solid var(--danger-border, #fca5a5)"
          : "1px solid var(--card-border, #e5e7eb)",
        borderRadius: 14,
        padding: "1rem 1.25rem",
        display: "flex",
        gap: "0.875rem",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: isEmergency
            ? "var(--danger-text, #dc2626)"
            : "var(--primary-bg, rgba(59,130,246,0.08))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon
          name={resource.icon}
          size={20}
          color={isEmergency ? "#fff" : "var(--primary)"}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: "var(--text-primary)",
            marginBottom: "0.25rem",
            lineHeight: 1.3,
          }}
        >
          {resource.name}
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            lineHeight: 1.4,
            marginBottom: resource.phone || resource.address || resource.hours ? "0.5rem" : 0,
          }}
        >
          {resource.description}
        </div>

        {/* Contact details */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {resource.phone && (
            <a
              href={`tel:${resource.phone.replace(/\D/g, "")}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: isEmergency ? "var(--danger-text, #dc2626)" : "var(--primary)",
                textDecoration: "none",
              }}
            >
              <Icon name="phone" size={14} />
              {resource.phone}
            </a>
          )}
          {resource.address && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.8rem",
                color: "var(--text-secondary)",
              }}
            >
              <Icon name="map-pin" size={14} />
              {resource.address}
            </div>
          )}
          {resource.hours && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.8rem",
                color: isEmergency ? "var(--danger-text, #dc2626)" : "var(--success-text, #16a34a)",
                fontWeight: 600,
              }}
            >
              <Icon name="clock" size={14} />
              {resource.hours}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
