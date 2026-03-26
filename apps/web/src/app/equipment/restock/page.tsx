"use client";

import { useState, useCallback, useMemo } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { StatCard } from "@/components/ui/StatCard";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS } from "@/lib/form-options";
import { getScanResultStyle, getCustodyStyle } from "@/lib/equipment-styles";
import type { EquipmentReconcileResult, EquipmentReconcileSummary } from "@/lib/types/view-contracts";

type Phase = "scanning" | "reviewing" | "applying" | "complete";

interface ActionOverride {
  equipment_id: string;
  action: "check_in" | "mark_missing" | "mark_found" | "skip";
}

export default function RestockPage() {
  const { success, error: showError } = useToast();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [scannedBarcodes, setScannedBarcodes] = useState<string[]>([]);
  const [results, setResults] = useState<EquipmentReconcileResult[]>([]);
  const [summary, setSummary] = useState<EquipmentReconcileSummary | null>(null);
  const [actionOverrides, setActionOverrides] = useState<Map<string, ActionOverride["action"]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);

  // Scan handler
  const handleScan = useCallback((barcode: string) => {
    setScannedBarcodes((prev) => {
      if (prev.includes(barcode)) return prev;
      return [...prev, barcode];
    });
  }, []);

  const removeScan = useCallback((barcode: string) => {
    setScannedBarcodes((prev) => prev.filter((b) => b !== barcode));
  }, []);

  // Group scanned barcodes by tier (for display)
  const scannedCount = scannedBarcodes.length;

  // Review: call reconcile API
  const handleReview = useCallback(async () => {
    if (scannedBarcodes.length === 0) {
      showError("Scan at least one barcode before reviewing");
      return;
    }

    setLoading(true);
    try {
      const data = await postApi<{ results: EquipmentReconcileResult[]; summary: EquipmentReconcileSummary }>(
        "/api/equipment/reconcile",
        { scanned_barcodes: scannedBarcodes }
      );
      setResults(data.results);
      setSummary(data.summary);

      // Pre-fill action overrides from suggested actions
      const overrides = new Map<string, ActionOverride["action"]>();
      for (const r of data.results) {
        if (r.suggested_action) {
          overrides.set(r.equipment_id, r.suggested_action as ActionOverride["action"]);
        }
      }
      setActionOverrides(overrides);
      setPhase("reviewing");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Reconciliation failed");
    } finally {
      setLoading(false);
    }
  }, [scannedBarcodes, showError]);

  // Apply actions
  const handleApply = useCallback(async () => {
    const actions: ActionOverride[] = [];
    for (const [equipmentId, action] of actionOverrides) {
      actions.push({ equipment_id: equipmentId, action });
    }

    if (actions.length === 0) {
      setApplyResult({ applied: 0, skipped: 0 });
      setPhase("complete");
      return;
    }

    setPhase("applying");
    setLoading(true);
    try {
      const data = await postApi<{ applied: number; skipped: number }>(
        "/api/equipment/reconcile/apply",
        { actions }
      );
      setApplyResult(data);
      setPhase("complete");
      success(`Reconciliation complete: ${data.applied} actions applied`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Apply failed");
      setPhase("reviewing");
    } finally {
      setLoading(false);
    }
  }, [actionOverrides, success, showError]);

  // Toggle action for an item
  const toggleAction = useCallback((equipmentId: string, action: ActionOverride["action"]) => {
    setActionOverrides((prev) => {
      const next = new Map(prev);
      if (next.get(equipmentId) === action) {
        next.delete(equipmentId);
      } else {
        next.set(equipmentId, action);
      }
      return next;
    });
  }, []);

  // Categorize results for review
  const needsAction = useMemo(() =>
    results.filter((r) => r.scan_status === "found_here" || r.scan_status === "found" || r.scan_status === "possibly_missing"),
    [results]
  );
  const confirmed = useMemo(() =>
    results.filter((r) => r.scan_status === "confirmed"),
    [results]
  );
  const expectedOut = useMemo(() =>
    results.filter((r) => r.scan_status === "expected_out"),
    [results]
  );
  const stillMissing = useMemo(() =>
    results.filter((r) => r.scan_status === "still_missing"),
    [results]
  );

  const actionCount = actionOverrides.size;

  // Reset
  const handleReset = useCallback(() => {
    setPhase("scanning");
    setScannedBarcodes([]);
    setResults([]);
    setSummary(null);
    setActionOverrides(new Map());
    setApplyResult(null);
  }, []);

  return (
    <div style={{ maxWidth: "900px" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Equipment Restock</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          Physical inventory reconciliation — scan equipment, review discrepancies, apply corrections
        </p>
      </div>

      {/* Phase indicator */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem" }}>
        {(["scanning", "reviewing", "applying", "complete"] as Phase[]).map((p, i) => (
          <div
            key={p}
            style={{
              flex: 1,
              height: "4px",
              borderRadius: "2px",
              background: i <= ["scanning", "reviewing", "applying", "complete"].indexOf(phase)
                ? "var(--primary, #3b82f6)"
                : "var(--border)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {/* ============================================================ */}
      {/* SCANNING PHASE */}
      {/* ============================================================ */}
      {phase === "scanning" && (
        <>
          <BarcodeInput onScan={handleScan} placeholder="Scan barcode to add to inventory check..." />

          {scannedCount > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  {scannedCount} barcode{scannedCount !== 1 ? "s" : ""} scanned
                </span>
                <button
                  onClick={handleReview}
                  disabled={loading}
                  style={{
                    padding: "0.5rem 1.25rem",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    background: "var(--primary, #3b82f6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {loading ? "Comparing..." : "Review Results"}
                </button>
              </div>

              <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.375rem",
                padding: "0.75rem",
                background: "var(--muted-bg, #f3f4f6)",
                borderRadius: "8px",
                maxHeight: "200px",
                overflowY: "auto",
              }}>
                {scannedBarcodes.map((barcode) => (
                  <span
                    key={barcode}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      padding: "0.125rem 0.5rem",
                      fontSize: "0.8rem",
                      fontFamily: "monospace",
                      background: "var(--success-bg)",
                      color: "var(--success-text)",
                      border: "1px solid var(--success-border)",
                      borderRadius: "4px",
                    }}
                  >
                    {barcode}
                    <button
                      onClick={() => removeScan(barcode)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        color: "var(--muted)",
                        padding: "0 0.125rem",
                        lineHeight: 1,
                      }}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {scannedCount === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", marginTop: "3rem", fontSize: "0.85rem" }}>
              <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>|||||||</p>
              <p>Scan each piece of equipment present at the location</p>
              <p style={{ marginTop: "0.25rem" }}>USB scanner or manual barcode entry</p>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/* REVIEWING PHASE */}
      {/* ============================================================ */}
      {phase === "reviewing" && summary && (
        <>
          {/* Summary Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
            <StatCard label="Total Items" value={summary.total_equipment} />
            <StatCard label="Scanned" value={summary.total_scanned} />
            <StatCard label="Confirmed" value={summary.confirmed} valueColor="var(--success-text)" />
            <StatCard label="Needs Action" value={summary.found_here + summary.found + summary.possibly_missing} valueColor="var(--warning-text)" />
            <StatCard label="Expected Out" value={summary.expected_out} />
            {summary.still_missing > 0 && <StatCard label="Still Missing" value={summary.still_missing} valueColor="var(--danger-text)" />}
          </div>

          {/* Unknown barcodes warning */}
          {summary.unknown_barcodes.length > 0 && (
            <div style={{
              padding: "0.75rem 1rem",
              background: "var(--warning-bg)",
              border: "1px solid var(--warning-border)",
              borderRadius: "8px",
              color: "var(--warning-text)",
              fontSize: "0.85rem",
              marginBottom: "1rem",
            }}>
              <strong>{summary.unknown_barcodes.length} unknown barcode{summary.unknown_barcodes.length !== 1 ? "s" : ""}:</strong>{" "}
              {summary.unknown_barcodes.map((b) => (
                <span key={b} style={{ fontFamily: "monospace", marginLeft: "0.5rem" }}>{b}</span>
              ))}
            </div>
          )}

          {/* Section 1: Needs Action */}
          {needsAction.length > 0 && (
            <ResultSection
              title={`Needs Action (${needsAction.length})`}
              items={needsAction}
              actionOverrides={actionOverrides}
              onToggle={toggleAction}
              defaultOpen
            />
          )}

          {/* Section 2: Confirmed */}
          {confirmed.length > 0 && (
            <ResultSection
              title={`Confirmed Present (${confirmed.length})`}
              items={confirmed}
              actionOverrides={actionOverrides}
              onToggle={toggleAction}
              defaultOpen={false}
            />
          )}

          {/* Section 3: Expected Out */}
          {expectedOut.length > 0 && (
            <ResultSection
              title={`Expected Out (${expectedOut.length})`}
              items={expectedOut}
              actionOverrides={actionOverrides}
              onToggle={toggleAction}
              defaultOpen={false}
            />
          )}

          {/* Section 4: Still Missing */}
          {stillMissing.length > 0 && (
            <ResultSection
              title={`Still Missing (${stillMissing.length})`}
              items={stillMissing}
              actionOverrides={actionOverrides}
              onToggle={toggleAction}
              defaultOpen={false}
            />
          )}

          {/* Action bar */}
          <div style={{
            position: "sticky",
            bottom: 0,
            padding: "1rem",
            background: "var(--card-bg, #fff)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1rem",
          }}>
            <button
              onClick={() => setPhase("scanning")}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.9rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Back to Scanning
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                {actionCount} action{actionCount !== 1 ? "s" : ""} to apply
              </span>
              <button
                onClick={handleApply}
                disabled={loading}
                style={{
                  padding: "0.5rem 1.5rem",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  background: actionCount > 0 ? "var(--primary, #3b82f6)" : "var(--border)",
                  color: actionCount > 0 ? "#fff" : "var(--muted)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: actionCount > 0 ? "pointer" : "default",
                }}
              >
                Apply {actionCount} Action{actionCount !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* APPLYING PHASE */}
      {/* ============================================================ */}
      {phase === "applying" && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--muted)" }}>
          <p style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Applying reconciliation...
          </p>
          <p style={{ fontSize: "0.85rem" }}>
            Updating {actionCount} equipment record{actionCount !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* ============================================================ */}
      {/* COMPLETE PHASE */}
      {/* ============================================================ */}
      {phase === "complete" && applyResult && (
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <div style={{
            display: "inline-block",
            padding: "1.5rem 2.5rem",
            background: "var(--success-bg)",
            border: "1px solid var(--success-border)",
            borderRadius: "12px",
            marginBottom: "1.5rem",
          }}>
            <p style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--success-text)", margin: 0 }}>
              Reconciliation Complete
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "2rem", marginTop: "1rem", fontSize: "0.9rem" }}>
              <div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--success-text)" }}>{applyResult.applied}</div>
                <div style={{ color: "var(--muted)" }}>Applied</div>
              </div>
              {summary && (
                <div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{summary.confirmed}</div>
                  <div style={{ color: "var(--muted)" }}>Confirmed</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{applyResult.skipped}</div>
                <div style={{ color: "var(--muted)" }}>Skipped</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem" }}>
            <a
              href="/equipment"
              style={{
                padding: "0.5rem 1.25rem",
                fontSize: "0.9rem",
                fontWeight: 500,
                color: "var(--primary, #3b82f6)",
                textDecoration: "none",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            >
              Back to Inventory
            </a>
            <button
              onClick={handleReset}
              style={{
                padding: "0.5rem 1.25rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                background: "var(--primary, #3b82f6)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              New Restock
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ResultSection — collapsible group of reconcile results
// =============================================================================

function ResultSection({
  title,
  items,
  actionOverrides,
  onToggle,
  defaultOpen,
}: {
  title: string;
  items: EquipmentReconcileResult[];
  actionOverrides: Map<string, ActionOverride["action"]>;
  onToggle: (id: string, action: ActionOverride["action"]) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.5rem 0.75rem",
          fontSize: "0.9rem",
          fontWeight: 600,
          background: "var(--muted-bg, #f3f4f6)",
          border: "1px solid var(--border)",
          borderRadius: open ? "8px 8px 0 0" : "8px",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div style={{
          border: "1px solid var(--border)",
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          overflow: "hidden",
        }}>
          {items.map((item) => (
            <ReconcileRow
              key={item.equipment_id}
              item={item}
              currentAction={actionOverrides.get(item.equipment_id) || null}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ReconcileRow — single equipment item in the reconciliation review
// =============================================================================

function ReconcileRow({
  item,
  currentAction,
  onToggle,
}: {
  item: EquipmentReconcileResult;
  currentAction: ActionOverride["action"] | null;
  onToggle: (id: string, action: ActionOverride["action"]) => void;
}) {
  const scanStyle = getScanResultStyle(item.scan_status);
  const custodyStyle = getCustodyStyle(item.custody_status);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 0.75rem",
        borderBottom: "1px solid var(--border)",
        fontSize: "0.85rem",
      }}
    >
      {/* Scan status badge */}
      <span style={{
        flexShrink: 0,
        padding: "0.125rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: scanStyle.bg,
        color: scanStyle.text,
        border: `1px solid ${scanStyle.border}`,
      }}>
        {item.scan_status.replace(/_/g, " ")}
      </span>

      {/* Barcode */}
      <span style={{ fontFamily: "monospace", fontWeight: 500, minWidth: "50px" }}>
        {item.barcode || "—"}
      </span>

      {/* Name + type */}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.display_name}
        <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.75rem" }}>
          {item.type_display_name || item.legacy_type}
        </span>
      </span>

      {/* DB status badge */}
      <span style={{
        flexShrink: 0,
        padding: "0.125rem 0.375rem",
        borderRadius: "4px",
        fontSize: "0.65rem",
        fontWeight: 500,
        background: custodyStyle.bg,
        color: custodyStyle.text,
      }}>
        {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, item.custody_status)}
      </span>

      {/* Holder info */}
      {(item.custodian_name || item.current_holder_name) && (
        <span style={{ flexShrink: 0, fontSize: "0.75rem", color: "var(--muted)", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.custodian_name || item.current_holder_name}
        </span>
      )}

      {/* Action toggles */}
      {item.suggested_action && (
        <div style={{ flexShrink: 0, display: "flex", gap: "0.25rem" }}>
          <ActionToggle
            label={actionLabel(item.suggested_action)}
            active={currentAction === (item.suggested_action as ActionOverride["action"])}
            onClick={() => onToggle(item.equipment_id, item.suggested_action as ActionOverride["action"])}
          />
        </div>
      )}
    </div>
  );
}

function ActionToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.125rem 0.5rem",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: active ? "var(--primary, #3b82f6)" : "transparent",
        color: active ? "#fff" : "var(--muted)",
        border: `1px solid ${active ? "var(--primary, #3b82f6)" : "var(--border)"}`,
        borderRadius: "4px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function actionLabel(action: string): string {
  switch (action) {
    case "check_in": return "Check In";
    case "mark_missing": return "Mark Missing";
    case "mark_found": return "Mark Found";
    default: return action.replace(/_/g, " ");
  }
}
