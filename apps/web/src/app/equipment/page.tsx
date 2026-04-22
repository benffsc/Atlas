"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchApi } from "@/lib/api-client";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { formatPhone } from "@/lib/formatters";
import type { VEquipmentInventoryRow, OverdueQueueRow } from "@/lib/types/view-contracts";

/**
 * Equipment Dashboard — the command center.
 *
 * Answers three questions in 5 seconds:
 * 1. How many traps can I lend right now?
 * 2. Who needs a follow-up call?
 * 3. What happened today?
 *
 * Everything else is one click away via sidebar.
 */
export default function EquipmentDashboard() {
  const [equipment, setEquipment] = useState<VEquipmentInventoryRow[]>([]);
  const [overdue, setOverdue] = useState<OverdueQueueRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<Array<{
    event_type: string; custodian_name: string | null; barcode: string | null; created_at: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchApi<{ equipment: VEquipmentInventoryRow[] }>("/api/equipment?limit=500")
        .then((d) => setEquipment(d.equipment || [])),
      fetchApi<{ queue: OverdueQueueRow[] }>("/api/equipment/overdue-queue?type=public")
        .then((d) => setOverdue(d.queue || [])),
      fetchApi<{ events: typeof recentActivity }>("/api/equipment/activity?limit=8")
        .then((d) => setRecentActivity(d.events || []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Category stats
  const stats = useMemo(() => {
    const traps = equipment.filter((e) => e.type_category === "trap");
    const now = new Date();
    return {
      traps: {
        total: traps.length,
        available: traps.filter((e) => e.custody_status === "available").length,
        out: traps.filter((e) => e.custody_status === "checked_out").length,
        overdue: traps.filter((e) =>
          e.custody_status === "checked_out" &&
          (e.current_due_date || e.expected_return_date) &&
          new Date(e.current_due_date || e.expected_return_date || "") < now
        ).length,
        missing: traps.filter((e) => e.custody_status === "missing").length,
      },
      accessories: {
        total: equipment.filter((e) => e.type_category !== "trap").length,
        available: equipment.filter((e) => e.type_category !== "trap" && e.custody_status === "available").length,
        out: equipment.filter((e) => e.type_category !== "trap" && e.custody_status === "checked_out").length,
      },
    };
  }, [equipment]);

  const overduePublic = overdue.filter((r) => !r.is_trapper);
  const overdueTrapper = overdue.filter((r) => r.is_trapper);

  if (loading) {
    return (
      <div style={{ padding: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 1rem" }}>Equipment</h1>
        <SkeletonList items={5} />
      </div>
    );
  }

  return (
    <div>
      {/* ═══ HEADER ═══ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Equipment</h1>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button variant="primary" size="sm" icon="scan-barcode" onClick={() => window.open("/kiosk/equipment/scan", "_blank")}>
            Scan
          </Button>
          <Button variant="outline" size="sm" icon="upload-cloud" onClick={() => window.location.href = "/admin/equipment/scan-slips"}>
            Process Slips
          </Button>
        </div>
      </div>

      {/* ═══ TRAP STATS ═══ */}
      <div style={{
        fontSize: "0.7rem", fontWeight: 700, color: "var(--text-secondary)",
        textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.375rem",
      }}>
        Traps — {stats.traps.total} total
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <StatCard label="Available to Lend" value={stats.traps.available} valueColor="var(--success-text)" />
        <StatCard label="Checked Out" value={stats.traps.out} valueColor="var(--warning-text)" />
        <StatCard
          label="Overdue"
          value={stats.traps.overdue}
          valueColor={stats.traps.overdue > 0 ? "var(--danger-text)" : "var(--muted)"}
        />
        {stats.traps.missing > 0 && <StatCard label="Missing" value={stats.traps.missing} valueColor="var(--danger-text)" />}
      </div>
      {stats.accessories.total > 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Accessories/Cages: {stats.accessories.available} available, {stats.accessories.out} out
        </div>
      )}

      {/* ═══ OVERDUE — PUBLIC BORROWERS ═══ */}
      {overduePublic.length > 0 && (
        <section style={{
          marginBottom: "1.25rem",
          border: "1px solid var(--danger-border, #fecaca)",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0.5rem 0.875rem",
            background: "var(--danger-bg)",
            borderBottom: "1px solid var(--danger-border, #fecaca)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontWeight: 700, fontSize: "0.85rem", color: "var(--danger-text)" }}>
              <Icon name="alert-triangle" size={15} color="var(--danger-text)" />
              Public Borrowers — {overduePublic.length} overdue
            </span>
            <Button variant="outline" size="sm" onClick={() => window.location.href = "/equipment/collections"}>
              Open Call Queue
            </Button>
          </div>
          {overduePublic.slice(0, 6).map((item) => (
            <div key={item.holder_name} style={{
              display: "flex", alignItems: "center", gap: "0.625rem",
              padding: "0.5rem 0.875rem", borderBottom: "1px solid var(--card-border, #e5e7eb)",
              fontSize: "0.85rem",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{item.holder_name}</span>
                <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.75rem", fontFamily: "monospace" }}>
                  {item.trap_barcodes.join(", ")}
                </span>
              </div>
              {item.phone ? (
                <a href={`tel:${item.phone}`} style={{ color: "var(--primary)", textDecoration: "none", fontSize: "0.8rem", fontWeight: 500, flexShrink: 0 }}>
                  {formatPhone(item.phone)}
                </a>
              ) : (
                <span style={{ color: "var(--muted)", fontSize: "0.75rem", flexShrink: 0 }}>No phone</span>
              )}
              <span style={{
                padding: "0.1rem 0.375rem", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700,
                background: item.max_days_overdue >= 30 ? "var(--danger-bg)" : "var(--warning-bg)",
                color: item.max_days_overdue >= 30 ? "var(--danger-text)" : "var(--warning-text)",
                flexShrink: 0,
              }}>
                {item.max_days_overdue}d
              </span>
            </div>
          ))}
          {overduePublic.length > 6 && (
            <div style={{ padding: "0.375rem 0.875rem", textAlign: "center", fontSize: "0.8rem" }}>
              <a href="/equipment/collections" style={{ color: "var(--primary)" }}>
                +{overduePublic.length - 6} more — View full call queue
              </a>
            </div>
          )}
        </section>
      )}

      {/* ═══ OVERDUE — TRAPPERS (compact) ═══ */}
      {overdueTrapper.length > 0 && (
        <section style={{
          marginBottom: "1.25rem",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0.5rem 0.875rem",
            background: "var(--section-bg, #f9fafb)",
            borderBottom: "1px solid var(--card-border, #e5e7eb)",
          }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              Trappers with Overdue Equipment — {overdueTrapper.length}
            </span>
            <a href="/equipment/collections?type=trapper" style={{ fontSize: "0.75rem", color: "var(--primary)" }}>
              View
            </a>
          </div>
          <div style={{ padding: "0.5rem 0.875rem", fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: "0.25rem 1rem" }}>
            {overdueTrapper.slice(0, 8).map((t) => (
              <span key={t.holder_name}>
                {t.holder_name} <span style={{ color: "var(--muted)" }}>({t.trap_count})</span>
              </span>
            ))}
            {overdueTrapper.length > 8 && <span style={{ color: "var(--muted)" }}>+{overdueTrapper.length - 8} more</span>}
          </div>
        </section>
      )}

      {/* ═══ QUICK LINKS ═══ */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem",
        marginBottom: "1.25rem",
      }}>
        {[
          { label: "Full Inventory", href: "/equipment/inventory", icon: "boxes", desc: `${equipment.length} items` },
          { label: "Call Queue", href: "/equipment/collections", icon: "phone-call", desc: `${overduePublic.length} to call` },
          { label: "Activity Log", href: "/equipment/activity", icon: "activity", desc: "Recent events" },
          { label: "Inventory Day", href: "/equipment/restock", icon: "clipboard-check", desc: "Reconcile stock" },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            style={{
              display: "flex", alignItems: "center", gap: "0.625rem",
              padding: "0.75rem", borderRadius: 8,
              border: "1px solid var(--card-border, #e5e7eb)",
              background: "var(--card-bg, #fff)",
              textDecoration: "none", color: "var(--text-primary)",
              transition: "border-color 0.15s",
            }}
          >
            <Icon name={link.icon} size={20} color="var(--primary)" />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{link.label}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{link.desc}</div>
            </div>
          </a>
        ))}
      </div>

      {/* ═══ MISSING TRAPS ═══ */}
      {stats.traps.missing > 0 && (
        <section style={{
          marginBottom: "1.25rem",
          padding: "0.625rem 0.875rem",
          border: "1px solid var(--warning-border, #fde68a)",
          borderRadius: 8,
          background: "var(--warning-bg)",
          fontSize: "0.85rem",
        }}>
          <span style={{ fontWeight: 600, color: "var(--warning-text)" }}>
            {stats.traps.missing} missing trap{stats.traps.missing !== 1 ? "s" : ""}
          </span>
          <span style={{ color: "var(--text-secondary)", marginLeft: "0.5rem" }}>
            {equipment.filter((e) => e.custody_status === "missing").map((e) => e.barcode).filter(Boolean).join(", ")}
          </span>
        </section>
      )}
    </div>
  );
}
