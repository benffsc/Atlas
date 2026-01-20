"use client";

import { useState } from "react";

interface TippyFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  tippyMessage: string;
  conversationId?: string;
  conversationContext?: Array<{ role: string; content: string }>;
}

const FEEDBACK_TYPES = [
  { value: "incorrect_count", label: "Wrong count (cats, requests, etc.)" },
  { value: "incorrect_status", label: "Wrong status information" },
  { value: "incorrect_location", label: "Wrong location/address" },
  { value: "incorrect_person", label: "Wrong person associated" },
  { value: "outdated_info", label: "Outdated information" },
  { value: "missing_data", label: "Missing data (couldn't find something)" },
  { value: "missing_capability", label: "Tippy should be able to do this" },
  { value: "other", label: "Other issue" },
];

const ENTITY_TYPES = [
  { value: "", label: "Not sure / General feedback" },
  { value: "place", label: "Place / Address" },
  { value: "cat", label: "Cat" },
  { value: "person", label: "Person" },
  { value: "request", label: "Request" },
];

export function TippyFeedbackModal({
  isOpen,
  onClose,
  tippyMessage,
  conversationId,
  conversationContext,
}: TippyFeedbackModalProps) {
  const [feedbackType, setFeedbackType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [correction, setCorrection] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!feedbackType) {
      setError("Please select a feedback type");
      return;
    }
    if (!correction.trim()) {
      setError("Please describe what the correct information is");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/tippy/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tippy_message: tippyMessage,
          user_correction: correction.trim(),
          conversation_id: conversationId,
          conversation_context: conversationContext,
          entity_type: entityType || null,
          entity_id: entityId || null,
          feedback_type: feedbackType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit feedback");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        // Reset form
        setFeedbackType("");
        setEntityType("");
        setEntityId("");
        setCorrection("");
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

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
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "400px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--card-border, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>
            Report Incorrect Info
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            x
          </button>
        </div>

        {success ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "12px" }}>
              Thank you!
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              Your feedback will be reviewed to improve data accuracy.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
            {/* Tippy's response preview */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Tippy said:
              </label>
              <div
                style={{
                  padding: "10px 12px",
                  background: "var(--section-bg, #f3f4f6)",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  maxHeight: "80px",
                  overflow: "auto",
                }}
              >
                {tippyMessage.slice(0, 300)}
                {tippyMessage.length > 300 && "..."}
              </div>
            </div>

            {/* Feedback type */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                What's wrong? *
              </label>
              <select
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--card-border, #e5e7eb)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--background, #fff)",
                }}
              >
                <option value="">Select type of issue...</option>
                {FEEDBACK_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Entity type (optional) */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                What record is affected?
              </label>
              <select
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setEntityId("");
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--card-border, #e5e7eb)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--background, #fff)",
                }}
              >
                {ENTITY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Entity ID (if entity type selected) */}
            {entityType && (
              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    marginBottom: "6px",
                  }}
                >
                  {entityType === "place" && "Place name or address"}
                  {entityType === "cat" && "Cat name or ID"}
                  {entityType === "person" && "Person name"}
                  {entityType === "request" && "Request ID or address"}
                </label>
                <input
                  type="text"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  placeholder="Enter identifier or name..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--card-border, #e5e7eb)",
                    borderRadius: "8px",
                    fontSize: "0.9rem",
                    background: "var(--background, #fff)",
                  }}
                />
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    marginTop: "4px",
                  }}
                >
                  This helps us find the exact record to fix
                </div>
              </div>
            )}

            {/* Correction description */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                What's the correct information? *
              </label>
              <textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder="Describe what should be correct..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--card-border, #e5e7eb)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--background, #fff)",
                  resize: "vertical",
                }}
              />
            </div>

            {/* Error message */}
            {error && (
              <div
                style={{
                  padding: "10px 12px",
                  background: "var(--danger-bg, #fee2e2)",
                  color: "var(--danger-text, #dc2626)",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  marginBottom: "16px",
                }}
              >
                {error}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: "100%",
                padding: "12px",
                background: isSubmitting
                  ? "#9ca3af"
                  : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "0.9rem",
                fontWeight: 500,
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Submitting..." : "Submit Feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
