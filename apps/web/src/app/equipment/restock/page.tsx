"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getCustodyStyle, getScanResultStyle } from "@/lib/equipment-styles";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS } from "@/lib/form-options";
import type {
  VEquipmentInventoryRow,
  EquipmentReconcileResult,
  EquipmentReconcileSummary,
} from "@/lib/types/view-contracts";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "returns" | "register" | "shelf" | "checkouts" | "reconcile" | "complete";

const PHASES: { key: Phase; label: string; icon: string }[] = [
  { key: "returns", label: "Returns", icon: "log-in" },
  { key: "register", label: "Add New", icon: "plus-circle" },
  { key: "shelf", label: "Shelf Audit", icon: "search" },
  { key: "checkouts", label: "Checkouts", icon: "users" },
  { key: "reconcile", label: "Reconcile", icon: "shield-check" },
];

interface ScannedReturn {
  barcode: string;
  equipment_id: string;
  display_name: string;
  custodian_name: string | null;
  checked_in: boolean;
}

interface RegisteredItem {
  barcode: string;
  equipment_id: string;
  type_label: string;
}

interface CheckoutItem extends VEquipmentInventoryRow {
  confirmed: boolean; // true = legitimately out, false = should check in
  action_taken: "none" | "confirmed" | "checked_in";
}

interface ActionOverride {
  equipment_id: string;
  action: "check_in" | "mark_missing" | "mark_found" | "skip";
}

interface EquipmentTypeOption {
  type_key: string;
  display_name: string;
  category: string;
}

// ── Main Page ──────────────────────────────────────────────────────────────────

interface WizardSavedState {
  phase: Phase;
  returns: ScannedReturn[];
  registered: RegisteredItem[];
  shelfBarcodes: string[];
  checkoutItems: CheckoutItem[];
  checkoutsLoaded: boolean;
  actionOverridesEntries: Array<[string, ActionOverride["action"]]>;
}

const INITIAL_WIZARD_STATE: WizardSavedState = {
  phase: "returns",
  returns: [],
  registered: [],
  shelfBarcodes: [],
  checkoutItems: [],
  checkoutsLoaded: false,
  actionOverridesEntries: [],
};

