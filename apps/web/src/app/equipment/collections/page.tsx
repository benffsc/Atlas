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
import type { OverdueQueueRow } from "@/app/api/equipment/overdue-queue/route";

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
  { value: "connected_needs_time", label: "Connected — needs more time", icon: "clock" },
  { value: "left_voicemail", label: "Left voicemail", icon: "voicemail" },
  { value: "no_answer", label: "No answer", icon: "phone-missed" },
  { value: "wrong_number", label: "Wrong number", icon: "phone-off" },
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
      toast.success(`Logged ${method} → ${formatOutcome(outcome)}`);
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
      {/* Header */}
      <div style={{ marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Equipment Follow-Up</h1>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
            {totalPeople} people · {totalTraps} overdue traps · sorted by priority
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
          <StatCard label="All Overdue" value={totalPeople} subtitle={`${totalTraps} traps`} compact />
        </button>
        <button onClick={() => setTierFilter("critical")} style={statButtonStyle(tierFilter === "critical", "var(--danger-text)")}>
          <StatCard label="Critical" value={summary.critical?.people || 0} subtitle={TIERS.critical.label} valueColor="var(--danger-text)" compact />
        </button>
        <button onClick={() => setTierFilter("warning")} style={statButtonStyle(tierFilter === "warning", "var(--warning-text)")}>
          <StatCard label="Warning" value={summary.warning?.people || 0} subtitle={TIERS.warning.label} valueColor="var(--warning-text)" compact />
        </button>
        <button onClick={() => setTierFilter("new")} style={statButtonStyle(tierFilter === "new", "var(--info-text)")}>
          <StatCard label="New" value={summary.new?.people || 0} subtitle={TIERS.new.label} valueColor="var(--info-text)" compact />
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
                  {tier === "critical" ? "Critical" : tier === "warning" ? "Warning" : "Newly Overdue"} — {rows.length} {rows.length === 1 ? "person" : "people"}
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
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          nav, header, [data-sidebar], button, input, [data-no-print] { display: none !important; }
          * { color: #000 !important; background: #fff !important; border-color: #ccc !important; }
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
}: {
  row: OverdueQueueRow;
  tier: { color: string; bg: string; border: string };
  isLogging: boolean;
  onStartLog: () => void;
  onCancelLog: () => void;
  onLogContact: (method: string, outcome: string, notes: string) => void;
  onMarkReturned: () => void;
}) {
  const [logMethod, setLogMethod] = useState<string | null>(null);
  const [logNotes, setLogNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const phoneDisplay = row.phone ? formatPhone(row.phone) : null;
  const smsBody = encodeURIComponent(
    `Hi ${row.holder_name.split(" ")[0]}, this is Forgotten Felines checking on trap${row.trap_count > 1 ? "s" : ""} ${row.trap_barcodes.join(", ")} you borrowed. Please return to 1814 Empire Industrial Ct, Suite F, Santa Rosa, or call (707) 576-7999. Thank you!`
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
        border: `1px solid var(--card-border, #e5e7eb)`,
        borderLeftWidth: 4,
        borderLeftColor: tier.color,
        background: "var(--card-bg, #fff)",
        padding: "0.875rem 1rem",
        marginBottom: "0.375rem",
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
            · due {new Date(row.earliest_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
            {" — "}{formatOutcome(row.last_contact_outcome)}
            {row.last_contact_notes && <span style={{ fontStyle: "italic" }}> — "{row.last_contact_notes}"</span>}
            {row.contact_attempt_count > 1 && <span> ({row.contact_attempt_count} attempts)</span>}
          </>
        ) : (
          <span style={{ color: "var(--danger-text)", fontWeight: 500 }}>No contact attempts yet</span>
        )}
      </div>

      {/* Row 5: Action buttons */}
      {!isLogging && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.625rem", flexWrap: "wrap" }}>
          {phoneDisplay && (
            <Button
              variant="primary"
              size="sm"
              icon="phone"
              onClick={() => {
                window.open(`tel:${row.phone}`, "_self");
                onStartLog();
                setLogMethod("call");
              }}
              style={{ borderRadius: 8, minHeight: 36 }}
            >
              Call
            </Button>
          )}
          {phoneDisplay && (
            <Button
              variant="outline"
              size="sm"
              icon="message-square"
              onClick={() => {
                window.open(`sms:${row.phone}?body=${smsBody}`, "_self");
                onStartLog();
                setLogMethod("text");
              }}
              style={{ borderRadius: 8, minHeight: 36 }}
            >
              Text
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="check"
            onClick={onMarkReturned}
            style={{ borderRadius: 8, minHeight: 36 }}
          >
            Returned
          </Button>
          {!phoneDisplay && (
            <Button
              variant="ghost"
              size="sm"
              icon="edit"
              onClick={() => { onStartLog(); setLogMethod("call"); }}
              style={{ borderRadius: 8, minHeight: 36 }}
            >
              Log Attempt
            </Button>
          )}
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
