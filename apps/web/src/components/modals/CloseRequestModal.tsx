"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useAsyncForm } from "@/hooks/useAsyncForm";
import { Modal } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { COLORS, SPACING, BORDERS } from "@/lib/design-tokens";
import {
  RESOLUTION_OUTCOMES,
  RESOLUTION_OUTCOME_LABELS,
  RESOLUTION_OUTCOME_COLORS,
  type ResolutionOutcome,
} from "@/lib/request-status";

interface ResolutionReason {
  reason_code: string;
  reason_label: string;
  reason_description: string | null;
  applies_to_status: string[];
  requires_notes: boolean;
  display_order: number;
  outcome_category: string | null;
}

interface CloseRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  placeId?: string;
  placeName?: string;
  staffName?: string;
  onSuccess?: () => void;
  /** FFS-1367: Optimistic locking — last known updated_at from server */
  updatedAt?: string;
}

const OUTCOME_DESCRIPTIONS: Record<ResolutionOutcome, string> = {
  successful: "All or most cats in the colony were fixed",
  partial: "Some cats fixed, but some remain (trap-shy, inaccessible, etc.)",
  unable_to_complete: "Could not fix any cats despite effort",
  no_longer_needed: "Requester withdrew, stopped responding, or resolved on their own",
  referred_out: "Referred to another organization or outside service area",
};

