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
import { getCustodyStyle } from "@/lib/equipment-styles";
import { getLabel, EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

type Tab = "cage" | "trap";

export default function EquipmentCheckInPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("cage");
  const [equipment, setEquipment] = useState<VEquipmentInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [conditionOverrides, setConditionOverrides] = useState<Record<string, string>>({});
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEquipment = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ equipment: VEquipmentInventoryRow[] }>(
        "/api/equipment?limit=500&custody_status=checked_out"
      );
      // Also get assigned items
      const assigned = await fetchApi<{ equipment: VEquipmentInventoryRow[] }>(
        "/api/equipment?limit=500&custody_status=assigned"
      );
      setEquipment([...(data.equipment || []), ...(assigned.equipment || [])]);
    } catch {
      toast.error("Failed to load equipment");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadEquipment();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheckIn = async (item: VEquipmentInventoryRow) => {
    setProcessingId(item.equipment_id);
    try {
      const condition = conditionOverrides[item.equipment_id];
      const notes = noteOverrides[item.equipment_id]?.trim();

      await postApi(`/api/equipment/${item.equipment_id}/events`, {
        event_type: "check_in",
        notes: notes || undefined,
        condition_after: condition || undefined,
      });

      // If condition was changed, also log a condition_change event
      if (condition && condition !== item.condition_status) {
        await postApi(`/api/equipment/${item.equipment_id}/events`, {
          event_type: "condition_change",
          condition_after: condition,
          notes: `Condition updated on check-in: ${getLabel(EQUIPMENT_CONDITION_OPTIONS, item.condition_status)} → ${getLabel(EQUIPMENT_CONDITION_OPTIONS, condition)}`,
        });
      }

      setCheckedInIds((prev) => new Set(prev).add(item.equipment_id));
      toast.success(`${item.display_name} checked in`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setProcessingId(null);
    }
  };

  // Filter by tab
  const filtered = equipment.filter((e) => {
    if (tab === "cage") return e.type_category === "cage";
    return e.type_category === "trap";
  });

  // Sort: non-checked-in first, then by barcode
  const sorted = [...filtered].sort((a, b) => {
    const aChecked = checkedInIds.has(a.equipment_id) ? 1 : 0;
    const bChecked = checkedInIds.has(b.equipment_id) ? 1 : 0;
    if (aChecked !== bChecked) return aChecked - bChecked;
    return (a.barcode || "").localeCompare(b.barcode || "");
  });

  const cageCount = equipment.filter((e) => e.type_category === "cage").length;
  const trapCount = equipment.filter((e) => e.type_category === "trap").length;

  return (
    <div style={{ maxWidth: 700, padding: "0 1rem" }}>
      <Breadcrumbs
        items={[
          { label: "Equipment", href: "/equipment" },
          { label: "Check In" },
        ]}
      />

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "1rem 0 0.25rem" }}>
        Check In Equipment
      </h1>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
        Select items as they come back. Tap the check-in button to mark them returned.
      </p>

      <TabBar
        tabs={[
          { id: "cage", label: "Transfer Cages", count: cageCount },
          { id: "trap", label: "Traps", count: trapCount },
        ]}
        activeTab={tab}
        onTabChange={(id) => setTab(id as Tab)}
      />

      <div style={{ marginTop: "1rem" }}>
        {loading ? (
          <SkeletonList items={4} />
        ) : sorted.length === 0 ? (
          <EmptyState
            variant="default"
            title={`No ${tab === "cage" ? "cages" : "traps"} checked out`}
            description="Nothing to check in right now."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sorted.map((item) => {
              const isCheckedIn = checkedInIds.has(item.equipment_id);
              const isProcessing = processingId === item.equipment_id;
              const isExpanded = expandedId === item.equipment_id;
              const custodyStyle = getCustodyStyle(item.custody_status);

              return (
                <div
                  key={item.equipment_id}
                  style={{
                    border: `1px solid ${isCheckedIn ? "var(--success-border)" : "var(--card-border)"}`,
                    borderRadius: 10,
                    background: isCheckedIn ? "var(--success-bg)" : "var(--card-bg, #fff)",
                    opacity: isCheckedIn ? 0.6 : 1,
                    transition: "all 0.3s ease",
                  }}
                >
                  {/* Main row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem 1rem",
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
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-secondary)",
                          marginTop: 2,
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                        }}
                      >
                        <Icon name="user" size={13} color="var(--muted)" />
                        {item.custodian_name || item.current_holder_name || "Unknown holder"}
                        {item.custody_status === "assigned" && (
                          <span
                            style={{
                              padding: "0.1rem 0.35rem",
                              borderRadius: 4,
                              fontSize: "0.65rem",
                              fontWeight: 700,
                              background: custodyStyle.bg,
                              color: custodyStyle.text,
                            }}
                          >
                            ASSIGNED
                          </span>
                        )}
                      </div>
                      {item.days_checked_out != null && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color:
                              item.days_checked_out > 14
                                ? "var(--danger-text)"
                                : item.days_checked_out > 7
                                  ? "var(--warning-text)"
                                  : "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {item.days_checked_out} day{item.days_checked_out !== 1 ? "s" : ""} out
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexShrink: 0 }}>
                      {!isCheckedIn && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : item.equipment_id)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "0.375rem",
                            color: "var(--muted)",
                          }}
                          title="Options"
                        >
                          <Icon name="chevron-down" size={16} color="var(--muted)" />
                        </button>
                      )}
                      {isCheckedIn ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: "var(--success-text)",
                          }}
                        >
                          <Icon name="check-circle" size={18} color="var(--success-text)" />
                          Returned
                        </div>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          icon="log-in"
                          loading={isProcessing}
                          onClick={() => handleCheckIn(item)}
                          style={{
                            background: "var(--success-text, #16a34a)",
                            border: "1px solid transparent",
                            borderRadius: 8,
                          }}
                        >
                          Check In
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Expanded options: condition + notes */}
                  {isExpanded && !isCheckedIn && (
                    <div
                      style={{
                        padding: "0.625rem 1rem 0.75rem",
                        borderTop: "1px solid var(--card-border)",
                        display: "flex",
                        gap: "0.75rem",
                        flexWrap: "wrap",
                        alignItems: "flex-end",
                      }}
                    >
                      <div style={{ minWidth: 140 }}>
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
                          Condition on return
                        </label>
                        <select
                          value={conditionOverrides[item.equipment_id] || ""}
                          onChange={(e) =>
                            setConditionOverrides((prev) => ({
                              ...prev,
                              [item.equipment_id]: e.target.value,
                            }))
                          }
                          style={{
                            width: "100%",
                            padding: "0.4rem 0.5rem",
                            borderRadius: 6,
                            border: "1px solid var(--card-border)",
                            background: "var(--background, #fff)",
                            fontSize: "0.85rem",
                            fontFamily: "inherit",
                            color: "var(--text-primary)",
                          }}
                        >
                          <option value="">No change</option>
                          {EQUIPMENT_CONDITION_OPTIONS.filter(
                            (o) => o.value !== "decommissioned"
                          ).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
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
                          Notes
                        </label>
                        <input
                          type="text"
                          value={noteOverrides[item.equipment_id] || ""}
                          onChange={(e) =>
                            setNoteOverrides((prev) => ({
                              ...prev,
                              [item.equipment_id]: e.target.value,
                            }))
                          }
                          placeholder="e.g. Needs cleaning, bent door..."
                          style={{
                            width: "100%",
                            padding: "0.4rem 0.5rem",
                            borderRadius: 6,
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
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Summary bar when items have been checked in */}
        {checkedInIds.size > 0 && (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              background: "var(--success-bg)",
              border: "1px solid var(--success-border)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Icon name="check-circle" size={18} color="var(--success-text)" />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--success-text)" }}>
                {checkedInIds.size} item{checkedInIds.size !== 1 ? "s" : ""} checked in
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCheckedInIds(new Set());
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