export default function InventoryDayPage() {
  const { success: toastSuccess, error: toastError } = useToast();

  // Auto-saved wizard state — persists across back-navigation, tab close, page reload
  const [saved, setSaved, clearSaved, wasRestored] = useFormAutoSave<WizardSavedState>(
    "inventory_day_wizard",
    INITIAL_WIZARD_STATE,
  );
  const [showResumed, setShowResumed] = useState(false);

  // If user reloads mid-reconcile, bump them back to "checkouts" — reconcileResults/summary
  // aren't persisted (they're API-derived). "complete" gets storage cleared on entry, so
  // a reload there falls through to a fresh start automatically.
  useEffect(() => {
    if (wasRestored && saved.phase === "reconcile") {
      setSaved((p) => ({ ...p, phase: "checkouts" }));
    }
    if (wasRestored) {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasRestored]);

  // When the wizard reaches "complete", drop the persisted state so a future visit
  // starts fresh. Delay > 500ms so the auto-save's debounced flush of phase=complete
  // happens BEFORE we clear.
  useEffect(() => {
    if (saved.phase === "complete") {
      const t = setTimeout(() => clearSaved(), 600);
      return () => clearTimeout(t);
    }
  }, [saved.phase, clearSaved]);

  // Derived getters
  const phase = saved.phase;
  const returns = saved.returns;
  const registered = saved.registered;
  const shelfBarcodes = saved.shelfBarcodes;
  const checkoutItems = saved.checkoutItems;
  const checkoutsLoaded = saved.checkoutsLoaded;

  // Wrappers matching React.Dispatch<SetStateAction<T>> so child phases don't need to change
  const setPhase = useCallback(
    (next: Phase) => setSaved((p) => ({ ...p, phase: next })),
    [setSaved],
  );
  const setReturns: React.Dispatch<React.SetStateAction<ScannedReturn[]>> = useCallback(
    (action) =>
      setSaved((p) => ({
        ...p,
        returns: typeof action === "function" ? action(p.returns) : action,
      })),
    [setSaved],
  );
  const setRegistered: React.Dispatch<React.SetStateAction<RegisteredItem[]>> = useCallback(
    (action) =>
      setSaved((p) => ({
        ...p,
        registered: typeof action === "function" ? action(p.registered) : action,
      })),
    [setSaved],
  );
  const setShelfBarcodes: React.Dispatch<React.SetStateAction<string[]>> = useCallback(
    (action) =>
      setSaved((p) => ({
        ...p,
        shelfBarcodes: typeof action === "function" ? action(p.shelfBarcodes) : action,
      })),
    [setSaved],
  );
  const setCheckoutItems: React.Dispatch<React.SetStateAction<CheckoutItem[]>> = useCallback(
    (action) =>
      setSaved((p) => ({
        ...p,
        checkoutItems: typeof action === "function" ? action(p.checkoutItems) : action,
      })),
    [setSaved],
  );
  const setCheckoutsLoaded: React.Dispatch<React.SetStateAction<boolean>> = useCallback(
    (action) =>
      setSaved((p) => ({
        ...p,
        checkoutsLoaded: typeof action === "function" ? action(p.checkoutsLoaded) : action,
      })),
    [setSaved],
  );

  // Phase 5: Reconcile — derive Map from persisted entries
  const [reconcileResults, setReconcileResults] = useState<EquipmentReconcileResult[]>([]);
  const [reconcileSummary, setReconcileSummary] = useState<EquipmentReconcileSummary | null>(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  const actionOverrides = useMemo(
    () => new Map<string, ActionOverride["action"]>(saved.actionOverridesEntries),
    [saved.actionOverridesEntries],
  );
  const setActionOverrides: React.Dispatch<
    React.SetStateAction<Map<string, ActionOverride["action"]>>
  > = useCallback(
    (action) => {
      setSaved((p) => {
        const prevMap = new Map<string, ActionOverride["action"]>(p.actionOverridesEntries);
        const nextMap = typeof action === "function" ? action(prevMap) : action;
        return { ...p, actionOverridesEntries: Array.from(nextMap.entries()) };
      });
    },
    [setSaved],
  );

  // Complete
  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);

  // Reset everything back to step 1 — used by "Start Over" buttons
  const handleRestart = useCallback(() => {
    setSaved({ ...INITIAL_WIZARD_STATE });
    setReconcileResults([]);
    setReconcileSummary(null);
    setReconcileLoading(false);
    setApplyResult(null);
    // Clear sessionStorage after the pending save has had a chance to flush
    setTimeout(() => clearSaved(), 600);
  }, [setSaved, clearSaved]);

  // All confirmed-present barcodes (from returns + registered + shelf)
  const allConfirmedBarcodes = useMemo(() => {
    const set = new Set<string>();
    for (const r of returns) if (r.checked_in) set.add(r.barcode);
    for (const r of registered) set.add(r.barcode);
    for (const b of shelfBarcodes) set.add(b);
    return set;
  }, [returns, registered, shelfBarcodes]);

  const phaseIndex = PHASES.findIndex((p) => p.key === phase);

  return (
    <div style={{ maxWidth: 900, padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
          }}
        >
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
              <Icon name="clipboard-check" size={22} color="var(--primary)" /> Inventory Day
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Ground-truth your equipment. Returns → Register new → Shelf audit → Review checkouts → Reconcile.
            </p>
          </div>
          {phase !== "returns" && phase !== "complete" && (
            <Button
              variant="ghost"
              size="sm"
              icon="rotate-ccw"
              onClick={() => {
                if (
                  confirm(
                    "Start over? All scanned items and decisions will be discarded.",
                  )
                ) {
                  handleRestart();
                }
              }}
            >
              Start Over
            </Button>
          )}
        </div>
        {showResumed && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.625rem 0.875rem",
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
              borderRadius: 8,
              fontSize: "0.85rem",
              color: "var(--info-text)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <Icon name="rotate-ccw" size={14} color="var(--info-text)" />
            Resumed previous session — your scans and progress have been restored.
          </div>
        )}
      </div>

      {/* Phase nav */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem" }}>
        {PHASES.map((p, i) => {
          const isCurrent = p.key === phase;
          const isPast = i < phaseIndex;
          const isComplete = phase === "complete";
          return (
            <button
              key={p.key}
              onClick={() => {
                if (isPast && !isComplete) setPhase(p.key);
              }}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.375rem",
                padding: "0.5rem 0.25rem",
                fontSize: "0.7rem",
                fontWeight: isCurrent ? 700 : 500,
                background: isCurrent
                  ? "var(--primary)"
                  : isPast || isComplete
                    ? "var(--success-bg)"
                    : "var(--muted-bg, #f3f4f6)",
                color: isCurrent ? "#fff" : isPast || isComplete ? "var(--success-text)" : "var(--muted)",
                border: "none",
                borderRadius: i === 0 ? "8px 0 0 8px" : i === PHASES.length - 1 ? "0 8px 8px 0" : 0,
                cursor: isPast && !isComplete ? "pointer" : "default",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              <Icon name={isPast || isComplete ? "check" : p.icon} size={12} color={isCurrent ? "#fff" : undefined} />
              {p.label}
            </button>
          );
        })}
      </div>

      {/* ── Phase 1: Returns ──────────────────────────────────────────── */}
      {phase === "returns" && (
        <ReturnsPhase
          returns={returns}
          setReturns={setReturns}
          onNext={() => setPhase("register")}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}

      {/* ── Phase 2: Register New ─────────────────────────────────────── */}
      {phase === "register" && (
        <RegisterPhase
          registered={registered}
          setRegistered={setRegistered}
          onNext={() => setPhase("shelf")}
          onBack={() => setPhase("returns")}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}

      {/* ── Phase 3: Shelf Audit ──────────────────────────────────────── */}
      {phase === "shelf" && (
        <ShelfPhase
          shelfBarcodes={shelfBarcodes}
          setShelfBarcodes={setShelfBarcodes}
          onNext={() => setPhase("checkouts")}
          onBack={() => setPhase("register")}
        />
      )}

      {/* ── Phase 4: Checkout Review ──────────────────────────────────── */}
      {phase === "checkouts" && (
        <CheckoutsPhase
          checkoutItems={checkoutItems}
          setCheckoutItems={setCheckoutItems}
          loaded={checkoutsLoaded}
          setLoaded={setCheckoutsLoaded}
          onNext={async () => {
            // Run reconciliation with all confirmed barcodes
            setPhase("reconcile");
            setReconcileLoading(true);
            try {
              const barcodes = Array.from(allConfirmedBarcodes);
              if (barcodes.length === 0) {
                // Even with 0 scans, we can reconcile to find all missing
                // Use a dummy call that will mark everything as possibly_missing
                barcodes.push("__dummy_no_match__");
              }
              const data = await postApi<{ results: EquipmentReconcileResult[]; summary: EquipmentReconcileSummary }>(
                "/api/equipment/reconcile",
                { scanned_barcodes: barcodes },
              );
              setReconcileResults(data.results);
              setReconcileSummary(data.summary);
              // Pre-fill suggested actions
              const overrides = new Map<string, ActionOverride["action"]>();
              for (const r of data.results) {
                if (r.suggested_action) {
                  overrides.set(r.equipment_id, r.suggested_action as ActionOverride["action"]);
                }
              }
              setActionOverrides(overrides);
            } catch (err) {
              toastError(err instanceof Error ? err.message : "Reconciliation failed");
              setPhase("checkouts");
            } finally {
              setReconcileLoading(false);
            }
          }}
          onBack={() => setPhase("shelf")}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}

      {/* ── Phase 5: Reconcile ────────────────────────────────────────── */}
      {phase === "reconcile" && (
        <ReconcilePhase
          results={reconcileResults}
          summary={reconcileSummary}
          loading={reconcileLoading}
          actionOverrides={actionOverrides}
          setActionOverrides={setActionOverrides}
          onApply={async () => {
            const actions: ActionOverride[] = [];
            for (const [equipmentId, action] of actionOverrides) {
              actions.push({ equipment_id: equipmentId, action });
            }
            const toApply = actions.filter((a) => a.action !== "skip");
            if (toApply.length === 0) {
              setApplyResult({ applied: 0, skipped: actions.length });
              setPhase("complete");
              return;
            }
            try {
              const data = await postApi<{ applied: number; skipped: number }>(
                "/api/equipment/reconcile/apply",
                { actions: toApply },
              );
              setApplyResult(data);
              setPhase("complete");
              toastSuccess(`Reconciliation complete: ${data.applied} actions applied`);
            } catch (err) {
              toastError(err instanceof Error ? err.message : "Apply failed");
            }
          }}
          onBack={() => setPhase("checkouts")}
        />
      )}

      {/* ── Complete ──────────────────────────────────────────────────── */}
      {phase === "complete" && (
        <CompletePhase
          applyResult={applyResult}
          summary={reconcileSummary}
          returnsCount={returns.filter((r) => r.checked_in).length}
          registeredCount={registered.length}
          shelfCount={shelfBarcodes.length}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: Returns — Bulk check-in
// ═══════════════════════════════════════════════════════════════════════════════

function ReturnsPhase({
  returns: items,
  setReturns,
  onNext,
  toastSuccess,
  toastError,
}: {
  returns: ScannedReturn[];
  setReturns: React.Dispatch<React.SetStateAction<ScannedReturn[]>>;
  onNext: () => void;
  toastSuccess: (msg: string) => void;
  toastError: (msg: string) => void;
}) {
  const [scanning, setScanning] = useState(false);

  const handleScan = useCallback(
    async (barcode: string) => {
      if (items.some((r) => r.barcode === barcode)) {
        toastError(`${barcode} already scanned`);
        return;
      }
      setScanning(true);
      try {
        const data = await fetchApi<VEquipmentInventoryRow & { available_actions: string[] }>(
          `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`,
        );
        if (data.custody_status !== "checked_out") {
          toastError(`${barcode} is ${data.custody_status}, not checked out`);
          setScanning(false);
          return;
        }
        // Check it in
        await postApi(`/api/equipment/${data.equipment_id}/events`, {
          event_type: "check_in",
          notes: "Inventory Day bulk return",
        });
        setReturns((prev) => [
          ...prev,
          {
            barcode,
            equipment_id: data.equipment_id,
            display_name: data.display_name,
            custodian_name: data.custodian_name || data.current_holder_name,
            checked_in: true,
          },
        ]);
        toastSuccess(`Checked in ${data.display_name}`);
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Scan failed");
      } finally {
        setScanning(false);
      }
    },
    [items, setReturns, toastSuccess, toastError],
  );

  return (
    <div>
      <SectionHeader
        icon="log-in"
        title="Step 1: Check In Returns"
        description="Scan each trap being returned. They'll be checked in immediately."
      />
      <BarcodeInput onScan={handleScan} loading={scanning} placeholder="Scan returning trap barcode..." autoFocus />

      {items.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {items.length} trap{items.length !== 1 ? "s" : ""} returned
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {items.map((item) => (
              <div
                key={item.barcode}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  background: "var(--success-bg)",
                  border: "1px solid var(--success-border)",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                }}
              >
                <Icon name="check-circle" size={16} color="var(--success-text)" />
                <code style={{ fontWeight: 600 }}>{item.barcode}</code>
                <span style={{ flex: 1 }}>{item.display_name}</span>
                {item.custodian_name && (
                  <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                    was with {item.custodian_name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <PhaseFooter
        onNext={onNext}
        nextLabel={`Next: Add New Equipment${items.length > 0 ? ` (${items.length} returned)` : ""}`}
        skipLabel="Skip — no returns today"
        onSkip={onNext}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Register New Equipment
// ═══════════════════════════════════════════════════════════════════════════════

function RegisterPhase({
  registered,
  setRegistered,
  onNext,
  onBack,
  toastSuccess,
  toastError,
}: {
  registered: RegisteredItem[];
  setRegistered: React.Dispatch<React.SetStateAction<RegisteredItem[]>>;
  onNext: () => void;
  onBack: () => void;
  toastSuccess: (msg: string) => void;
  toastError: (msg: string) => void;
}) {
  const [types, setTypes] = useState<EquipmentTypeOption[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [barcode, setBarcode] = useState("");
  const [condition, setCondition] = useState("good");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchApi<{ types: EquipmentTypeOption[] }>("/api/equipment/types")
      .then((data) => setTypes(data.types || []))
      .catch(() => {});
  }, []);

  const handleAdd = useCallback(async () => {
    if (!selectedType) {
      toastError("Select an equipment type");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        equipment_type_key: selectedType,
        condition_status: condition,
        notes: "Added during Inventory Day — pre-existing equipment without barcode",
      };
      if (barcode.trim()) {
        payload.barcode = barcode.trim();
      }
      const data = await postApi<{ equipment_id: string }>("/api/equipment", payload);
      const typeLabel = types.find((t) => t.type_key === selectedType)?.display_name || selectedType;
      const finalBarcode = barcode.trim() || data.equipment_id.slice(0, 8);
      setRegistered((prev) => [...prev, { barcode: finalBarcode, equipment_id: data.equipment_id, type_label: typeLabel }]);
      toastSuccess(`Added ${typeLabel}`);
      setBarcode("");
      setSelectedType("");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }, [selectedType, barcode, condition, types, setRegistered, toastSuccess, toastError]);

  const trapTypes = types.filter((t) => t.category === "trap");
  const otherTypes = types.filter((t) => t.category !== "trap");

  return (
    <div>
      <SectionHeader
        icon="plus-circle"
        title="Step 2: Register New Equipment"
        description="Add traps that exist physically but aren't in the system (no barcode, pre-existing)."
      />

      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={labelStyle}>Equipment Type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={selectStyle}
            >
              <option value="">Select type...</option>
              <optgroup label="Traps">
                {trapTypes.map((t) => (
                  <option key={t.type_key} value={t.type_key}>{t.display_name}</option>
                ))}
              </optgroup>
              <optgroup label="Other">
                {otherTypes.map((t) => (
                  <option key={t.type_key} value={t.type_key}>{t.display_name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>Barcode (optional)</label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Leave blank to auto-assign"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Condition</label>
              <select value={condition} onChange={(e) => setCondition(e.target.value)} style={selectStyle}>
                <option value="new">New</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
              </select>
            </div>
          </div>

          <Button variant="primary" onClick={handleAdd} loading={saving} disabled={!selectedType}>
            Add Equipment
          </Button>
        </div>
      </div>

      {registered.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {registered.length} item{registered.length !== 1 ? "s" : ""} added
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
            {registered.map((item) => (
              <span
                key={item.equipment_id}
                style={{
                  padding: "0.25rem 0.625rem",
                  background: "var(--info-bg)",
                  border: "1px solid var(--info-border)",
                  borderRadius: 6,
                  fontSize: "0.8rem",
                  color: "var(--info-text)",
                }}
              >
                {item.type_label} {item.barcode && `(${item.barcode})`}
              </span>
            ))}
          </div>
        </div>
      )}

      <PhaseFooter
        onNext={onNext}
        onBack={onBack}
        nextLabel={`Next: Shelf Audit${registered.length > 0 ? ` (${registered.length} added)` : ""}`}
        skipLabel="Skip — nothing to add"
        onSkip={onNext}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3: Shelf Audit — Confirm what's physically on the shelf
// ═══════════════════════════════════════════════════════════════════════════════

function ShelfPhase({
  shelfBarcodes,
  setShelfBarcodes,
  onNext,
  onBack,
}: {
  shelfBarcodes: string[];
  setShelfBarcodes: React.Dispatch<React.SetStateAction<string[]>>;
  onNext: () => void;
  onBack: () => void;
}) {
  const handleScan = useCallback(
    (barcode: string) => {
      setShelfBarcodes((prev) => {
        if (prev.includes(barcode)) return prev;
        return [...prev, barcode];
      });
    },
    [setShelfBarcodes],
  );

  const removeScan = useCallback(
    (barcode: string) => {
      setShelfBarcodes((prev) => prev.filter((b) => b !== barcode));
    },
    [setShelfBarcodes],
  );

  return (
    <div>
      <SectionHeader
        icon="search"
        title="Step 3: Shelf Audit"
        description="Scan every piece of equipment physically on the shelf right now. This confirms what's actually here."
      />
      <BarcodeInput onScan={handleScan} placeholder="Scan each trap on the shelf..." autoFocus />

      {shelfBarcodes.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {shelfBarcodes.length} item{shelfBarcodes.length !== 1 ? "s" : ""} confirmed on shelf
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.375rem",
              padding: "0.75rem",
              background: "var(--muted-bg, #f3f4f6)",
              borderRadius: 8,
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {shelfBarcodes.map((barcode) => (
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
                  borderRadius: 4,
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

      <PhaseFooter
        onNext={onNext}
        onBack={onBack}
        nextLabel={`Next: Review Checkouts (${shelfBarcodes.length} on shelf)`}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4: Checkout Review — Confirm legitimate checkouts
// ═══════════════════════════════════════════════════════════════════════════════

function CheckoutsPhase({
  checkoutItems,
  setCheckoutItems,
  loaded,
  setLoaded,
  onNext,
  onBack,
  toastSuccess,
  toastError,
}: {
  checkoutItems: CheckoutItem[];
  setCheckoutItems: React.Dispatch<React.SetStateAction<CheckoutItem[]>>;
  loaded: boolean;
  setLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  onNext: () => void;
  onBack: () => void;
  toastSuccess: (msg: string) => void;
  toastError: (msg: string) => void;
}) {
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) return;
    fetchApi<{ equipment: VEquipmentInventoryRow[] }>("/api/equipment?custody_status=checked_out&limit=250")
      .then((data) => {
        setCheckoutItems(
          (data.equipment || []).map((e) => ({
            ...e,
            confirmed: false,
            action_taken: "none" as const,
          })),
        );
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loaded, setCheckoutItems, setLoaded]);

  const handleConfirm = useCallback(
    (equipmentId: string) => {
      setCheckoutItems((prev) =>
        prev.map((item) =>
          item.equipment_id === equipmentId
            ? { ...item, confirmed: true, action_taken: "confirmed" as const }
            : item,
        ),
      );
    },
    [setCheckoutItems],
  );

  const handleCheckIn = useCallback(
    async (equipmentId: string) => {
      setCheckingIn(equipmentId);
      try {
        await postApi(`/api/equipment/${equipmentId}/events`, {
          event_type: "check_in",
          notes: "Inventory Day — found on premises during checkout review",
        });
        setCheckoutItems((prev) =>
          prev.map((item) =>
            item.equipment_id === equipmentId
              ? { ...item, confirmed: false, action_taken: "checked_in" as const, custody_status: "available" }
              : item,
          ),
        );
        toastSuccess("Checked in");
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Check-in failed");
      } finally {
        setCheckingIn(null);
      }
    },
    [setCheckoutItems, toastSuccess, toastError],
  );

  const pendingCount = checkoutItems.filter((i) => i.action_taken === "none").length;
  const confirmedCount = checkoutItems.filter((i) => i.action_taken === "confirmed").length;
  const checkedInCount = checkoutItems.filter((i) => i.action_taken === "checked_in").length;

  return (
    <div>
      <SectionHeader
        icon="users"
        title="Step 4: Review Checkouts"
        description="These items are marked as checked out. Confirm who actually has what, or check in anything that's actually here."
      />

      {!loaded ? (
        <div style={{ color: "var(--muted)", padding: "2rem 0", textAlign: "center" }}>Loading checked-out items...</div>
      ) : checkoutItems.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: "2rem 0", textAlign: "center" }}>
          No items currently checked out.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <StatCard label="Checked Out" value={checkoutItems.length} />
            <StatCard label="Confirmed" value={confirmedCount} valueColor="var(--success-text)" />
            <StatCard label="Checked In" value={checkedInCount} valueColor="var(--info-text)" />
            <StatCard label="Pending" value={pendingCount} valueColor={pendingCount > 0 ? "var(--warning-text)" : undefined} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {checkoutItems.map((item) => (
              <div
                key={item.equipment_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  background: item.action_taken === "checked_in" ? "var(--info-bg)" : item.action_taken === "confirmed" ? "var(--success-bg)" : "var(--card-bg)",
                  border: `1px solid ${item.action_taken === "checked_in" ? "var(--info-border)" : item.action_taken === "confirmed" ? "var(--success-border)" : "var(--card-border)"}`,
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  opacity: item.action_taken !== "none" ? 0.7 : 1,
                }}
              >
                <code style={{ fontWeight: 600, minWidth: 50 }}>{item.barcode || "—"}</code>
                <span style={{ flex: 1, fontWeight: 500 }}>{item.display_name}</span>
                <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.custodian_name || item.current_holder_name || "Unknown"}
                </span>
                {item.days_checked_out != null && (
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{item.days_checked_out}d</span>
                )}

                {item.action_taken === "none" && (
                  <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                    <Button variant="outline" size="sm" onClick={() => handleConfirm(item.equipment_id)}>
                      Legit
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={checkingIn === item.equipment_id}
                      onClick={() => handleCheckIn(item.equipment_id)}
                    >
                      Here
                    </Button>
                  </div>
                )}
                {item.action_taken === "confirmed" && (
                  <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--success-text)" }}>CONFIRMED OUT</span>
                )}
                {item.action_taken === "checked_in" && (
                  <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--info-text)" }}>CHECKED IN</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <PhaseFooter
        onNext={onNext}
        onBack={onBack}
        nextLabel="Next: Reconcile Everything"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 5: Reconcile — Flag unconfirmed items
// ═══════════════════════════════════════════════════════════════════════════════

function ReconcilePhase({
  results,
  summary,
  loading,
  actionOverrides,
  setActionOverrides,
  onApply,
  onBack,
}: {
  results: EquipmentReconcileResult[];
  summary: EquipmentReconcileSummary | null;
  loading: boolean;
  actionOverrides: Map<string, ActionOverride["action"]>;
  setActionOverrides: React.Dispatch<React.SetStateAction<Map<string, ActionOverride["action"]>>>;
  onApply: () => void;
  onBack: () => void;
}) {
  const toggleAction = useCallback(
    (equipmentId: string, action: ActionOverride["action"]) => {
      setActionOverrides((prev) => {
        const next = new Map(prev);
        if (next.get(equipmentId) === action) {
          next.delete(equipmentId);
        } else {
          next.set(equipmentId, action);
        }
        return next;
      });
    },
    [setActionOverrides],
  );

  const possiblyMissing = useMemo(() => results.filter((r) => r.scan_status === "possibly_missing"), [results]);
  const stillMissing = useMemo(() => results.filter((r) => r.scan_status === "still_missing"), [results]);
  const confirmed = useMemo(() => results.filter((r) => r.scan_status === "confirmed"), [results]);
  const expectedOut = useMemo(() => results.filter((r) => r.scan_status === "expected_out"), [results]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
        <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>Running reconciliation...</p>
        <p style={{ fontSize: "0.85rem" }}>Comparing confirmed items against full inventory</p>
      </div>
    );
  }

  const actionCount = actionOverrides.size;

  return (
    <div>
      <SectionHeader
        icon="shield-check"
        title="Step 5: Reconcile"
        description="Items marked 'available' but not physically confirmed are flagged. Review and decide what to do."
      />

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
          <StatCard label="Total" value={summary.total_equipment} />
          <StatCard label="Confirmed" value={summary.confirmed} valueColor="var(--success-text)" />
          <StatCard label="Expected Out" value={summary.expected_out} />
          <StatCard label="Suspicious" value={summary.possibly_missing} valueColor={summary.possibly_missing > 0 ? "var(--warning-text)" : undefined} />
          <StatCard label="Missing" value={summary.still_missing} valueColor={summary.still_missing > 0 ? "var(--danger-text)" : undefined} />
        </div>
      )}

      {/* Possibly missing — the key section */}
      {possiblyMissing.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.5rem", color: "var(--warning-text)" }}>
            <Icon name="alert-triangle" size={16} color="var(--warning-text)" /> Possibly Missing ({possiblyMissing.length})
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.5rem" }}>
            These items say &quot;available&quot; but weren&apos;t found on the shelf. Last holder info shown when available.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {possiblyMissing.map((item) => (
              <ReconcileRow
                key={item.equipment_id}
                item={item}
                currentAction={actionOverrides.get(item.equipment_id) || null}
                onToggle={toggleAction}
              />
            ))}
          </div>
        </div>
      )}

      {/* Still missing */}
      {stillMissing.length > 0 && (
        <CollapsibleSection title={`Still Missing (${stillMissing.length})`} defaultOpen={false}>
          {stillMissing.map((item) => (
            <ReconcileRow key={item.equipment_id} item={item} currentAction={actionOverrides.get(item.equipment_id) || null} onToggle={toggleAction} />
          ))}
        </CollapsibleSection>
      )}

      {/* Confirmed */}
      {confirmed.length > 0 && (
        <CollapsibleSection title={`Confirmed Present (${confirmed.length})`} defaultOpen={false}>
          {confirmed.map((item) => (
            <ReconcileRow key={item.equipment_id} item={item} currentAction={null} onToggle={toggleAction} />
          ))}
        </CollapsibleSection>
      )}

      {/* Expected out */}
      {expectedOut.length > 0 && (
        <CollapsibleSection title={`Expected Out (${expectedOut.length})`} defaultOpen={false}>
          {expectedOut.map((item) => (
            <ReconcileRow key={item.equipment_id} item={item} currentAction={null} onToggle={toggleAction} />
          ))}
        </CollapsibleSection>
      )}

      {possiblyMissing.length === 0 && stillMissing.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--success-text)", background: "var(--success-bg)", borderRadius: 12, marginBottom: "1rem" }}>
          <Icon name="check-circle" size={32} color="var(--success-text)" />
          <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0.5rem 0 0" }}>All clear!</p>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0.25rem 0 0" }}>Every item is accounted for.</p>
        </div>
      )}

      {/* Action bar */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "1rem 0",
          background: "var(--bg, #fff)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "1rem",
        }}
      >
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            {actionCount} action{actionCount !== 1 ? "s" : ""}
          </span>
          <Button variant="primary" onClick={onApply}>
            {actionCount > 0 ? `Apply ${actionCount} Action${actionCount !== 1 ? "s" : ""} & Finish` : "Finish"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6: Complete
// ═══════════════════════════════════════════════════════════════════════════════

function CompletePhase({
  applyResult,
  summary,
  returnsCount,
  registeredCount,
  shelfCount,
  onRestart,
}: {
  applyResult: { applied: number; skipped: number } | null;
  summary: EquipmentReconcileSummary | null;
  returnsCount: number;
  registeredCount: number;
  shelfCount: number;
  onRestart: () => void;
}) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
      <div
        style={{
          display: "inline-block",
          padding: "1.5rem 2.5rem",
          background: "var(--success-bg)",
          border: "1px solid var(--success-border)",
          borderRadius: 16,
          marginBottom: "1.5rem",
        }}
      >
        <Icon name="check-circle" size={40} color="var(--success-text)" />
        <p style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--success-text)", margin: "0.5rem 0 0" }}>
          Inventory Day Complete
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.5rem", maxWidth: 600, margin: "0 auto 1.5rem" }}>
        <StatCard label="Returned" value={returnsCount} valueColor="var(--success-text)" />
        <StatCard label="Registered" value={registeredCount} valueColor="var(--info-text)" />
        <StatCard label="Shelf Confirmed" value={shelfCount} valueColor="var(--success-text)" />
        {applyResult && <StatCard label="Actions Applied" value={applyResult.applied} valueColor="var(--primary)" />}
        {summary && <StatCard label="Total Inventory" value={summary.total_equipment} />}
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem" }}>
        <a
          href="/kiosk/equipment/inventory"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.5rem 1.25rem",
            fontSize: "0.9rem",
            fontWeight: 500,
            color: "var(--primary)",
            textDecoration: "none",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          View Inventory
        </a>
        <Button variant="primary" onClick={onRestart}>
          New Inventory Day
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════════════

function SectionHeader({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Icon name={icon} size={20} color="var(--primary)" />
        {title}
      </h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>{description}</p>
    </div>
  );
}

function PhaseFooter({
  onNext,
  onBack,
  nextLabel,
  skipLabel,
  onSkip,
}: {
  onNext: () => void;
  onBack?: () => void;
  nextLabel: string;
  skipLabel?: string;
  onSkip?: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>Back</Button>
      ) : (
        <div />
      )}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {skipLabel && onSkip && (
          <Button variant="ghost" size="sm" onClick={onSkip}>{skipLabel}</Button>
        )}
        <Button variant="primary" onClick={onNext}>{nextLabel}</Button>
      </div>
    </div>
  );
}

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
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: 8,
        fontSize: "0.85rem",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          padding: "0.125rem 0.5rem",
          borderRadius: 4,
          fontSize: "0.65rem",
          fontWeight: 600,
          background: scanStyle.bg,
          color: scanStyle.text,
          border: `1px solid ${scanStyle.border}`,
          textTransform: "uppercase",
        }}
      >
        {item.scan_status.replace(/_/g, " ")}
      </span>

      <code style={{ fontWeight: 600, minWidth: 45, fontSize: "0.8rem" }}>{item.barcode || "—"}</code>

      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
        {item.display_name}
        <span style={{ color: "var(--muted)", marginLeft: "0.375rem", fontSize: "0.75rem", fontWeight: 400 }}>
          {item.type_display_name || item.legacy_type}
        </span>
      </span>

      <span
        style={{
          flexShrink: 0,
          padding: "0.125rem 0.375rem",
          borderRadius: 4,
          fontSize: "0.6rem",
          fontWeight: 500,
          background: custodyStyle.bg,
          color: custodyStyle.text,
        }}
      >
        {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, item.custody_status)}
      </span>

      {/* Last holder info — key for ghost hunt */}
      {item.last_holder_name && (item.scan_status === "possibly_missing" || item.scan_status === "still_missing") && (
        <span
          style={{
            flexShrink: 0,
            fontSize: "0.75rem",
            color: "var(--warning-text)",
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 500,
          }}
          title={`Last: ${item.last_holder_name} (${item.last_event_type} on ${item.last_holder_date ? new Date(item.last_holder_date).toLocaleDateString() : "?"})`}
        >
          Last: {item.last_holder_name}
        </span>
      )}

      {/* Current holder for expected_out */}
      {(item.custodian_name || item.current_holder_name) && item.scan_status === "expected_out" && (
        <span style={{ flexShrink: 0, fontSize: "0.75rem", color: "var(--muted)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.custodian_name || item.current_holder_name}
        </span>
      )}

      {/* Action buttons */}
      {item.suggested_action && (
        <div style={{ flexShrink: 0, display: "flex", gap: "0.25rem" }}>
          {item.scan_status === "possibly_missing" && (
            <>
              <ActionButton
                label="Missing"
                active={currentAction === "mark_missing"}
                variant="danger"
                onClick={() => onToggle(item.equipment_id, "mark_missing")}
              />
              <ActionButton
                label="Skip"
                active={currentAction === "skip"}
                variant="ghost"
                onClick={() => onToggle(item.equipment_id, "skip")}
              />
            </>
          )}
          {item.scan_status === "found_here" && (
            <ActionButton
              label="Check In"
              active={currentAction === "check_in"}
              variant="success"
              onClick={() => onToggle(item.equipment_id, "check_in")}
            />
          )}
          {item.scan_status === "found" && (
            <ActionButton
              label="Found"
              active={currentAction === "mark_found"}
              variant="success"
              onClick={() => onToggle(item.equipment_id, "mark_found")}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  active,
  variant,
  onClick,
}: {
  label: string;
  active: boolean;
  variant: "danger" | "success" | "ghost";
  onClick: () => void;
}) {
  const colors = {
    danger: { bg: "var(--danger-bg)", text: "var(--danger-text)", border: "var(--danger-border)" },
    success: { bg: "var(--success-bg)", text: "var(--success-text)", border: "var(--success-border)" },
    ghost: { bg: "var(--muted-bg, #f3f4f6)", text: "var(--muted)", border: "var(--border)" },
  };
  const c = colors[variant];

  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.125rem 0.5rem",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: active ? c.bg : "transparent",
        color: active ? c.text : "var(--muted)",
        border: `1px solid ${active ? c.border : "var(--border)"}`,
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
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
          fontSize: "0.85rem",
          fontWeight: 600,
          background: "var(--muted-bg, #f3f4f6)",
          border: "1px solid var(--border)",
          borderRadius: open ? "8px 8px 0 0" : 8,
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color="var(--muted)" />
      </button>
      {open && (
        <div style={{ border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Shared Styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "0.25rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--card-border)",
  borderRadius: 8,
  fontSize: "0.85rem",
  background: "var(--card-bg)",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "auto",
};
