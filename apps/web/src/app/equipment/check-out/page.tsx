"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { TabBar } from "@/components/ui/TabBar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { KioskPersonAutosuggest, type PersonReference } from "@/components/kiosk/KioskPersonAutosuggest";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

type Tab = "cage" | "trap";

const EMPTY_PERSON: PersonReference = { person_id: null, display_name: "", is_resolved: false };

export default function EquipmentCheckOutPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("cage");
  const [equipment, setEquipment] = useState<VEquipmentInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Track which items were just checked out this session
  const [checkedOutIds, setCheckedOutIds] = useState<Set<string>>(new Set());
  // Per-item checkout state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [custodian, setCustodian] = useState<PersonReference>(EMPTY_PERSON);
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadEquipment = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ equipment: VEquipmentInventoryRow[] }>(
        "/api/equipment?limit=500&custody_status=available"
      );
      setEquipment(data.equipment || []);
    } catch {
      toast.error("Failed to load equipment");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadEquipment();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheckOut = async (item: VEquipmentInventoryRow) => {
    if (!custodian.display_name.trim()) {
      toast.error("Enter who is taking this equipment");
      return;
    }
    setProcessingId(item.equipment_id);
    try {
      await postApi(`/api/equipment/${item.equipment_id}/events`, {
        event_type: "check_out",
        custodian_person_id: custodian.person_id || undefined,
        custodian_name: custodian.display_name.trim(),
        custodian_name_raw: custodian.display_name.trim(),
        notes: checkoutNotes.trim() || undefined,
      });
      setCheckedOutIds((prev) => new Set(prev).add(item.equipment_id));
      toast.success(`${item.display_name} → ${custodian.display_name.trim()}`);
      // Keep custodian for batch checkouts to same person
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-out failed");
    } finally {
      setProcessingId(null);
    }
  };

  // Filter by tab
  const filtered = equipment.filter((e) => {
    if (tab === "cage") return e.type_category === "cage";
    return e.type_category === "trap";
  });

  // Sort: non-checked-out first, then by barcode
  const sorted = [...filtered].sort((a, b) => {
    const aDone = checkedOutIds.has(a.equipment_id) ? 1 : 0;
    const bDone = checkedOutIds.has(b.equipment_id) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (a.barcode || "").localeCompare(b.barcode || "");
  });

  const cageCount = equipment.filter((e) => e.type_category === "cage").length;
  const trapCount = equipment.filter((e) => e.type_category === "trap").length;

  return (
    <div style={{ maxWidth: 700, padding: "0 1rem" }}>
      <Breadcrumbs
        items={[
          { label: "Equipment", href: "/equipment" },
          { label: "Check Out" },
        ]}
      />

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "1rem 0 0.25rem" }}>
        Check Out Equipment
      </h1>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
        Select available items to check out. The person field stays filled for batch checkouts.
      </p>

      {/* Custodian picker — sticky at top for batch mode */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--background, #fff)",
          padding: "0.75rem 0",
          borderBottom: "1px solid var(--card-border)",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <KioskPersonAutosuggest
              value={custodian}
              onChange={setCustodian}
              placeholder="Who is taking equipment?"
              label="Check out to"
            />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 4,
              }}
            >
              Notes <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
            </label>
            <input
              type="text"
              value={checkoutNotes}
              onChange={(e) => setCheckoutNotes(e.target.value)}
              placeholder="e.g. Paper form filled, transport to clinic"
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: 8,
                border: "1px solid var(--card-border)",
                background: "var(--background, #fff)",
                fontSize: "0.85rem",
                fontFamily: "inherit",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        {custodian.display_name.trim() && (
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 6 }}>
            Tap <strong>Check Out</strong> on each item below to assign to{" "}
            <strong>{custodian.display_name.trim()}</strong>
            {custodian.person_id && (
              <span style={{ color: "var(--success-text)" }}> (linked)</span>
            )}
          </div>
        )}
      </div>

      <TabBar
        tabs={[
          { id: "cage", label: "Transfer Cages", count: cageCount },
          { id: "trap", label: "Traps", count: trapCount },
        ]}
        activeTab={tab}
        onTabChange={(id) => setTab(id as Tab)}
      />

      <div style={{ marginTop: "0.75rem" }}>
        {loading ? (
          <SkeletonList items={4} />
        ) : sorted.length === 0 ? (
          <EmptyState
            variant="default"
            title={`No ${tab === "cage" ? "cages" : "traps"} available`}
            description="All items are currently checked out or assigned."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sorted.map((item) => {
              const isDone = checkedOutIds.has(item.equipment_id);
              const isProcessing = processingId === item.equipment_id;

              return (
                <div
                  key={item.equipment_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    border: `1px solid ${isDone ? "var(--warning-border)" : "var(--card-border)"}`,
                    borderRadius: 10,
                    background: isDone ? "var(--warning-bg)" : "var(--card-bg, #fff)",
                    opacity: isDone ? 0.6 : 1,
                    transition: "all 0.3s ease",
                  }}
                >
                  {/* Photo or icon */}
                  {item.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.photo_url}
                      alt={item.display_name}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        objectFit: "cover",
                        border: "1px solid var(--card-border)",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        background: "var(--bg-secondary, #f3f4f6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        name={tab === "cage" ? "grid-3x3" : "box"}
                        size={22}
                        color="var(--muted)"
                      />
                    </div>
                  )}

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: "var(--text-secondary)",
                        }}
                      >
                        #{item.barcode}
                      </span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                        {item.display_name}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>
                      {item.type_display_name}
                    </div>
                  </div>

                  {/* Action */}
                  {isDone ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "var(--warning-text)",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="log-out" size={16} color="var(--warning-text)" />
                      Checked Out
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="log-out"
                      loading={isProcessing}
                      disabled={!custodian.display_name.trim()}
                      onClick={() => handleCheckOut(item)}
                      style={{ borderRadius: 8, flexShrink: 0 }}
                    >
                      Check Out
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Summary bar */}
        {checkedOutIds.size > 0 && (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              background: "var(--warning-bg)",
              border: "1px solid var(--warning-border)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Icon name="log-out" size={18} color="var(--warning-text)" />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--warning-text)" }}>
                {checkedOutIds.size} item{checkedOutIds.size !== 1 ? "s" : ""} checked out
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCheckedOutIds(new Set());
                loadEquipment();
              }}
              style={{ borderRadius: 8 }}
            >
              Refresh List
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
