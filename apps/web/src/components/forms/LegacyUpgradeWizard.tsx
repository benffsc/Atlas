"use client";

import { useState } from "react";

interface LegacyRequest {
  request_id: string;
  summary: string | null;
  place_name: string | null;
  requester_name: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
}

interface UpgradeFormData {
  // Step 1: Kitten check
  kittens_already_taken: boolean;
  // Step 2: Access
  permission_status: string;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  access_notes: string;
  // Step 3: Cat count clarification (semantic shift)
  cat_count_clarification: "total" | "needs_tnr" | "unknown";
  cats_still_needing_tnr: string;  // If clarification is "total", how many still need TNR
  // Step 4: Colony info
  colony_duration: string;
  count_confidence: string;
  is_being_fed: boolean | null;
  feeding_schedule: string;
  best_times_seen: string;
  // Step 5: Urgency
  urgency_reasons: string[];
  urgency_notes: string;
  already_assessed: boolean;
}

interface LegacyUpgradeWizardProps {
  request: LegacyRequest;
  onComplete: (newRequestId: string) => void;
  onCancel: () => void;
}

export function LegacyUpgradeWizard({ request, onComplete, onCancel }: LegacyUpgradeWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<UpgradeFormData>({
    kittens_already_taken: false,
    permission_status: "unknown",
    traps_overnight_safe: null,
    access_without_contact: null,
    access_notes: "",
    cat_count_clarification: "unknown",
    cats_still_needing_tnr: "",
    colony_duration: "unknown",
    count_confidence: "unknown",
    is_being_fed: null,
    feeding_schedule: "",
    best_times_seen: "",
    urgency_reasons: [],
    urgency_notes: "",
    already_assessed: false,
  });

  const totalSteps = 6;

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${request.request_id}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permission_status: formData.permission_status,
          access_notes: formData.access_notes || null,
          traps_overnight_safe: formData.traps_overnight_safe,
          access_without_contact: formData.access_without_contact,
          // Cat count semantic clarification
          cat_count_clarification: formData.cat_count_clarification,
          cats_still_needing_tnr: formData.cat_count_clarification === "total" && formData.cats_still_needing_tnr
            ? parseInt(formData.cats_still_needing_tnr)
            : null,
          colony_duration: formData.colony_duration,
          count_confidence: formData.count_confidence,
          is_being_fed: formData.is_being_fed,
          feeding_schedule: formData.feeding_schedule || null,
          best_times_seen: formData.best_times_seen || null,
          urgency_reasons: formData.urgency_reasons.length > 0 ? formData.urgency_reasons : null,
          urgency_notes: formData.urgency_notes || null,
          kittens_already_taken: formData.kittens_already_taken,
          already_assessed: formData.already_assessed,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        const errorMsg = result.details
          ? `${result.error}: ${result.details}`
          : result.error || "Failed to upgrade request";
        throw new Error(errorMsg);
      }

      onComplete(result.new_request_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (updates: Partial<UpgradeFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const toggleUrgencyReason = (reason: string) => {
    setFormData((prev) => ({
      ...prev,
      urgency_reasons: prev.urgency_reasons.includes(reason)
        ? prev.urgency_reasons.filter((r) => r !== reason)
        : [...prev.urgency_reasons, reason],
    }));
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
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--card-bg)",
          color: "var(--foreground)",
          borderRadius: "12px",
          width: "90%",
          maxWidth: "600px",
          maxHeight: "90vh",
          overflow: "auto",
          padding: "1.5rem",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Upgrade Legacy Request</h2>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              {request.summary || request.place_name || "TNR Request"}
            </p>
          </div>
          <button
            onClick={onCancel}
            style={{ background: "transparent", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--text-secondary)" }}
          >
            ×
          </button>
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {[1, 2, 3, 4, 5, 6].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: "4px",
                borderRadius: "2px",
                background: s <= step ? "#0d6efd" : "var(--border)",
              }}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "0.75rem", background: "var(--danger-bg)", color: "var(--danger-text)", borderRadius: "6px", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        {/* Step 1: Kitten Check */}
        {step === 1 && (
          <div>
            <h3 style={{ marginTop: 0 }}>Step 1: Kitten Status</h3>
            {request.has_kittens && (
              <div style={{ padding: "0.75rem", background: "var(--warning-bg)", color: "var(--warning-text)", borderRadius: "6px", marginBottom: "1rem" }}>
                This request was marked as having kittens.
              </div>
            )}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={formData.kittens_already_taken}
                  onChange={(e) => updateForm({ kittens_already_taken: e.target.checked })}
                />
                <span>Kittens have already been taken/fostered</span>
              </label>
              <p style={{ margin: "0.25rem 0 0 1.5rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Check this if kittens were removed before or during the TNR process.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Access Questions */}
        {step === 2 && (
          <div>
            <h3 style={{ marginTop: 0 }}>Step 2: Access & Permission</h3>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Permission Status</label>
              <select
                value={formData.permission_status}
                onChange={(e) => updateForm({ permission_status: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - Have permission</option>
                <option value="pending">Pending - Waiting for response</option>
                <option value="no">No - Permission denied</option>
                <option value="not_needed">Not needed - Public property</option>
              </select>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Traps safe overnight?</label>
              <div style={{ display: "flex", gap: "1rem" }}>
                {["Yes", "No", "Unknown"].map((opt) => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="traps_overnight"
                      checked={formData.traps_overnight_safe === (opt === "Yes" ? true : opt === "No" ? false : null)}
                      onChange={() => updateForm({ traps_overnight_safe: opt === "Yes" ? true : opt === "No" ? false : null })}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Can access without contact?</label>
              <div style={{ display: "flex", gap: "1rem" }}>
                {["Yes", "No", "Unknown"].map((opt) => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="access_without_contact"
                      checked={formData.access_without_contact === (opt === "Yes" ? true : opt === "No" ? false : null)}
                      onChange={() => updateForm({ access_without_contact: opt === "Yes" ? true : opt === "No" ? false : null })}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Access Notes (optional)</label>
              <textarea
                value={formData.access_notes}
                onChange={(e) => updateForm({ access_notes: e.target.value })}
                placeholder="Gate code, best times, special instructions..."
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
          </div>
        )}

        {/* Step 3: Cat Count Clarification */}
        {step === 3 && (
          <div>
            <h3 style={{ marginTop: 0 }}>Step 3: Cat Count Clarification</h3>

            {request.estimated_cat_count ? (
              <>
                <div style={{ padding: "1rem", background: "var(--info-bg)", borderRadius: "8px", marginBottom: "1rem" }}>
                  <p style={{ margin: 0 }}>
                    The original request listed <strong>{request.estimated_cat_count} cats</strong>.
                  </p>
                </div>

                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    What does this number represent?
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.75rem",
                        border: `2px solid ${formData.cat_count_clarification === "total" ? "#0d6efd" : "var(--border)"}`,
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: formData.cat_count_clarification === "total" ? "var(--info-bg)" : "var(--card-bg)",
                      }}
                    >
                      <input
                        type="radio"
                        name="cat_count_clarification"
                        checked={formData.cat_count_clarification === "total"}
                        onChange={() => updateForm({ cat_count_clarification: "total" })}
                      />
                      <span>
                        <strong>Total cats at location</strong>
                        <span style={{ display: "block", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                          This is the colony size estimate, some may already be fixed
                        </span>
                      </span>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.75rem",
                        border: `2px solid ${formData.cat_count_clarification === "needs_tnr" ? "#0d6efd" : "var(--border)"}`,
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: formData.cat_count_clarification === "needs_tnr" ? "var(--info-bg)" : "var(--card-bg)",
                      }}
                    >
                      <input
                        type="radio"
                        name="cat_count_clarification"
                        checked={formData.cat_count_clarification === "needs_tnr"}
                        onChange={() => updateForm({ cat_count_clarification: "needs_tnr" })}
                      />
                      <span>
                        <strong>Cats still needing TNR</strong>
                        <span style={{ display: "block", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                          These are specifically unfixed cats that need spay/neuter
                        </span>
                      </span>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.75rem",
                        border: `2px solid ${formData.cat_count_clarification === "unknown" ? "#0d6efd" : "var(--border)"}`,
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: formData.cat_count_clarification === "unknown" ? "var(--info-bg)" : "var(--card-bg)",
                      }}
                    >
                      <input
                        type="radio"
                        name="cat_count_clarification"
                        checked={formData.cat_count_clarification === "unknown"}
                        onChange={() => updateForm({ cat_count_clarification: "unknown" })}
                      />
                      <span>
                        <strong>Unknown / Not sure</strong>
                        <span style={{ display: "block", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                          We'll keep the original number as-is
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                {formData.cat_count_clarification === "total" && (
                  <div style={{ marginBottom: "1rem", padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                      How many of those still need to be fixed?
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={request.estimated_cat_count}
                      value={formData.cats_still_needing_tnr}
                      onChange={(e) => updateForm({ cats_still_needing_tnr: e.target.value })}
                      placeholder="Enter number"
                      style={{ width: "120px" }}
                    />
                    <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      This becomes the TNR target for tracking progress
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                  No cat count was recorded for this request. Skip to next step.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Colony Info */}
        {step === 4 && (
          <div>
            <h3 style={{ marginTop: 0 }}>Step 4: Colony Information</h3>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>How long has this colony been known?</label>
              <select
                value={formData.colony_duration}
                onChange={(e) => updateForm({ colony_duration: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="unknown">Unknown</option>
                <option value="under_1_month">Under 1 month</option>
                <option value="1_to_6_months">1-6 months</option>
                <option value="6_to_24_months">6-24 months</option>
                <option value="over_2_years">Over 2 years</option>
              </select>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cat count confidence</label>
              <select
                value={formData.count_confidence}
                onChange={(e) => updateForm({ count_confidence: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="unknown">Unknown</option>
                <option value="exact">Exact count</option>
                <option value="good_estimate">Good estimate</option>
                <option value="rough_guess">Rough guess</option>
              </select>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Are the cats being fed?</label>
              <div style={{ display: "flex", gap: "1rem" }}>
                {["Yes", "No", "Unknown"].map((opt) => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="is_being_fed"
                      checked={formData.is_being_fed === (opt === "Yes" ? true : opt === "No" ? false : null)}
                      onChange={() => updateForm({ is_being_fed: opt === "Yes" ? true : opt === "No" ? false : null })}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            {formData.is_being_fed && (
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeding Schedule</label>
                <input
                  type="text"
                  value={formData.feeding_schedule}
                  onChange={(e) => updateForm({ feeding_schedule: e.target.value })}
                  placeholder="e.g., 6am and 6pm daily"
                  style={{ width: "100%" }}
                />
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Best times cats are seen (optional)</label>
              <input
                type="text"
                value={formData.best_times_seen}
                onChange={(e) => updateForm({ best_times_seen: e.target.value })}
                placeholder="e.g., Early morning, dusk"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}

        {/* Step 5: Urgency */}
        {step === 5 && (
          <div>
            <h3 style={{ marginTop: 0 }}>Step 5: Urgency Factors</h3>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>Select any urgency reasons:</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {[
                  { value: "kittens", label: "Kittens" },
                  { value: "sick_injured", label: "Sick/Injured" },
                  { value: "eviction", label: "Eviction" },
                  { value: "threat", label: "Threat to cats" },
                  { value: "moving", label: "Requester moving" },
                  { value: "weather", label: "Weather concerns" },
                  { value: "population_explosion", label: "Population growth" },
                ].map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    onClick={() => toggleUrgencyReason(reason.value)}
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "6px",
                      border: "1px solid",
                      borderColor: formData.urgency_reasons.includes(reason.value) ? "#0d6efd" : "var(--border)",
                      background: formData.urgency_reasons.includes(reason.value) ? "#0d6efd" : "var(--card-bg)",
                      color: formData.urgency_reasons.includes(reason.value) ? "var(--card-bg)" : "var(--foreground)",
                      cursor: "pointer",
                    }}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Urgency Notes (optional)</label>
              <textarea
                value={formData.urgency_notes}
                onChange={(e) => updateForm({ urgency_notes: e.target.value })}
                placeholder="Additional urgency details..."
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={formData.already_assessed}
                  onChange={(e) => updateForm({ already_assessed: e.target.checked })}
                />
                <span>This request has already been assessed</span>
              </label>
              <p style={{ margin: "0.25rem 0 0 1.5rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Check if a trapper has already visited or evaluated this location.
              </p>
            </div>
          </div>
        )}

        {/* Step 6: Confirmation */}
        {step === 6 && (
          <div>
            <h3 style={{ marginTop: 0 }}>Step 6: Confirm Upgrade</h3>

            <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px", marginBottom: "1rem" }}>
              <h4 style={{ margin: "0 0 0.75rem" }}>Summary</h4>
              <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.875rem" }}>
                <div><strong>Request:</strong> {request.summary || request.place_name || "TNR Request"}</div>
                <div><strong>Permission:</strong> {formData.permission_status}</div>
                {request.estimated_cat_count && formData.cat_count_clarification !== "unknown" && (
                  <div>
                    <strong>Cat Count ({request.estimated_cat_count}):</strong>{" "}
                    {formData.cat_count_clarification === "total"
                      ? `Total colony (${formData.cats_still_needing_tnr || "?"} still need TNR)`
                      : "Cats needing TNR"}
                  </div>
                )}
                <div><strong>Colony Duration:</strong> {formData.colony_duration.replace(/_/g, " ")}</div>
                <div><strong>Count Confidence:</strong> {formData.count_confidence.replace(/_/g, " ")}</div>
                {formData.is_being_fed !== null && (
                  <div><strong>Being Fed:</strong> {formData.is_being_fed ? "Yes" : "No"}</div>
                )}
                {formData.urgency_reasons.length > 0 && (
                  <div><strong>Urgency:</strong> {formData.urgency_reasons.join(", ")}</div>
                )}
                {formData.kittens_already_taken && (
                  <div style={{ color: "var(--warning-text)" }}>Kittens already taken</div>
                )}
                {formData.already_assessed && (
                  <div style={{ color: "var(--warning-text)" }}>Already assessed</div>
                )}
              </div>
            </div>

            <div style={{ padding: "0.75rem", background: "var(--info-bg)", color: "var(--info-text)", borderRadius: "6px", fontSize: "0.875rem" }}>
              <strong>What will happen:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                <li>A new Atlas request will be created with the original date</li>
                <li>The legacy request will be archived (status: cancelled)</li>
                <li>All linked cats will be copied to the new request</li>
                <li>Both actions will be logged for audit</li>
              </ul>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
          <button
            onClick={() => (step === 1 ? onCancel() : setStep(step - 1))}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>

          {step < totalSteps ? (
            <button
              onClick={() => setStep(step + 1)}
              style={{
                padding: "0.5rem 1rem",
                background: "#0d6efd",
                color: "var(--card-bg)",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                padding: "0.5rem 1.5rem",
                background: "#198754",
                color: "var(--card-bg)",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {saving ? "Upgrading..." : "Upgrade Request"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
