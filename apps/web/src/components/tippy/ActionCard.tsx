"use client";

import { Button } from "@/components/ui/Button";

export interface ActionCardData {
  card_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string;
  proposed_changes: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  status: "pending" | "confirmed" | "rejected";
}

const CONFIDENCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: "var(--success-bg, #dcfce7)", text: "var(--success-text, #166534)", label: "High" },
  medium: { bg: "var(--warning-bg, #fef9c3)", text: "var(--warning-text, #854d0e)", label: "Medium" },
  low: { bg: "var(--error-bg, #fee2e2)", text: "var(--error-text, #991b1b)", label: "Low" },
};

const ACTION_LABELS: Record<string, string> = {
  add_note: "Add Note",
  field_event: "Log Field Event",
  draft_request: "Create Request",
  update_request: "Update Request",
  data_correction: "Data Correction",
};

interface ActionCardProps {
  card: ActionCardData;
  onConfirm: (cardId: string) => void;
  onReject: (cardId: string) => void;
}

export function ActionCard({ card, onConfirm, onReject }: ActionCardProps) {
  const conf = CONFIDENCE_STYLES[card.confidence] || CONFIDENCE_STYLES.low;
  const actionLabel = ACTION_LABELS[card.action_type] || card.action_type;

  if (card.status !== "pending") {
    return (
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid var(--border-secondary, #e5e7eb)",
          opacity: 0.6,
          fontSize: 13,
        }}
      >
        {card.status === "confirmed" ? "Confirmed" : "Cancelled"}: {actionLabel} for {card.entity_name}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        border: "1px solid var(--border-primary, #d1d5db)",
        background: "var(--surface-secondary, #f9fafb)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {actionLabel}: {card.entity_name}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 10,
            background: conf.bg,
            color: conf.text,
            fontWeight: 500,
          }}
        >
          {conf.label} confidence
        </span>
      </div>

      {card.reasoning && (
        <div style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)" }}>
          {card.reasoning}
        </div>
      )}

      {Object.keys(card.proposed_changes).length > 0 && (
        <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-tertiary, #9ca3af)" }}>
          {Object.entries(card.proposed_changes).map(([key, val]) => (
            <div key={key}>
              {key}: {typeof val === "string" ? val : JSON.stringify(val)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button size="sm" variant="primary" onClick={() => onConfirm(card.card_id)}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onReject(card.card_id)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
