"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { formatPhone } from "@/lib/formatters";
import { PAPER_FORM } from "@/lib/paper-form-design";
import { useAppConfig } from "@/hooks/useAppConfig";
import type { OverdueQueueRow } from "@/lib/types/view-contracts";

/**
 * Equipment Follow-Up Call Queue
 *
 * Person-centric overdue equipment dashboard. Groups traps by holder,
 * sorted by priority score. Staff works top-to-bottom.
 *
 * FFS-1334, FFS-1335 (Epic FFS-1331).
 */

// Tier config: colors + labels
const TIERS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: "30+ days", color: "var(--danger-text)", bg: "var(--danger-bg)", border: "var(--danger-border, #fecaca)" },
  warning:  { label: "14-30 days", color: "var(--warning-text)", bg: "var(--warning-bg)", border: "var(--warning-border, #fde68a)" },
  new:      { label: "1-14 days", color: "var(--info-text)", bg: "var(--info-bg)", border: "var(--info-border, #93c5fd)" },
};

// Contact outcome options — big tappable buttons, not dropdowns
const OUTCOMES = [
  { value: "connected_will_return", label: "Connected — will return", icon: "check-circle" },
  { value: "connected_needs_time", label: "Connected — needs more time", icon: "check-circle" },
  { value: "left_voicemail", label: "Left voicemail", icon: "phone-outgoing" },
  { value: "no_answer", label: "No answer", icon: "phone-incoming" },
  { value: "wrong_number", label: "Wrong number", icon: "alert-circle" },
];

function formatOutcome(outcome: string | null): string {
  if (!outcome) return "";
  const found = OUTCOMES.find((o) => o.value === outcome);
  return found?.label || outcome.replace(/_/g, " ");
}

