"use client";

import { useState } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { postApi } from "@/lib/api-client";
import type { RequestDetail } from "@/app/requests/[id]/types";

interface ExtractedField {
  key: string;
  label: string;
  value: unknown;
  type: string;
}

interface ParseResult {
  extracted_fields: Record<string, unknown>;
  categorized: Record<string, ExtractedField[]>;
  unmapped_text: string | null;
  confidence: string;
  field_count: number;
}

type Step = "paste" | "review" | "applying";

interface EnrichmentDrawerProps {
  isOpen: boolean;
  requestId: string;
  request: RequestDetail;
  onClose: () => void;
  onSuccess: () => void;
}

export function EnrichmentDrawer({
  isOpen,
  requestId,
  request,
  onClose,
  onSuccess,
}: EnrichmentDrawerProps) {
  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [sourceType, setSourceType] = useState("email");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set());
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const reset = () => {
    setStep("paste");
    setRawText("");
    setSourceType("email");
    setParsing(false);
    setParseError(null);
    setParseResult(null);
    setCheckedFields(new Set());
    setEditedValues({});
    setApplying(false);
    setApplyError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleExtract = async () => {
    if (!rawText.trim()) return;
    setParsing(true);
    setParseError(null);

    try {
      const result = await postApi<ParseResult>(
        `/api/requests/${requestId}/parse-enrichment`,
        { text: rawText.trim(), source_type: sourceType }
      );
      setParseResult(result);

      // Default all extracted fields to checked
      const allKeys = new Set<string>();
      for (const fields of Object.values(result.categorized)) {
        for (const field of fields) {
          allKeys.add(field.key);
        }
      }
      setCheckedFields(allKeys);
      setEditedValues({ ...result.extracted_fields });
      setStep("review");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to extract fields");
    } finally {
      setParsing(false);
    }
  };

  const handleToggleField = (key: string) => {
    setCheckedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleEditValue = (key: string, value: unknown) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleApply = async () => {
    if (!parseResult) return;
    setApplying(true);
    setApplyError(null);

    try {
      // Build patch from checked fields only
      const patch: Record<string, unknown> = {};
      for (const key of checkedFields) {
        if (editedValues[key] !== undefined) {
          patch[key] = editedValues[key];
        }
      }

      // Append unmapped text to notes if present
      if (parseResult.unmapped_text) {
        const existingNotes = request.notes || "";
        const separator = existingNotes ? "\n\n---\n" : "";
        patch.notes = existingNotes + separator + `[${sourceType}] ` + parseResult.unmapped_text;
      }

      if (Object.keys(patch).length === 0) {
        setApplyError("No fields selected to apply");
        setApplying(false);
        return;
      }

      await postApi(`/api/requests/${requestId}`, patch, { method: "PATCH" });

      // Fire-and-forget journal entry with full original text
      postApi("/api/journal", {
        request_id: requestId,
        entry_kind: "communication",
        tags: ["enrichment", sourceType],
        body: `Enrichment from ${sourceType}: ${Object.keys(patch).length} fields updated.\n\nOriginal text:\n${rawText.trim().slice(0, 2000)}`,
      }).catch(() => {});

      onSuccess();
      reset();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply changes");
    } finally {
      setApplying(false);
    }
  };

  const getCurrentValue = (key: string): unknown => {
    return (request as unknown as Record<string, unknown>)[key];
  };

  const formatDisplayValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  };

  const checkedCount = checkedFields.size;
  const totalExtracted = parseResult?.field_count || 0;

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Information"
      width="lg"
      footer={
        step === "paste" ? (
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button onClick={handleClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleExtract}
              disabled={!rawText.trim() || parsing}
              className="btn"
              style={{ background: "#7c3aed", color: "#fff" }}
            >
              {parsing ? "Extracting..." : "Extract Fields"}
            </button>
          </div>
        ) : step === "review" ? (
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setStep("paste")} className="btn btn-secondary">Back</button>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                {checkedCount} of {totalExtracted} fields selected
              </span>
              <button
                onClick={handleApply}
                disabled={checkedCount === 0 || applying}
                className="btn"
                style={{ background: "#166534", color: "#fff" }}
              >
                {applying ? "Applying..." : `Apply ${checkedCount} Field${checkedCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        ) : null
      }
    >
      {step === "paste" && (
        <div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 1rem 0" }}>
            Paste email, call notes, or any info about this request. AI will extract structured fields for your review.
          </p>

          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Source</label>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {[
              { value: "email", label: "Email" },
              { value: "phone_followup", label: "Phone Follow-up" },
              { value: "site_visit", label: "Site Visit" },
              { value: "other", label: "Other" },
            ].map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex", alignItems: "center", gap: "0.35rem",
                  padding: "0.35rem 0.75rem", borderRadius: "6px", cursor: "pointer",
                  border: `1px solid ${sourceType === opt.value ? "#7c3aed" : "var(--border)"}`,
                  background: sourceType === opt.value ? "#f5f3ff" : "transparent",
                  fontSize: "0.85rem",
                }}
              >
                <input
                  type="radio"
                  name="source_type"
                  value={opt.value}
                  checked={sourceType === opt.value}
                  onChange={() => setSourceType(opt.value)}
                  style={{ display: "none" }}
                />
                {opt.label}
              </label>
            ))}
          </div>

          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Text</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste email content, call notes, or any info here..."
            rows={12}
            style={{
              width: "100%", padding: "0.75rem", borderRadius: "8px",
              border: "1px solid var(--border)", fontSize: "0.9rem",
              resize: "vertical", fontFamily: "inherit",
            }}
            autoFocus
          />
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            {rawText.length > 0 ? `${rawText.length.toLocaleString()} characters` : ""}
          </div>

          {parseError && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", color: "#991b1b", fontSize: "0.85rem" }}>
              {parseError}
            </div>
          )}
        </div>
      )}

      {step === "review" && parseResult && (
        <div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{
              padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600,
              background: parseResult.confidence === "high" ? "#dcfce7" : parseResult.confidence === "medium" ? "#fef3c7" : "#fef2f2",
              color: parseResult.confidence === "high" ? "#166534" : parseResult.confidence === "medium" ? "#92400e" : "#991b1b",
            }}>
              {parseResult.confidence} confidence
            </span>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {totalExtracted} field{totalExtracted !== 1 ? "s" : ""} extracted
            </span>
          </div>

          {Object.entries(parseResult.categorized).map(([category, fields]) => (
            <div key={category} style={{ marginBottom: "1rem" }}>
              <h4 style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 0.5rem 0" }}>
                {category}
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {fields.map((field) => {
                  const isChecked = checkedFields.has(field.key);
                  const currentVal = getCurrentValue(field.key);
                  const hasCurrent = currentVal !== null && currentVal !== undefined && currentVal !== "";

                  return (
                    <div
                      key={field.key}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: "0.5rem",
                        padding: "0.5rem 0.75rem", borderRadius: "6px",
                        border: `1px solid ${isChecked ? "#7c3aed" : "var(--border)"}`,
                        background: isChecked ? "#faf5ff" : "var(--card-bg, #fff)",
                        opacity: isChecked ? 1 : 0.6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleField(field.key)}
                        style={{ marginTop: "0.2rem", accentColor: "#7c3aed" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{field.label}</div>
                        {field.type === "boolean" ? (
                          <div style={{ fontSize: "0.9rem" }}>
                            {formatDisplayValue(editedValues[field.key])}
                          </div>
                        ) : field.type === "number" ? (
                          <input
                            type="number"
                            value={editedValues[field.key] as number ?? ""}
                            onChange={(e) => handleEditValue(field.key, e.target.value ? Number(e.target.value) : null)}
                            style={{
                              width: "80px", padding: "0.2rem 0.4rem", borderRadius: "4px",
                              border: "1px solid var(--border)", fontSize: "0.9rem",
                            }}
                          />
                        ) : (
                          <input
                            type="text"
                            value={String(editedValues[field.key] ?? "")}
                            onChange={(e) => handleEditValue(field.key, e.target.value || null)}
                            style={{
                              width: "100%", padding: "0.2rem 0.4rem", borderRadius: "4px",
                              border: "1px solid var(--border)", fontSize: "0.9rem",
                            }}
                          />
                        )}
                        {hasCurrent && (
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.15rem" }}>
                            Current: {formatDisplayValue(currentVal)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {parseResult.unmapped_text && (
            <div style={{ marginTop: "0.5rem" }}>
              <h4 style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 0.5rem 0" }}>
                Unmapped Info (will go to Notes)
              </h4>
              <div style={{
                padding: "0.5rem 0.75rem", borderRadius: "6px",
                background: "#fffbeb", border: "1px solid #fde68a",
                fontSize: "0.85rem", whiteSpace: "pre-wrap",
              }}>
                {parseResult.unmapped_text}
              </div>
            </div>
          )}

          {applyError && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", color: "#991b1b", fontSize: "0.85rem" }}>
              {applyError}
            </div>
          )}
        </div>
      )}
    </ActionDrawer>
  );
}
