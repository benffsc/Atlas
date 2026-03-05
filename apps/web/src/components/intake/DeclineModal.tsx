"use client";

import { useState } from "react";
import type { IntakeSubmission } from "@/lib/intake-types";
import { normalizeName } from "@/components/intake/IntakeBadges";
import { postApi } from "@/lib/api-client";
import { Modal } from "@/components/ui";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

interface DeclineModalProps {
  submission: IntakeSubmission;
  isOpen: boolean;
  onClose: () => void;
  onDeclined: () => void;
}

export function DeclineModal({
  submission,
  isOpen,
  onClose,
  onDeclined,
}: DeclineModalProps) {
  const [declining, setDeclining] = useState(false);
  const [declineForm, setDeclineForm] = useState({
    reason_code: "",
    reason_notes: "",
    referred_to_org: "",
    send_notification: false,
  });

  const handleDecline = async () => {
    if (!declineForm.reason_code) {
      alert("Please select a decline reason");
      return;
    }
    setDeclining(true);
    try {
      await postApi("/api/intake/decline", {
        submission_id: submission.submission_id,
        reason_code: declineForm.reason_code,
        reason_notes: declineForm.reason_notes || null,
        referred_to_org: declineForm.referred_to_org || null,
        send_notification: declineForm.send_notification,
      });
      onDeclined();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to decline submission");
    } finally {
      setDeclining(false);
    }
  };

  const isDisabled = declining || !declineForm.reason_code;

  const footer = (
    <>
      <button
        onClick={onClose}
        style={{
          padding: `${SPACING.sm} ${SPACING.lg}`,
          border: "1px solid var(--border)",
          borderRadius: BORDERS.radius.lg,
          cursor: "pointer",
          background: "transparent",
        }}
      >
        Cancel
      </button>
      <button
        onClick={handleDecline}
        disabled={isDisabled}
        style={{
          padding: `${SPACING.sm} ${SPACING.lg}`,
          background: isDisabled ? COLORS.gray300 : COLORS.error,
          color: COLORS.white,
          border: "none",
          borderRadius: BORDERS.radius.lg,
          cursor: isDisabled ? "not-allowed" : "pointer",
          fontWeight: TYPOGRAPHY.weight.medium,
        }}
      >
        {declining ? "Declining..." : "Decline Submission"}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Decline Submission"
      size="sm"
      footer={footer}
    >
      <p style={{ marginTop: 0, marginBottom: SPACING.lg, color: "var(--muted)" }}>
        Declining <strong>{normalizeName(submission.submitter_name)}</strong> will mark this submission as not proceeding to a request.
      </p>

      <div style={{ marginBottom: SPACING.lg }}>
        <label style={{ display: "block", marginBottom: SPACING.xs, fontWeight: TYPOGRAPHY.weight.medium }}>
          Reason <span style={{ color: COLORS.error }}>*</span>
        </label>
        <select
          value={declineForm.reason_code}
          onChange={(e) => setDeclineForm({ ...declineForm, reason_code: e.target.value })}
          style={{
            width: "100%",
            padding: SPACING.sm,
            borderRadius: BORDERS.radius.lg,
            border: "1px solid var(--border)",
          }}
        >
          <option value="">Select a reason...</option>
          <option value="out_of_county">Out of Service Area</option>
          <option value="owned_cat">Owned Cat (not community cat)</option>
          <option value="already_fixed">Already Fixed</option>
          <option value="duplicate">Duplicate Submission</option>
          <option value="no_response">No Response (after multiple attempts)</option>
          <option value="withdrawn">Withdrawn by Requester</option>
          <option value="referred_to_other_org">Referred to Other Organization</option>
          <option value="not_tnr_case">Not a TNR Case</option>
          <option value="spam">Spam / Invalid Submission</option>
        </select>
      </div>

      {declineForm.reason_code === "referred_to_other_org" && (
        <div style={{ marginBottom: SPACING.lg }}>
          <label style={{ display: "block", marginBottom: SPACING.xs, fontWeight: TYPOGRAPHY.weight.medium }}>
            Referred to Organization
          </label>
          <input
            type="text"
            value={declineForm.referred_to_org}
            onChange={(e) => setDeclineForm({ ...declineForm, referred_to_org: e.target.value })}
            placeholder="e.g., Marin Feral Cat Coalition"
            style={{
              width: "100%",
              padding: SPACING.sm,
              borderRadius: BORDERS.radius.lg,
              border: "1px solid var(--border)",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      <div style={{ marginBottom: SPACING.lg }}>
        <label style={{ display: "block", marginBottom: SPACING.xs, fontWeight: TYPOGRAPHY.weight.medium }}>
          Additional Notes
        </label>
        <textarea
          value={declineForm.reason_notes}
          onChange={(e) => setDeclineForm({ ...declineForm, reason_notes: e.target.value })}
          placeholder="Any additional context or notes..."
          rows={3}
          style={{
            width: "100%",
            padding: SPACING.sm,
            borderRadius: BORDERS.radius.lg,
            border: "1px solid var(--border)",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: SPACING.sm, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={declineForm.send_notification}
            onChange={(e) => setDeclineForm({ ...declineForm, send_notification: e.target.checked })}
          />
          <span>Send notification email to submitter</span>
        </label>
        <p style={{ margin: `${SPACING.xs} 0 0 ${SPACING.xl}`, fontSize: TYPOGRAPHY.size.sm, color: "var(--muted)" }}>
          If checked, the submitter will receive an email explaining the decline.
        </p>
      </div>
    </Modal>
  );
}
