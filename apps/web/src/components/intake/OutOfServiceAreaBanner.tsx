"use client";

/**
 * Out-of-Service-Area Banner (FFS-1187 / Phase 4)
 *
 * Renders one of four states inside the intake detail panel:
 *   - 'out'        → red banner with Preview / Approve & Send / Override
 *   - 'ambiguous'  → yellow banner with Mark in-service / Mark out
 *   - sent         → green confirmation
 *   - suppressed   → grey suppressed notice
 *
 * Does NOT do API calls itself — emits onClick handlers to the parent
 * panel which owns the postApi/fetchApi flow + ConfirmDialog.
 *
 * Hidden when service_area_status is 'in', 'unknown', or null.
 */

import type { IntakeSubmission } from "@/lib/intake-types";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export interface OutOfServiceAreaBannerProps {
  submission: IntakeSubmission;
  onPreviewEmail: () => void;
  onApproveAndSend: () => void;
  onOverride: (newStatus: "in" | "out") => void;
  // Visual hint that 90-day suppression is in effect — parent fetches state.
  isSuppressed?: boolean;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function OutOfServiceAreaBanner({
  submission,
  onPreviewEmail,
  onApproveAndSend,
  onOverride,
  isSuppressed,
}: OutOfServiceAreaBannerProps) {
  const status = submission.service_area_status;

  // Hidden states
  if (!status || status === "in" || status === "unknown") return null;

  // ── Already-sent ────────────────────────────────────────────────────────
  if (submission.out_of_service_area_email_sent_at) {
    return (
      <div
        style={{
          background: "var(--success-bg, rgba(25, 135, 84, 0.1))",
          border: "1px solid var(--success-border, rgba(25, 135, 84, 0.3))",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        <Icon name="check-circle" size={20} color="var(--success-text, #198754)" />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.9rem",
              color: "var(--success-text, #198754)",
            }}
          >
            Out-of-area email sent
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Sent {formatDate(submission.out_of_service_area_email_sent_at)} to{" "}
            {submission.email}
          </div>
        </div>
      </div>
    );
  }

  // ── Suppressed ──────────────────────────────────────────────────────────
  if (isSuppressed) {
    return (
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        <Icon name="shield" size={20} color="var(--text-secondary)" />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.9rem",
            }}
          >
            Suppressed
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            {submission.email} received an out-of-area email within the last
            90 days. Suppression prevents duplicates.
          </div>
        </div>
      </div>
    );
  }

  // ── Ambiguous (yellow) ──────────────────────────────────────────────────
  if (status === "ambiguous") {
    return (
      <div
        style={{
          background: "var(--warning-bg, rgba(255, 193, 7, 0.12))",
          border: "1px solid var(--warning-border, rgba(255, 193, 7, 0.4))",
          borderRadius: 8,
          padding: "0.875rem 1rem",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <Icon
            name="alert-triangle"
            size={20}
            color="var(--warning-text, #856404)"
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.9rem",
                color: "var(--warning-text, #856404)",
              }}
            >
              Ambiguous Service Area
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              This address is near the service area boundary. Please confirm
              before any email is sent.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOverride("in")}
            icon="check"
          >
            Mark in-service
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOverride("out")}
            icon="x"
          >
            Mark out-of-service
          </Button>
        </div>
      </div>
    );
  }

  // ── Out (red) ───────────────────────────────────────────────────────────
  // status === 'out'
  return (
    <div
      style={{
        background: "var(--danger-bg, rgba(220, 53, 69, 0.1))",
        border: "1px solid var(--danger-border, rgba(220, 53, 69, 0.35))",
        borderRadius: 8,
        padding: "0.875rem 1rem",
        marginBottom: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <Icon
          name="alert-triangle"
          size={20}
          color="var(--danger-text, #dc3545)"
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.9rem",
              color: "var(--danger-text, #dc3545)",
            }}
          >
            Outside Service Area
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Detected county:{" "}
            <strong>{submission.county || "unknown"}</strong>. This submission
            is outside the FFSC service area.
          </div>
          {submission.out_of_service_area_approved_at && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--success-text, #198754)",
                marginTop: "0.25rem",
              }}
            >
              ✓ Approved for sending on{" "}
              {formatDate(submission.out_of_service_area_approved_at)}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button
          variant="outline"
          size="sm"
          onClick={onPreviewEmail}
          icon="eye"
        >
          Preview email
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onApproveAndSend}
          icon="send"
          disabled={!submission.email}
        >
          Approve &amp; Send
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOverride("in")}
        >
          Mark in-service
        </Button>
      </div>
      {!submission.email && (
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
          }}
        >
          No email address on this submission — cannot send.
        </div>
      )}
    </div>
  );
}
