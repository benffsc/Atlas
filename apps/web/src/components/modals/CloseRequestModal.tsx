"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useAsyncForm } from "@/hooks/useAsyncForm";
import { Modal } from "@/components/ui";
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
}

type Step = "outcome" | "reason" | "notes";

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
}: CloseRequestModalProps) {
  const [step, setStep] = useState<Step>("outcome");
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

  const steps: Step[] = ["outcome", "reason", "notes"];

  function nextStep() {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) {
      setStep(steps[idx + 1]);
    }
  }

  function prevStep() {
    const idx = steps.indexOf(step);
    if (idx > 0) {
      setStep(steps[idx - 1]);
    }
  }

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
    setStep("outcome");
    setSelectedOutcome(null);
    setSelectedReason("");
    setResolutionNotes("");
    setCatsSeen("");
    setEartipsSeen("");
    clearError();
    onClose();
  }

  const currentStepIdx = steps.indexOf(step);
  const isLastStep = currentStepIdx === steps.length - 1;

  const footer = (
    <>
      <button
        type="button"
        onClick={currentStepIdx === 0 ? handleClose : prevStep}
        disabled={loading}
        style={{
          padding: `${SPACING.sm} ${SPACING.lg}`,
          border: "1px solid var(--border)",
          borderRadius: BORDERS.radius.lg,
          background: "var(--card-bg, #fff)",
          fontSize: "0.9rem",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {currentStepIdx === 0 ? "Cancel" : "Back"}
      </button>
      {isLastStep ? (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !selectedOutcome}
          style={{
            padding: `${SPACING.sm} ${SPACING.lg}`,
            border: "none",
            borderRadius: BORDERS.radius.lg,
            background: selectedOutcome ? RESOLUTION_OUTCOME_COLORS[selectedOutcome].color : COLORS.success,
            color: COLORS.white,
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: loading || !selectedOutcome ? "not-allowed" : "pointer",
            opacity: loading || !selectedOutcome ? 0.6 : 1,
          }}
        >
          {loading ? "Closing..." : "Close Case"}
        </button>
      ) : (
        <button
          type="button"
          onClick={nextStep}
          disabled={
            (step === "outcome" && !selectedOutcome) ||
            (step === "reason" && reasons.length > 0 && !selectedReason)
          }
          style={{
            padding: `${SPACING.sm} ${SPACING.lg}`,
            border: "none",
            borderRadius: BORDERS.radius.lg,
            background: COLORS.primary,
            color: COLORS.white,
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: "pointer",
            opacity:
              (step === "outcome" && !selectedOutcome) ||
              (step === "reason" && reasons.length > 0 && !selectedReason)
                ? 0.6
                : 1,
          }}
        >
          Next
        </button>
      )}
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
      {/* Step indicator */}
      <div style={{
        display: "flex",
        gap: SPACING.xs,
        marginBottom: SPACING.lg,
      }}>
        {steps.map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              height: "3px",
              borderRadius: "2px",
              background: i <= currentStepIdx ? COLORS.primary : "var(--border)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {/* Step 1: Outcome selection */}
      {step === "outcome" && (
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
                  onClick={() => setSelectedOutcome(outcome)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: SPACING.md,
                    border: `2px solid ${isSelected ? colors.color : "var(--border)"}`,
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
      )}

      {/* Step 2: Reason selection */}
      {step === "reason" && selectedOutcome && (
        <div>
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
          <p style={{ margin: `0 0 ${SPACING.md}`, fontSize: "0.9rem", fontWeight: 500 }}>
            Select a specific reason
          </p>
          {loadingReasons ? (
            <div style={{ fontSize: "0.9rem", color: "var(--muted)", padding: SPACING.md }}>
              Loading reasons...
            </div>
          ) : reasons.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
              No specific reasons available. You can add notes on the next step.
            </p>
          ) : (
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
                    border: `1px solid ${selectedReason === reason.reason_code ? COLORS.primary : "var(--border)"}`,
                    borderRadius: BORDERS.radius.lg,
                    background: selectedReason === reason.reason_code
                      ? `${COLORS.primary}10`
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
                    border: `2px solid ${selectedReason === reason.reason_code ? COLORS.primary : "var(--border)"}`,
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
          )}
        </div>
      )}

      {/* Step 3: Cat counts + notes */}
      {step === "notes" && selectedOutcome && (
        <div>
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
            {selectedReasonObj && ` \u2014 ${selectedReasonObj.reason_label}`}
          </div>

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
          background: COLORS.errorLight,
          border: `1px solid ${COLORS.error}20`,
          borderRadius: BORDERS.radius.lg,
        }}>
          <p style={{ margin: 0, fontSize: "0.9rem", color: COLORS.errorDark }}>{error}</p>
        </div>
      )}
    </Modal>
  );
}
