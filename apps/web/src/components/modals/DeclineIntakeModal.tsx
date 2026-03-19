"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { ReasonSelectionForm } from "@/components/forms/ReasonSelectionForm";

interface DeclineIntakeModalProps {
  submissionId: string;
  submitterName: string;
  onComplete: () => void;
  onCancel: () => void;
}

// Decline reason options
const DECLINE_REASONS = [
  { value: "out_of_county", label: "Out of Service Area", description: "Location is outside Sonoma County service area" },
  { value: "owned_cat", label: "Owned Cat", description: "Cat has an owner - not a community cat" },
  { value: "already_fixed", label: "Already Fixed", description: "Cat(s) are already spayed/neutered" },
  { value: "duplicate", label: "Duplicate Submission", description: "Same location/cats already in system" },
  { value: "no_response", label: "No Response", description: "Unable to reach submitter after multiple attempts" },
  { value: "withdrawn", label: "Withdrawn by Requester", description: "Requester no longer needs assistance" },
  { value: "referred_to_other_org", label: "Referred to Other Org", description: "Referred to another organization" },
  { value: "not_tnr_case", label: "Not a TNR Case", description: "Doesn't meet TNR criteria" },
  { value: "spam", label: "Spam/Invalid", description: "Spam, test submission, or invalid data" },
];

// Referral organizations
const REFERRAL_ORGS = [
  "Marin Humane",
  "Napa Humane",
  "Mendocino County Animal Care",
  "Petaluma Animal Services",
  "Santa Rosa Animal Services",
  "Other",
];

export default function DeclineIntakeModal({
  submissionId,
  submitterName,
  onComplete,
  onCancel,
}: DeclineIntakeModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [referralOrg, setReferralOrg] = useState("");
  const [sendEmail, setSendEmail] = useState(true);

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a decline reason");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await postApi("/api/intake/decline", {
        submission_id: submissionId,
        reason_code: reason,
        reason_notes: notes || null,
        referred_to_org: reason === "referred_to_other_org" ? referralOrg : null,
        send_notification: sendEmail,
      });

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error - please try again");
    } finally {
      setSaving(false);
    }
  };

  const selectedReason = DECLINE_REASONS.find(r => r.value === reason);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          maxWidth: "500px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.5rem",
            borderBottom: "1px solid var(--border)",
            background: "linear-gradient(135deg, #dc2626 0%, #f87171 100%)",
            color: "#fff",
            borderRadius: "12px 12px 0 0",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Decline Intake Submission</h2>
          <p style={{ margin: "0.5rem 0 0", opacity: 0.9, fontSize: "0.9rem" }}>
            {submitterName}
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem" }}>
          {error && (
            <div
              style={{
                background: "rgba(220, 53, 69, 0.1)",
                border: "1px solid rgba(220, 53, 69, 0.3)",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem",
                color: "#dc3545",
              }}
            >
              {error}
            </div>
          )}

          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Reason for Declining</h3>
          <ReasonSelectionForm
            reasons={DECLINE_REASONS}
            selectedReason={reason}
            onReasonChange={setReason}
            notes={notes}
            onNotesChange={setNotes}
            notesRequired={false}
            notesPlaceholder="Additional details about the decline..."
            accentColor="#dc2626"
          >
            {/* Referral org selection (shown when referred_to_other_org) */}
            {reason === "referred_to_other_org" && (
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.9rem" }}>
                  Referred To
                </label>
                <select
                  value={referralOrg}
                  onChange={(e) => setReferralOrg(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <option value="">Select organization...</option>
                  {REFERRAL_ORGS.map((org) => (
                    <option key={org} value={org}>{org}</option>
                  ))}
                </select>
              </div>
            )}
          </ReasonSelectionForm>

          {/* Email notification toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem",
              background: "var(--card-bg, rgba(0,0,0,0.05))",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            <div>
              <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>Send notification email</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                Notify {submitterName} about the decision
              </div>
            </div>
          </label>

          {/* Warning for certain reasons */}
          {selectedReason && ["spam", "duplicate"].includes(reason) && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                background: "rgba(245, 158, 11, 0.1)",
                borderRadius: "8px",
                fontSize: "0.85rem",
                color: "#b45309",
              }}
            >
              This submission will be marked as {selectedReason.label.toLowerCase()} and archived.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={saving || !reason}
            style={{
              padding: "0.5rem 1.5rem",
              background: saving || !reason ? "#9ca3af" : "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: saving || !reason ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            {saving ? "Declining..." : "Decline Submission"}
          </button>
        </div>
      </div>
    </div>
  );
}
