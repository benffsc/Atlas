"use client";

import { useState, useEffect } from "react";
import { postApi } from "@/lib/api-client";

interface ArchiveJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  entryId: string;
  entryPreview: string; // First ~100 chars of body for confirmation
  staffName?: string;
  onSuccess?: () => void;
}

const ARCHIVE_REASONS = [
  { value: "duplicate", label: "Duplicate Entry", description: "Entry duplicates another journal note", requiresNotes: false },
  { value: "error", label: "Data Entry Error", description: "Information was entered incorrectly", requiresNotes: true },
  { value: "irrelevant", label: "No Longer Relevant", description: "Information is outdated or no longer applicable", requiresNotes: false },
  { value: "wrong_entity", label: "Wrong Entity", description: "Entry was attached to the wrong cat/person/place", requiresNotes: true },
  { value: "test_data", label: "Test Data", description: "Entry was created for testing purposes", requiresNotes: false },
  { value: "merged", label: "Entity Merged", description: "Entity was merged, entry is now redundant", requiresNotes: false },
  { value: "other", label: "Other", description: "Other reason (specify in notes)", requiresNotes: true },
];

export default function ArchiveJournalModal({
  isOpen,
  onClose,
  entryId,
  entryPreview,
  staffName,
  onSuccess,
}: ArchiveJournalModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [archiveNotes, setArchiveNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedReason("");
      setArchiveNotes("");
      setError(null);
    }
  }, [isOpen]);

  const selectedReasonObj = ARCHIVE_REASONS.find((r) => r.value === selectedReason);
  const requiresNotes = selectedReasonObj?.requiresNotes || false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!selectedReason) {
      setError("Please select an archive reason");
      return;
    }
    if (requiresNotes && !archiveNotes.trim()) {
      setError(`Please provide notes for "${selectedReasonObj?.label}" reason`);
      return;
    }

    setLoading(true);

    try {
      await postApi(`/api/journal/${entryId}`, {
        reason: selectedReason,
        notes: archiveNotes.trim() || undefined,
      }, { method: "DELETE" });

      onSuccess?.();
      handleClose();
    } catch (err) {
      console.error("Error archiving journal entry:", err);
      setError(err instanceof Error ? err.message : "Failed to archive entry");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (!loading) {
      setSelectedReason("");
      setArchiveNotes("");
      setError(null);
      onClose();
    }
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "450px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
              Archive Journal Entry
            </h2>
            {staffName && (
              <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                Recording as: {staffName}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: loading ? "not-allowed" : "pointer",
              color: "var(--muted)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {/* Entry Preview */}
          <div
            style={{
              marginBottom: "16px",
              padding: "12px",
              background: "var(--bg-muted, #f5f5f5)",
              borderRadius: "8px",
              borderLeft: "3px solid var(--border)",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", marginBottom: "4px" }}>
              Entry to archive:
            </p>
            <p style={{ margin: 0, fontSize: "0.9rem", fontStyle: "italic" }}>
              &ldquo;{entryPreview.length > 100 ? `${entryPreview.slice(0, 100)}...` : entryPreview}&rdquo;
            </p>
          </div>

          {/* Archive Reason */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Archive Reason <span style={{ color: "#dc3545" }}>*</span>
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
              required
            >
              <option value="">Select a reason...</option>
              {ARCHIVE_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            {selectedReasonObj?.description && (
              <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                {selectedReasonObj.description}
              </p>
            )}
          </div>

          {/* Archive Notes */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Notes
              {requiresNotes && <span style={{ color: "#dc3545" }}> *</span>}
            </label>
            <textarea
              value={archiveNotes}
              onChange={(e) => setArchiveNotes(e.target.value)}
              rows={3}
              placeholder={requiresNotes ? "Please provide context for this archive reason..." : "Optional additional context..."}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                resize: "vertical",
                background: "var(--input-bg, #fff)",
              }}
              required={requiresNotes}
            />
          </div>

          {/* Warning */}
          <div
            style={{
              padding: "12px",
              background: "#fff3cd",
              border: "1px solid #ffc107",
              borderRadius: "8px",
              marginBottom: "16px",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#856404" }}>
              <strong>Note:</strong> Archived entries can be restored by administrators if needed.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px",
                background: "#f8d7da",
                border: "1px solid #f5c6cb",
                borderRadius: "8px",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#721c24" }}>{error}</p>
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              style={{
                padding: "10px 20px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                background: "var(--card-bg, #fff)",
                fontSize: "0.9rem",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedReason}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: "8px",
                background: loading || !selectedReason ? "#ccc" : "#dc3545",
                color: "#fff",
                fontSize: "0.9rem",
                fontWeight: 500,
                cursor: loading || !selectedReason ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Archiving..." : "Archive Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
