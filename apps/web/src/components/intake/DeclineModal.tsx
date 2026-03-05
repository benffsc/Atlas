"use client";

import { useState } from "react";
import type { IntakeSubmission } from "@/lib/intake-types";
import { normalizeName } from "@/components/intake/IntakeBadges";
import { postApi } from "@/lib/api-client";

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

  if (!isOpen) return null;

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

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1002,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--background)",
          borderRadius: "12px",
          padding: "1.5rem",
          width: "95%",
          maxWidth: "480px",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: "1rem", color: "#dc3545" }}>
          Decline Submission
        </h2>
        <p style={{ marginBottom: "1rem", color: "var(--muted)" }}>
          Declining <strong>{normalizeName(submission.submitter_name)}</strong> will mark this submission as not proceeding to a request.
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
            Reason <span style={{ color: "#dc3545" }}>*</span>
          </label>
          <select
            value={declineForm.reason_code}
            onChange={(e) => setDeclineForm({ ...declineForm, reason_code: e.target.value })}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "6px",
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
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Referred to Organization
            </label>
            <input
              type="text"
              value={declineForm.referred_to_org}
              onChange={(e) => setDeclineForm({ ...declineForm, referred_to_org: e.target.value })}
              placeholder="e.g., Marin Feral Cat Coalition"
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
            Additional Notes
          </label>
          <textarea
            value={declineForm.reason_notes}
            onChange={(e) => setDeclineForm({ ...declineForm, reason_notes: e.target.value })}
            placeholder="Any additional context or notes..."
            rows={3}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={declineForm.send_notification}
              onChange={(e) => setDeclineForm({ ...declineForm, send_notification: e.target.checked })}
            />
            <span>Send notification email to submitter</span>
          </label>
          <p style={{ margin: "0.25rem 0 0 1.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            If checked, the submitter will receive an email explaining the decline.
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDecline}
            disabled={declining || !declineForm.reason_code}
            style={{
              padding: "0.5rem 1rem",
              background: declining || !declineForm.reason_code ? "#ccc" : "#dc3545",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: declining || !declineForm.reason_code ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            {declining ? "Declining..." : "Decline Submission"}
          </button>
        </div>
      </div>
    </div>
  );
}
