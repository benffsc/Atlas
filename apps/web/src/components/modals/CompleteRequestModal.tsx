"use client";

import { useState, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { Modal } from "@/components/ui";
import { COLORS, SPACING, BORDERS } from "@/lib/design-tokens";

interface ResolutionReason {
  reason_code: string;
  reason_label: string;
  reason_description: string | null;
  applies_to_status: string[];
  requires_notes: boolean;
  display_order: number;
}

interface ObservationData {
  cats_seen_total: number;
  eartipped_seen: number;
  time_of_day: string;
  notes: string;
  is_at_feeding_station: boolean;
}

interface CompleteRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  placeId?: string;
  placeName?: string;
  staffId?: string;
  staffName?: string;
  onSuccess?: () => void;
  targetStatus?: "completed" | "cancelled";
}

export default function CompleteRequestModal({
  isOpen,
  onClose,
  requestId,
  placeId,
  placeName,
  staffId,
  staffName,
  onSuccess,
  targetStatus = "completed",
}: CompleteRequestModalProps) {
  const [reasons, setReasons] = useState<ResolutionReason[]>([]);
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [showObservation, setShowObservation] = useState(false);
  const [observation, setObservation] = useState<ObservationData>({
    cats_seen_total: 0,
    eartipped_seen: 0,
    time_of_day: "afternoon",
    notes: "",
    is_at_feeding_station: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingReasons, setLoadingReasons] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch resolution reasons on mount
  useEffect(() => {
    if (isOpen) {
      fetchReasons();
    }
  }, [isOpen, targetStatus]);

  async function fetchReasons() {
    setLoadingReasons(true);
    try {
      const data = await fetchApi<{ reasons: ResolutionReason[] }>(`/api/resolution-reasons?status=${targetStatus}`);
      setReasons(data.reasons || []);
    } catch (err) {
      console.error("Error fetching reasons:", err);
      setError("Failed to load completion reasons");
    } finally {
      setLoadingReasons(false);
    }
  }

  const selectedReasonObj = reasons.find((r) => r.reason_code === selectedReason);
  const requiresNotes = selectedReasonObj?.requires_notes || false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!selectedReason) {
      setError("Please select a completion reason");
      return;
    }
    if (requiresNotes && !resolutionNotes.trim()) {
      setError("Please provide notes for the selected reason");
      return;
    }

    setLoading(true);

    try {
      // If observation data provided and we have a place, create site observation first
      if (showObservation && placeId && observation.cats_seen_total > 0) {
        try {
          await postApi("/api/observations", {
            place_id: placeId,
            request_id: requestId,
            observation_date: new Date().toISOString().split("T")[0],
            time_of_day: observation.time_of_day,
            cats_seen_total: observation.cats_seen_total,
            eartipped_seen: observation.eartipped_seen,
            is_at_feeding_station: observation.is_at_feeding_station,
            notes: observation.notes || `Final observation during request completion`,
            is_final_visit: true,
            observer_name: staffName,
          });
        } catch {
          console.warn("Failed to create observation, continuing with completion");
        }
      }

      // Update request status with resolution reason
      await postApi(`/api/requests/${requestId}`, {
        status: targetStatus,
        resolution_reason: selectedReason,
        resolution_notes: resolutionNotes || null,
        skip_trip_report_check: true, // We're handling observation in this modal
        // Also pass observation data for the existing completion logic
        observation_cats_seen: showObservation ? observation.cats_seen_total : null,
        observation_eartips_seen: showObservation ? observation.eartipped_seen : null,
        observation_notes: showObservation ? observation.notes : null,
      }, { method: "PATCH" });

      onSuccess?.();
      handleClose();
    } catch (err) {
      console.error("Error completing request:", err);
      setError(err instanceof Error ? err.message : "Failed to complete request");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (!loading) {
      setSelectedReason("");
      setResolutionNotes("");
      setShowObservation(false);
      setObservation({
        cats_seen_total: 0,
        eartipped_seen: 0,
        time_of_day: "afternoon",
        notes: "",
        is_at_feeding_station: false,
      });
      setError(null);
      onClose();
    }
  }

  const statusLabel = targetStatus === "completed" ? "Complete" : "Cancel";

  const footer = (
    <>
      <button
        type="button"
        onClick={handleClose}
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
        Cancel
      </button>
      <button
        type="submit"
        form="complete-request-form"
        disabled={loading || loadingReasons}
        style={{
          padding: `${SPACING.sm} ${SPACING.lg}`,
          border: "none",
          borderRadius: BORDERS.radius.lg,
          background: targetStatus === "completed" ? COLORS.success : COLORS.warning,
          color: targetStatus === "completed" ? COLORS.white : COLORS.black,
          fontSize: "0.9rem",
          fontWeight: 500,
          cursor: loading || loadingReasons ? "not-allowed" : "pointer",
          opacity: loading || loadingReasons ? 0.6 : 1,
        }}
      >
        {loading ? "Processing..." : `${statusLabel} Request`}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`${statusLabel} Request`}
      size="md"
      footer={footer}
    >
      {staffName && (
        <p style={{ margin: `0 0 ${SPACING.md}`, fontSize: "0.85rem", color: "var(--muted)" }}>
          Recording as: {staffName}
        </p>
      )}

      <form id="complete-request-form" onSubmit={handleSubmit}>
        {/* Resolution Reason */}
        <div style={{ marginBottom: SPACING.lg }}>
          <label
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 500,
              marginBottom: SPACING.xs,
            }}
          >
            {statusLabel === "Complete" ? "Completion" : "Cancellation"} Reason{" "}
            <span style={{ color: COLORS.error }}>*</span>
          </label>
          {loadingReasons ? (
            <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
              Loading reasons...
            </div>
          ) : (
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              style={{
                width: "100%",
                padding: `${SPACING.sm} ${SPACING.md}`,
                border: "1px solid var(--border)",
                borderRadius: BORDERS.radius.lg,
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
              required
            >
              <option value="">Select a reason...</option>
              {reasons.map((reason) => (
                <option key={reason.reason_code} value={reason.reason_code}>
                  {reason.reason_label}
                </option>
              ))}
            </select>
          )}
          {selectedReasonObj?.reason_description && (
            <p style={{ margin: `${SPACING.xs} 0 0`, fontSize: "0.8rem", color: "var(--muted)" }}>
              {selectedReasonObj.reason_description}
            </p>
          )}
        </div>

        {/* Resolution Notes */}
        <div style={{ marginBottom: SPACING.lg }}>
          <label
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 500,
              marginBottom: SPACING.xs,
            }}
          >
            Resolution Notes
            {requiresNotes && <span style={{ color: COLORS.error }}> *</span>}
          </label>
          <textarea
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            rows={3}
            placeholder="Additional details about the resolution..."
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

        {/* Final Site Visit Observation (optional, only for completed) */}
        {targetStatus === "completed" && placeId && (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: SPACING.lg,
              marginTop: SPACING.lg,
            }}
          >
            <button
              type="button"
              onClick={() => setShowObservation(!showObservation)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "0",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "0.9rem",
                fontWeight: 500,
                color: "var(--foreground)",
              }}
            >
              <span>Final Site Observation (optional)</span>
              <span>{showObservation ? "\u25B2" : "\u25BC"}</span>
            </button>
            <p style={{ margin: `${SPACING.xs} 0 0`, fontSize: "0.8rem", color: "var(--muted)" }}>
              Log final cat counts for Beacon population estimates
            </p>

            {showObservation && (
              <div
                style={{
                  marginTop: SPACING.md,
                  padding: SPACING.lg,
                  background: "var(--section-bg, #f8f9fa)",
                  borderRadius: BORDERS.radius.lg,
                }}
              >
                {placeName && (
                  <p style={{ margin: `0 0 ${SPACING.md}`, fontSize: "0.9rem", color: "var(--foreground)" }}>
                    Location: <strong>{placeName}</strong>
                  </p>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.md }}>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        marginBottom: SPACING.xs,
                      }}
                    >
                      Cats Observed
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={observation.cats_seen_total}
                      onChange={(e) =>
                        setObservation({
                          ...observation,
                          cats_seen_total: parseInt(e.target.value) || 0,
                        })
                      }
                      style={{
                        width: "100%",
                        padding: `${SPACING.xs} ${SPACING.sm}`,
                        border: "1px solid var(--border)",
                        borderRadius: BORDERS.radius.md,
                        fontSize: "0.9rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        marginBottom: SPACING.xs,
                      }}
                    >
                      Ear-Tipped
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={observation.cats_seen_total}
                      value={observation.eartipped_seen}
                      onChange={(e) =>
                        setObservation({
                          ...observation,
                          eartipped_seen: parseInt(e.target.value) || 0,
                        })
                      }
                      style={{
                        width: "100%",
                        padding: `${SPACING.xs} ${SPACING.sm}`,
                        border: "1px solid var(--border)",
                        borderRadius: BORDERS.radius.md,
                        fontSize: "0.9rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.md, marginTop: SPACING.md }}>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        marginBottom: SPACING.xs,
                      }}
                    >
                      Time of Day
                    </label>
                    <select
                      value={observation.time_of_day}
                      onChange={(e) =>
                        setObservation({
                          ...observation,
                          time_of_day: e.target.value,
                        })
                      }
                      style={{
                        width: "100%",
                        padding: `${SPACING.xs} ${SPACING.sm}`,
                        border: "1px solid var(--border)",
                        borderRadius: BORDERS.radius.md,
                        fontSize: "0.9rem",
                      }}
                    >
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                      <option value="night">Night</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: SPACING.xs }}>
                    <label style={{ display: "flex", alignItems: "center", gap: SPACING.xs, fontSize: "0.8rem" }}>
                      <input
                        type="checkbox"
                        checked={observation.is_at_feeding_station}
                        onChange={(e) =>
                          setObservation({
                            ...observation,
                            is_at_feeding_station: e.target.checked,
                          })
                        }
                      />
                      At feeding station
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: SPACING.md }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      marginBottom: SPACING.xs,
                    }}
                  >
                    Observation Notes
                  </label>
                  <textarea
                    value={observation.notes}
                    onChange={(e) =>
                      setObservation({
                        ...observation,
                        notes: e.target.value,
                      })
                    }
                    rows={2}
                    placeholder="Additional notes about the observation..."
                    style={{
                      width: "100%",
                      padding: `${SPACING.xs} ${SPACING.sm}`,
                      border: "1px solid var(--border)",
                      borderRadius: BORDERS.radius.md,
                      fontSize: "0.9rem",
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div
            style={{
              marginTop: SPACING.lg,
              padding: SPACING.md,
              background: COLORS.errorLight,
              border: `1px solid ${COLORS.error}20`,
              borderRadius: BORDERS.radius.lg,
            }}
          >
            <p style={{ margin: 0, fontSize: "0.9rem", color: COLORS.errorDark }}>{error}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