export function CloseRequestModal({
  isOpen,
  onClose,
  requestId,
  placeId,
  placeName,
  staffName,
  onSuccess,
  updatedAt,
}: CloseRequestModalProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<ResolutionOutcome | null>(null);
  const [reasons, setReasons] = useState<ResolutionReason[]>([]);
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  // Simple cat counts — feeds into record_completion_observation via PATCH
  const [catsSeen, setCatsSeen] = useState<number | "">("");
  const [eartipsSeen, setEartipsSeen] = useState<number | "">("");
  const [loadingReasons, setLoadingReasons] = useState(false);

  // Fetch reasons when outcome is selected
  useEffect(() => {
    if (selectedOutcome) {
      fetchReasons(selectedOutcome);
    }
  }, [selectedOutcome]);

  async function fetchReasons(outcome: ResolutionOutcome) {
    setLoadingReasons(true);
    try {
      const data = await fetchApi<{ reasons: ResolutionReason[] }>(
        `/api/resolution-reasons?status=completed&outcome=${outcome}`
      );
      setReasons(data.reasons || []);
    } catch (err) {
      console.error("Error fetching reasons:", err);
      setReasons([]);
    } finally {
      setLoadingReasons(false);
    }
  }

  const selectedReasonObj = reasons.find((r) => r.reason_code === selectedReason);
  const requiresNotes = selectedReasonObj?.requires_notes ||
    selectedOutcome === "unable_to_complete";

  // Show cat count fields for successful/partial outcomes with a place
  const showCatCounts = (selectedOutcome === "successful" || selectedOutcome === "partial") && placeId;

  const canSubmit = selectedOutcome && (reasons.length === 0 || selectedReason) && (!requiresNotes || resolutionNotes.trim());

  const submitFn = useCallback(async () => {
    if (!selectedOutcome) throw new Error("Please select an outcome");

    const catsSeenNum = typeof catsSeen === "number" ? catsSeen : null;
    const eartipsSeenNum = typeof eartipsSeen === "number" ? eartipsSeen : null;

    await postApi(`/api/requests/${requestId}`, {
      status: "completed",
      resolution_outcome: selectedOutcome,
      resolution_reason: selectedReason || null,
      resolution_notes: resolutionNotes || null,
      skip_trip_report_check: true,
      observation_cats_seen: catsSeenNum,
      observation_eartips_seen: eartipsSeenNum,
      observation_notes: resolutionNotes || null,
      updated_at: updatedAt,
    }, { method: "PATCH" });
  }, [selectedOutcome, catsSeen, eartipsSeen, requestId, selectedReason, resolutionNotes]);

  const { loading, error, clearError, handleSubmit } = useAsyncForm({
    onSubmit: submitFn,
    onSuccess: () => {
      onSuccess?.();
      handleClose();
    },
  });

  function handleClose() {
    if (loading) return;
    setSelectedOutcome(null);
    setSelectedReason("");
    setResolutionNotes("");
    setCatsSeen("");
    setEartipsSeen("");
    clearError();
    onClose();
  }

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={handleClose} disabled={loading}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="md"
        onClick={handleSubmit}
        loading={loading}
        disabled={!canSubmit}
        style={selectedOutcome ? {
          background: RESOLUTION_OUTCOME_COLORS[selectedOutcome].color,
          borderColor: "transparent",
        } : undefined}
      >
        Close Case
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Close Case"
      size="md"
      footer={footer}
    >
      {/* Outcome selection — always visible */}
      <div>
        <p style={{ margin: `0 0 ${SPACING.md}`, fontSize: "0.9rem", fontWeight: 500 }}>
          What was the outcome?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.sm }}>
          {RESOLUTION_OUTCOMES.map((outcome) => {
            const colors = RESOLUTION_OUTCOME_COLORS[outcome];
            const isSelected = selectedOutcome === outcome;
            return (
              <button
                key={outcome}
                type="button"
                onClick={() => {
                  setSelectedOutcome(outcome);
                  setSelectedReason("");
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  padding: SPACING.md,
                  border: `2px solid ${isSelected ? colors.color : "var(--border-light, #d1d5db)"}`,
                  borderRadius: BORDERS.radius.lg,
                  background: isSelected ? colors.bg : "var(--card-bg, #fff)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: isSelected ? colors.color : "var(--foreground)",
                }}>
                  {RESOLUTION_OUTCOME_LABELS[outcome]}
                </span>
                <span style={{
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                  marginTop: "2px",
                }}>
                  {OUTCOME_DESCRIPTIONS[outcome]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Reason selection — appears when outcome selected */}
      {selectedOutcome && (
        <div style={{ marginTop: SPACING.lg }}>
          <div style={{
            display: "inline-flex",
            padding: `2px ${SPACING.sm}`,
            borderRadius: BORDERS.radius.md,
            background: RESOLUTION_OUTCOME_COLORS[selectedOutcome].bg,
            color: RESOLUTION_OUTCOME_COLORS[selectedOutcome].color,
            fontSize: "0.8rem",
            fontWeight: 500,
            marginBottom: SPACING.md,
          }}>
            {RESOLUTION_OUTCOME_LABELS[selectedOutcome]}
          </div>

          {loadingReasons ? (
            <div style={{ fontSize: "0.9rem", color: "var(--muted)", padding: SPACING.md }}>
              Loading reasons...
            </div>
          ) : reasons.length === 0 ? null : (
            <>
              <p style={{ margin: `0 0 ${SPACING.sm}`, fontSize: "0.9rem", fontWeight: 500 }}>
                Select a specific reason
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: SPACING.xs }}>
                {reasons.map((reason) => (
                  <button
                    key={reason.reason_code}
                    type="button"
                    onClick={() => setSelectedReason(reason.reason_code)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: SPACING.sm,
                      padding: `${SPACING.sm} ${SPACING.md}`,
                      border: `1px solid ${selectedReason === reason.reason_code ? COLORS.primary : "var(--border-light, #d1d5db)"}`,
                      borderRadius: BORDERS.radius.lg,
                      background: selectedReason === reason.reason_code
                        ? `${COLORS.primary}15`
                        : "var(--card-bg, #fff)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: "0.9rem",
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      border: `2px solid ${selectedReason === reason.reason_code ? COLORS.primary : "#9ca3af"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {selectedReason === reason.reason_code && (
                        <span style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: COLORS.primary,
                        }} />
                      )}
                    </span>
                    <span>{reason.reason_label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Cat counts + notes — appears when outcome selected */}
      {selectedOutcome && (
        <div style={{ marginTop: SPACING.lg }}>
          {/* Simple cat counts for Beacon — only for successful/partial with a place */}
          <div className={`expandable-section${showCatCounts ? " expanded" : ""}`}>
            <div className="expandable-content">
              <div style={{
                padding: SPACING.md,
                background: "var(--section-bg, #f8f9fa)",
                borderRadius: BORDERS.radius.lg,
                marginBottom: SPACING.lg,
              }}>
                <p style={{ margin: `0 0 ${SPACING.sm}`, fontSize: "0.85rem", fontWeight: 500 }}>
                  Last known cat count (optional)
                </p>
                <p style={{ margin: `0 0 ${SPACING.md}`, fontSize: "0.8rem", color: "var(--muted)" }}>
                  Helps Beacon track colony size over time
                  {placeName && <> at <strong>{placeName}</strong></>}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.md }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: SPACING.xs }}>
                      Cats Seen
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={catsSeen}
                      onChange={(e) => setCatsSeen(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
                      placeholder="0"
                      style={{
                        width: "100%", padding: `${SPACING.xs} ${SPACING.sm}`,
                        border: "1px solid var(--border)", borderRadius: BORDERS.radius.md,
                        fontSize: "0.9rem", boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: SPACING.xs }}>
                      Ear-Tipped
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={eartipsSeen}
                      onChange={(e) => setEartipsSeen(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
                      placeholder="0"
                      style={{
                        width: "100%", padding: `${SPACING.xs} ${SPACING.sm}`,
                        border: "1px solid var(--border)", borderRadius: BORDERS.radius.md,
                        fontSize: "0.9rem", boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: SPACING.xs }}>
            Resolution Notes
            {requiresNotes && <span style={{ color: COLORS.error }}> *</span>}
          </label>
          <textarea
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            rows={4}
            placeholder={
              requiresNotes
                ? "Please describe what happened..."
                : "Additional details about the resolution (optional)..."
            }
            style={{
              width: "100%",
              padding: `${SPACING.sm} ${SPACING.md}`,
              border: "1px solid var(--border)",
              borderRadius: BORDERS.radius.lg,
              fontSize: "0.9rem",
              resize: "vertical",
              background: "var(--input-bg, #fff)",
              boxSizing: "border-box",
            }}
            required={requiresNotes}
          />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          marginTop: SPACING.lg,
          padding: SPACING.md,
          background: "var(--danger-bg)",
          border: "1px solid var(--danger-border)",
          borderRadius: BORDERS.radius.lg,
        }}>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--danger-text)" }}>{error}</p>
        </div>
      )}
    </Modal>
  );
}