export default function CollectionsPage() {
  const toast = useToast();
  const { user } = useCurrentUser();
  const [queue, setQueue] = useState<OverdueQueueRow[]>([]);
  const [summary, setSummary] = useState<Record<string, { people: number; traps: number }>>({});
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("public");
  const [search, setSearch] = useState("");
  const [loggingFor, setLoggingFor] = useState<string | null>(null); // holder_name of card being logged

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tierFilter !== "all") params.set("tier", tierFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (search.trim()) params.set("search", search.trim());

      const data = await fetchApi<{
        queue: OverdueQueueRow[];
        summary: Record<string, { people: number; traps: number }>;
      }>(`/api/equipment/overdue-queue?${params}`);

      setQueue(data.queue || []);
      setSummary(data.summary || {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [tierFilter, typeFilter, search, toast]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Log a contact attempt
  const logContact = async (row: OverdueQueueRow, method: string, outcome: string, notes: string) => {
    try {
      await postApi("/api/equipment/contact-log", {
        person_id: row.person_id || null,
        holder_name: row.holder_name,
        method,
        outcome,
        notes: notes.trim() || null,
        staff_person_id: user?.staff_id || null,
        staff_name: user?.display_name || null,
        equipment_ids: row.equipment_ids,
      });
      toast.success(`Logged ${method} \u2192 ${formatOutcome(outcome)}`);
      setLoggingFor(null);
      fetchQueue();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log contact");
    }
  };

  // Group queue by urgency tier
  const grouped = queue.reduce<Record<string, OverdueQueueRow[]>>((acc, row) => {
    const tier = row.urgency_tier;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(row);
    return acc;
  }, {});

  const totalPeople = (summary.critical?.people || 0) + (summary.warning?.people || 0) + (summary.new?.people || 0);
  const totalTraps = (summary.critical?.traps || 0) + (summary.warning?.traps || 0) + (summary.new?.traps || 0);

  return (
    <div>
      {/* Screen UI (hidden in print) */}
      <div className="screen-ui">
        {/* Header */}
        <div style={{ marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Equipment Follow-Up</h1>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
              {totalPeople} people &middot; {totalTraps} overdue traps &middot; sorted by priority
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="printer"
            onClick={() => window.print()}
          >
            Print Call List
          </Button>
        </div>

        {/* Tier stat cards — clickable filters */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <button onClick={() => setTierFilter("all")} style={statButtonStyle(tierFilter === "all", "var(--text-primary)")}>
            <StatCard label="All Overdue" value={totalPeople} subtitle={`${totalTraps} traps`} />
          </button>
          <button onClick={() => setTierFilter("critical")} style={statButtonStyle(tierFilter === "critical", "var(--danger-text)")}>
            <StatCard label="Critical" value={summary.critical?.people || 0} subtitle={TIERS.critical.label} valueColor="var(--danger-text)" />
          </button>
          <button onClick={() => setTierFilter("warning")} style={statButtonStyle(tierFilter === "warning", "var(--warning-text)")}>
            <StatCard label="Warning" value={summary.warning?.people || 0} subtitle={TIERS.warning.label} valueColor="var(--warning-text)" />
          </button>
          <button onClick={() => setTierFilter("new")} style={statButtonStyle(tierFilter === "new", "var(--info-text)")}>
            <StatCard label="New" value={summary.new?.people || 0} subtitle={TIERS.new.label} valueColor="var(--info-text)" />
          </button>
        </div>

        {/* Filter row */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "20px",
              border: "1px solid var(--border)", width: "200px", outline: "none",
            }}
          />
          {["public", "trapper", "all"].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: "0.25rem 0.75rem", fontSize: "0.8rem", borderRadius: "20px", cursor: "pointer",
                border: typeFilter === t ? "1.5px solid var(--primary)" : "1px solid var(--border)",
                background: typeFilter === t ? "var(--primary-bg, rgba(59,130,246,0.08))" : "transparent",
                color: typeFilter === t ? "var(--primary)" : "var(--text-secondary)",
                fontWeight: typeFilter === t ? 600 : 400,
              }}
            >
              {t === "public" ? "Public Only" : t === "trapper" ? "Trappers" : "All"}
            </button>
          ))}
        </div>

        {/* Queue */}
        {loading ? (
          <SkeletonList items={6} />
        ) : queue.length === 0 ? (
          <EmptyState
            title="No overdue equipment"
            description={tierFilter !== "all" || typeFilter !== "all" ? "Try adjusting your filters." : "All equipment is on time or returned."}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {(["critical", "warning", "new"] as const).map((tier) => {
              const rows = grouped[tier];
              if (!rows || rows.length === 0) return null;
              const tc = TIERS[tier];
              return (
                <div key={tier}>
                  {/* Tier header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.5rem 0.75rem", marginTop: "0.5rem", marginBottom: "0.25rem",
                    fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                    color: tc.color,
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: tc.color }} />
                    {tier === "critical" ? "Critical" : tier === "warning" ? "Warning" : "Newly Overdue"} &mdash; {rows.length} {rows.length === 1 ? "person" : "people"}
                  </div>

                  {/* Cards */}
                  {rows.map((row) => (
                    <OverdueCard
                      key={row.holder_name}
                      row={row}
                      tier={tc}
                      isLogging={loggingFor === row.holder_name}
                      onStartLog={() => setLoggingFor(row.holder_name)}
                      onCancelLog={() => setLoggingFor(null)}
                      onLogContact={(method, outcome, notes) => logContact(row, method, outcome, notes)}
                      onMarkReturned={() => {
                        toast.info("Use the Inventory page or Kiosk to check in returned traps.");
                      }}
                      onRefresh={fetchQueue}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Print-only call list — hidden on screen, shown only in @media print */}
      <PrintCallList queue={queue} grouped={grouped} totalPeople={totalPeople} totalTraps={totalTraps} />

      {/* Print styles */}
      <style>{`
        .print-call-list { display: none; }

        @media print {
          nav, header, [data-sidebar], button, input, [data-no-print] { display: none !important; }
          .screen-ui { display: none !important; }

          .print-call-list {
            display: block !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          @page {
            size: letter portrait;
            margin: 0;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Card Component ─────────────────────────────────────────────────────────

function OverdueCard({
  row,
  tier,
  isLogging,
  onStartLog,
  onCancelLog,
  onLogContact,
  onMarkReturned,
  onRefresh,
}: {
  row: OverdueQueueRow;
  tier: { color: string; bg: string; border: string };
  isLogging: boolean;
  onStartLog: () => void;
  onCancelLog: () => void;
  onLogContact: (method: string, outcome: string, notes: string) => void;
  onMarkReturned: () => void;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const [logMethod, setLogMethod] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actionMode, setActionMode] = useState<"none" | "extend" | "reassign" | "note">("none");
  const [actionNote, setActionNote] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [reassignName, setReassignName] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [logNotes, setLogNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // SMS template from app_config (FFS-1339)
  const { value: smsTemplate } = useAppConfig<string>("equipment.sms_reminder_template");
  const { value: orgPhone } = useAppConfig<string>("equipment.org_phone");
  const { value: orgAddress } = useAppConfig<string>("equipment.org_address");

  const phoneDisplay = row.phone ? formatPhone(row.phone) : null;
  const dueDateDisplay = row.earliest_due_date
    ? new Date(row.earliest_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  const defaultSms = "Hi {first_name}, this is Forgotten Felines checking on trap {barcodes} you borrowed. Please return to {org_address} or call {org_phone}. Thank you!";
  const smsBody = encodeURIComponent(
    (smsTemplate || defaultSms)
      .replace(/\{name\}/g, row.holder_name)
      .replace(/\{first_name\}/g, row.holder_name.split(" ")[0])
      .replace(/\{barcodes\}/g, row.trap_barcodes.join(", "))
      .replace(/\{trap_count\}/g, String(row.trap_count))
      .replace(/\{due_date\}/g, dueDateDisplay)
      .replace(/\{org_phone\}/g, orgPhone || "(707) 576-7999")
      .replace(/\{org_address\}/g, orgAddress || "1814 Empire Industrial Ct, Suite F, Santa Rosa")
  );

  const handleSubmitLog = async (outcome: string) => {
    setSubmitting(true);
    await onLogContact(logMethod || "call", outcome, logNotes);
    setSubmitting(false);
    setLogMethod(null);
    setLogNotes("");
  };

  return (
    <div
      style={{
        borderLeft: `4px solid ${tier.color}`,
        borderRadius: 8,
        border: `1px solid ${expanded ? tier.color : "var(--card-border, #e5e7eb)"}`,
        borderLeftWidth: 4,
        borderLeftColor: tier.color,
        background: "var(--card-bg, #fff)",
        marginBottom: "0.375rem",
        transition: "border-color 0.15s",
      }}
    >
      {/* Clickable summary — tap to expand */}
      <div
        onClick={() => { if (!isLogging && actionMode === "none") setExpanded(!expanded); }}
        style={{
          padding: "0.875rem 1rem",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
      {/* Row 1: Name + days overdue badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
              {row.person_id ? (
                <a href={`/people/${row.person_id}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                  {row.holder_name}
                </a>
              ) : (
                row.holder_name
              )}
            </span>
            {row.is_trapper && (
              <span style={{
                padding: "0.1rem 0.4rem", borderRadius: 4, fontSize: "0.65rem", fontWeight: 700,
                background: "var(--info-bg)", color: "var(--info-text)", textTransform: "uppercase",
              }}>
                Trapper
              </span>
            )}
          </div>
        </div>
        <span style={{
          padding: "0.15rem 0.5rem", borderRadius: 12, fontSize: "0.75rem", fontWeight: 700,
          color: tier.color, background: tier.bg, whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {row.max_days_overdue}d overdue
        </span>
      </div>

      {/* Row 2: Traps + due date */}
      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
        {row.trap_count} trap{row.trap_count !== 1 ? "s" : ""}: <strong style={{ fontFamily: "monospace" }}>{row.trap_barcodes.join(", ")}</strong>
        {row.earliest_due_date && (
          <span style={{ marginLeft: "0.5rem", color: "var(--muted)" }}>
            &middot; due {new Date(row.earliest_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {/* Row 3: Contact info */}
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.375rem", fontSize: "0.85rem", flexWrap: "wrap" }}>
        {phoneDisplay ? (
          <a href={`tel:${row.phone}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>
            <Icon name="phone" size={13} color="var(--primary)" /> {phoneDisplay}
          </a>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>No phone</span>
        )}
        {row.email && (
          <a href={`mailto:${row.email}`} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: "0.8rem" }}>
            {row.email}
          </a>
        )}
      </div>

      {/* Row 4: Last contact */}
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.375rem" }}>
        {row.last_contact_at ? (
          <>
            Last: {new Date(row.last_contact_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {" \u2014 "}{formatOutcome(row.last_contact_outcome)}
            {row.last_contact_notes && <span style={{ fontStyle: "italic" }}> &mdash; &ldquo;{row.last_contact_notes}&rdquo;</span>}
            {row.contact_attempt_count > 1 && <span> ({row.contact_attempt_count} attempts)</span>}
          </>
        ) : (
          <span style={{ color: "var(--danger-text)", fontWeight: 500 }}>No contact attempts yet</span>
        )}
      </div>

      {/* Expand hint */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: "0.375rem" }}>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} color="var(--muted)" />
      </div>
      </div>{/* end clickable summary */}

      {/* ═══ EXPANDED SECTION ═══ */}
      {expanded && (
      <div style={{ padding: "0 1rem 0.875rem", borderTop: "1px solid var(--card-border, #e5e7eb)" }}>

      {/* Action grid — two rows */}
      {!isLogging && actionMode === "none" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "0.375rem", marginTop: "0.625rem" }}>
          <ActionTile icon="phone-call" label="Log Call" color="var(--primary)" onClick={() => { onStartLog(); setLogMethod("call"); }} />
          {phoneDisplay && (
            <ActionTile icon="message-square" label="Send Text" color="var(--primary)" onClick={() => {
              window.open(`sms:${row.phone}?body=${smsBody}`, "_self");
              onStartLog(); setLogMethod("text");
            }} />
          )}
          <ActionTile icon="check" label="Returned" color="var(--success-text)" onClick={onMarkReturned} />
          <ActionTile icon="calendar-days" label="Extend Date" color="var(--warning-text)" onClick={() => setActionMode("extend")} />
          <ActionTile icon="arrow-right" label="Reassign" color="var(--info-text)" onClick={() => setActionMode("reassign")} />
          <ActionTile icon="message-square" label="Add Note" color="var(--text-secondary)" onClick={() => setActionMode("note")} />
        </div>
      )}

      {/* Extend due date form */}
      {actionMode === "extend" && (
        <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--section-bg, #f9fafb)", borderRadius: 8, border: "1px solid var(--card-border)" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Extend due date for all {row.trap_count} trap{row.trap_count !== 1 ? "s" : ""}</div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: "0.7rem", color: "var(--muted)", display: "block", marginBottom: "0.2rem" }}>New due date</label>
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)}
                style={{ padding: "0.4rem 0.5rem", borderRadius: 6, border: "1px solid var(--card-border)", fontSize: "0.85rem" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "0.7rem", color: "var(--muted)", display: "block", marginBottom: "0.2rem" }}>Reason</label>
              <input type="text" value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="e.g. Active colony, keeping for 2 more weeks"
                style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: 6, border: "1px solid var(--card-border)", fontSize: "0.85rem", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem" }}>
            <Button variant="primary" size="sm" loading={actionSubmitting} disabled={!newDueDate} onClick={async () => {
              setActionSubmitting(true);
              try {
                for (const eqId of row.equipment_ids) {
                  // Log the extension event
                  await postApi(`/api/equipment/${eqId}/events`, {
                    event_type: "note",
                    notes: `Due date extended to ${newDueDate}. ${actionNote}`.trim(),
                    due_date: newDueDate,
                  });
                  // Update the actual due date on the equipment row
                  await fetch(`/api/equipment/${eqId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ expected_return_date: newDueDate }),
                  });
                }
                // Log as contact attempt so it shows in the call queue history
                await postApi("/api/equipment/contact-log", {
                  person_id: row.person_id, holder_name: row.holder_name,
                  method: "system", outcome: "connected_needs_time",
                  notes: `Due date extended to ${newDueDate}. ${actionNote}`.trim(),
                  equipment_ids: row.equipment_ids,
                });
                toast.success(`Due date extended to ${newDueDate}`);
                setActionMode("none"); setExpanded(false); setActionNote(""); setNewDueDate("");
                onRefresh();
              } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
              finally { setActionSubmitting(false); }
            }} style={{ borderRadius: 8 }}>
              Extend
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setActionMode("none"); setActionNote(""); setNewDueDate(""); }} style={{ borderRadius: 8 }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Reassign holder form */}
      {actionMode === "reassign" && (
        <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--section-bg, #f9fafb)", borderRadius: 8, border: "1px solid var(--card-border)" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Reassign from {row.holder_name} — who actually has {row.trap_count > 1 ? "these traps" : "this trap"}?
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1 }}>
              <input type="text" value={reassignName} onChange={(e) => setReassignName(e.target.value)} placeholder="e.g. Moria Zimbicki"
                style={{ width: "100%", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--card-border)", fontSize: "0.9rem", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            This will transfer all {row.trap_count} trap{row.trap_count !== 1 ? "s" : ""} ({row.trap_barcodes.join(", ")}) to the new holder.
          </div>
          <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem" }}>
            <Button variant="primary" size="sm" loading={actionSubmitting} disabled={!reassignName.trim()} onClick={async () => {
              setActionSubmitting(true);
              try {
                // Try to find the person by name to link custodian_person_id
                let personId: string | null = null;
                try {
                  const searchResult = await fetchApi<{ results: Array<{ entity_id: string; display_name: string }> }>(
                    `/api/search?q=${encodeURIComponent(reassignName.trim())}&type=person&limit=1`
                  );
                  if (searchResult.results?.length > 0) {
                    const match = searchResult.results[0];
                    if (match.display_name.toLowerCase() === reassignName.trim().toLowerCase()) {
                      personId = match.entity_id;
                    }
                  }
                } catch { /* non-blocking */ }

                for (const eqId of row.equipment_ids) {
                  await postApi(`/api/equipment/${eqId}/events`, {
                    event_type: "transfer",
                    custodian_person_id: personId || undefined,
                    custodian_name: reassignName.trim(),
                    custodian_name_raw: reassignName.trim(),
                    notes: `Reassigned from ${row.holder_name}. ${actionNote}`.trim(),
                  });
                }
                toast.success(`Transferred to ${reassignName.trim()}${personId ? " (linked)" : ""}`);
                setActionMode("none"); setExpanded(false); setReassignName(""); setActionNote("");
                onRefresh();
              } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
              finally { setActionSubmitting(false); }
            }} style={{ borderRadius: 8 }}>
              Reassign
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setActionMode("none"); setReassignName(""); }} style={{ borderRadius: 8 }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Add note form */}
      {actionMode === "note" && (
        <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--section-bg, #f9fafb)", borderRadius: 8, border: "1px solid var(--card-border)" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Add a note about this equipment</div>
          <input type="text" value={actionNote} onChange={(e) => setActionNote(e.target.value)}
            placeholder="e.g. Left at colony site intentionally, borrower traveling until May, trapper has it"
            style={{ width: "100%", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--card-border)", fontSize: "0.85rem", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem" }}>
            <Button variant="primary" size="sm" loading={actionSubmitting} disabled={!actionNote.trim()} onClick={async () => {
              setActionSubmitting(true);
              try {
                await postApi("/api/equipment/contact-log", {
                  person_id: row.person_id, holder_name: row.holder_name,
                  method: "system", outcome: "connected_other",
                  notes: actionNote.trim(),
                  equipment_ids: row.equipment_ids,
                });
                toast.success("Note saved");
                setActionMode("none"); setExpanded(false); setActionNote("");
                onRefresh();
              } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
              finally { setActionSubmitting(false); }
            }} style={{ borderRadius: 8 }}>
              Save Note
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setActionMode("none"); setActionNote(""); }} style={{ borderRadius: 8 }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Inline contact logging panel */}
      {isLogging && (
        <div style={{
          marginTop: "0.625rem",
          padding: "0.75rem",
          background: "var(--section-bg, #f9fafb)",
          borderRadius: 8,
          border: "1px solid var(--card-border)",
        }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-secondary)" }}>
            What happened?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => handleSubmitLog(o.value)}
                disabled={submitting}
                style={{
                  display: "flex", alignItems: "center", gap: "0.625rem",
                  padding: "0.625rem 0.875rem", borderRadius: 8,
                  border: "1px solid var(--card-border)",
                  background: "var(--card-bg, #fff)", cursor: "pointer",
                  fontSize: "0.85rem", fontWeight: 500, textAlign: "left",
                  minHeight: 44, width: "100%",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                <Icon name={o.icon} size={16} color="var(--text-secondary)" />
                {o.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <input
              type="text"
              placeholder="Optional note..."
              value={logNotes}
              onChange={(e) => setLogNotes(e.target.value)}
              style={{
                width: "100%", padding: "0.5rem 0.75rem", fontSize: "0.85rem",
                borderRadius: 8, border: "1px solid var(--card-border)",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginTop: "0.5rem", textAlign: "right" }}>
            <Button variant="ghost" size="sm" onClick={() => { onCancelLog(); setLogMethod(null); setLogNotes(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      </div>
      )}{/* end expanded section */}
    </div>
  );
}

// ─── Print Call List ─────────────────────────────────────────────────────────

const TIER_PRINT_LABELS: Record<string, string> = {
  critical: "CRITICAL (30+ days overdue)",
  warning: "WARNING (14\u201330 days overdue)",
  new: "NEWLY OVERDUE (1\u201314 days)",
};

const TIER_ORDER = ["critical", "warning", "new"] as const;

function PrintCallList({
  queue,
  grouped,
  totalPeople,
  totalTraps,
}: {
  queue: OverdueQueueRow[];
  grouped: Record<string, OverdueQueueRow[]>;
  totalPeople: number;
  totalTraps: number;
}) {
  if (queue.length === 0) return null;

  const generatedDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const pf = PAPER_FORM;

  const pageStyle: React.CSSProperties = {
    fontFamily: pf.font.family,
    fontSize: pf.font.body,
    lineHeight: pf.lineHeight.body,
    color: pf.color.text,
    padding: `${pf.spacing.pageMarginY} ${pf.spacing.pageMarginX}`,
  };

  const headerStyle: React.CSSProperties = {
    fontSize: pf.font.h1,
    fontWeight: pf.weight.h1,
    lineHeight: pf.lineHeight.h1,
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  };

  const headerRuleStyle: React.CSSProperties = {
    border: "none",
    borderTop: `2.5px solid ${pf.color.rule}`,
    margin: `${pf.spacing.fieldGap} 0`,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: pf.font.label,
    fontWeight: pf.weight.body,
    color: pf.color.muted,
    margin: `0 0 ${pf.spacing.sectionRule}`,
  };

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: pf.font.section,
    fontWeight: pf.weight.section,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0,
    padding: `${pf.spacing.sectionRule} 0`,
    borderBottom: `1px solid ${pf.color.border}`,
  };

  const entryWrapStyle: React.CSSProperties = {
    borderBottom: `1px solid ${pf.color.hairline}`,
    pageBreakInside: "avoid",
  };

  const rowStyle: React.CSSProperties = {
    paddingTop: pf.spacing.fieldGap,
    paddingBottom: "2pt",
    display: "flex",
    gap: pf.spacing.columnGap,
    alignItems: "baseline",
  };

  const checkboxStyle: React.CSSProperties = {
    width: pf.checkbox.size,
    height: pf.checkbox.size,
    border: pf.checkbox.border,
    flexShrink: 0,
    display: "inline-block",
    borderRadius: 2,
    position: "relative",
    top: "2pt",
  };

  const nameStyle: React.CSSProperties = {
    fontWeight: pf.weight.label,
    fontSize: pf.font.body,
    minWidth: "2.4in",
  };

  const phoneStyle: React.CSSProperties = {
    fontSize: pf.font.body,
    minWidth: "1.5in",
  };

  const barcodesStyle: React.CSSProperties = {
    fontSize: pf.font.body,
    fontFamily: "monospace",
    minWidth: "1.2in",
  };

  const daysStyle: React.CSSProperties = {
    fontSize: pf.font.body,
    fontWeight: pf.weight.label,
    textAlign: "right",
    whiteSpace: "nowrap",
    minWidth: "0.7in",
    marginLeft: "auto",
  };

  const detailLineStyle: React.CSSProperties = {
    fontSize: pf.font.label,
    color: pf.color.muted,
    paddingLeft: `calc(${pf.checkbox.size} + ${pf.checkbox.labelGap} + ${pf.spacing.columnGap})`,
    paddingBottom: pf.spacing.fieldGap,
    lineHeight: pf.lineHeight.label,
  };

  return (
    <div className="print-call-list" style={pageStyle}>
      {/* Page header */}
      <h1 style={headerStyle}>
        Forgotten Felines of Sonoma County &mdash; Overdue Equipment Call List
      </h1>
      <hr style={headerRuleStyle} />
      <p style={subtitleStyle}>
        Generated {generatedDate} &middot; {totalPeople} people &middot; {totalTraps} traps overdue
      </p>

      {/* Tier sections */}
      {TIER_ORDER.map((tier) => {
        const rows = grouped[tier];
        if (!rows || rows.length === 0) return null;

        return (
          <div key={tier} style={{ marginTop: pf.spacing.sectionRule }}>
            <h2 style={sectionHeadingStyle}>
              {TIER_PRINT_LABELS[tier]} &mdash; {rows.length} {rows.length === 1 ? "person" : "people"}
            </h2>

            {rows.map((row) => {
              const phoneDisplay = row.phone ? formatPhone(row.phone) : null;
              const lastContactDate = row.last_contact_at
                ? new Date(row.last_contact_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : null;
              const lastOutcome = formatOutcome(row.last_contact_outcome);
              const contactSummary = lastContactDate
                ? `Last: ${lastContactDate}${lastOutcome ? ` \u2014 ${lastOutcome}` : ""}${row.contact_attempt_count > 1 ? ` (${row.contact_attempt_count} attempts)` : ""}`
                : "Never contacted";

              return (
                <div key={row.holder_name} style={entryWrapStyle}>
                  {/* Primary row: checkbox, name, phone, barcodes, days */}
                  <div style={rowStyle}>
                    <div style={checkboxStyle} />
                    <span style={nameStyle}>{row.holder_name}</span>
                    <span style={phoneStyle}>{phoneDisplay || "No phone"}</span>
                    <span style={barcodesStyle}>{row.trap_barcodes.join(", ")}</span>
                    <span style={daysStyle}>{row.max_days_overdue} days</span>
                  </div>

                  {/* Detail line: email + last contact */}
                  <div style={detailLineStyle}>
                    {row.email && <span>{row.email}</span>}
                    {row.email && <span style={{ margin: "0 0.4em" }}>&middot;</span>}
                    <span>{contactSummary}</span>
                    {row.last_contact_notes && (
                      <span style={{ fontStyle: "italic" }}>{` \u2014 \u201C${row.last_contact_notes}\u201D`}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Footer */}
      <div style={{
        marginTop: pf.spacing.pageMarginY,
        paddingTop: pf.spacing.sectionRule,
        borderTop: `1px solid ${pf.color.hairline}`,
        fontSize: pf.font.footer,
        color: pf.color.muted,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>1814 Empire Industrial Ct, Suite F, Santa Rosa CA 95403</span>
        <span>(707) 576-7999</span>
      </div>
    </div>
  );
}

// ─── Action Tile ────────────────────────────────────────────────────────────

function ActionTile({ icon, label, color, onClick }: {
  icon: string; label: string; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "0.25rem", padding: "0.625rem 0.375rem",
        borderRadius: 8, border: "1px solid var(--card-border, #e5e7eb)",
        background: "var(--card-bg, #fff)", cursor: "pointer",
        minHeight: 56, fontSize: "0.7rem", fontWeight: 600, color,
        WebkitTapHighlightColor: "transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--section-bg, #f9fafb)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card-bg, #fff)"; }}
    >
      <Icon name={icon} size={18} color={color} />
      {label}
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function statButtonStyle(active: boolean, accentColor: string): React.CSSProperties {
  return {
    all: "unset" as const,
    cursor: "pointer",
    borderRadius: 8,
    border: active ? `2px solid ${accentColor}` : "2px solid transparent",
    WebkitTapHighlightColor: "transparent",
  };
}
