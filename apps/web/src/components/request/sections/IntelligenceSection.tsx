"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { TippyTicket } from "@/hooks/useRequestDetail";

const PRIORITY_STYLES: Record<string, { dot: string; label: string }> = {
  urgent: { dot: "#ef4444", label: "URGENT" },
  high: { dot: "#f59e0b", label: "HIGH" },
  normal: { dot: "#6b7280", label: "" },
  low: { dot: "#9ca3af", label: "" },
};

const TYPE_LABELS: Record<string, string> = {
  person_intel: "Person Intel",
  site_observation: "Site Observation",
  site_relationship: "Site Relationship",
  cat_return_context: "Cat Return",
  data_correction: "Data Correction",
  followup_needed: "Follow-up",
  general_intel: "Intel",
};

interface IntelligenceSectionProps {
  tickets: TippyTicket[];
}

export function IntelligenceSection({ tickets }: IntelligenceSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (tickets.length === 0) return null;

  const openTickets = tickets.filter(t => t.status !== "closed");
  const closedTickets = tickets.filter(t => t.status === "closed");

  return (
    <div style={{
      background: "var(--card-bg, #fff)",
      border: "1px solid var(--border, #e5e7eb)",
      borderRadius: "12px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "0.625rem 1rem",
        background: "#fefce8",
        borderBottom: "1px solid var(--border, #e5e7eb)",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}>
        <Icon name="lightbulb" size={16} color="#ca8a04" />
        <h3 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
          Field Intelligence
        </h3>
        {openTickets.length > 0 && (
          <span style={{
            fontSize: "0.7rem", fontWeight: 600, padding: "1px 8px",
            borderRadius: "10px", background: "#fef3c7", color: "#92400e",
          }}>
            {openTickets.length} open
          </span>
        )}
      </div>

      <div style={{ padding: "0.5rem" }}>
        {openTickets.map((ticket) => (
          <TicketRow
            key={ticket.ticket_id}
            ticket={ticket}
            isExpanded={expandedId === ticket.ticket_id}
            onToggle={() => setExpandedId(expandedId === ticket.ticket_id ? null : ticket.ticket_id)}
          />
        ))}
        {closedTickets.length > 0 && openTickets.length > 0 && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", padding: "0.25rem 0.5rem", borderTop: "1px solid var(--border)" }}>
            {closedTickets.length} resolved
          </div>
        )}
      </div>
    </div>
  );
}

function TicketRow({ ticket, isExpanded, onToggle }: {
  ticket: TippyTicket;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const priority = PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.normal;
  const typeLabel = TYPE_LABELS[ticket.ticket_type] || ticket.ticket_type;

  return (
    <div style={{
      padding: "0.5rem",
      borderRadius: "8px",
      marginBottom: "0.25rem",
      background: isExpanded ? "var(--section-bg, #f9fafb)" : "transparent",
      cursor: "pointer",
    }}
    onClick={onToggle}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        {/* Priority dot */}
        <span style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: priority.dot, flexShrink: 0, marginTop: "0.3rem",
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Summary line */}
          <div style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--foreground)", lineHeight: 1.4 }}>
            {priority.label && (
              <span style={{ fontSize: "0.65rem", fontWeight: 700, color: priority.dot, marginRight: "0.35rem" }}>
                {priority.label}
              </span>
            )}
            {ticket.summary || ticket.raw_input.slice(0, 120)}
          </div>

          {/* Meta row */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem", flexWrap: "wrap" }}>
            <span style={{
              fontSize: "0.65rem", padding: "0px 6px", borderRadius: "4px",
              background: "var(--bg-tertiary, #f3f4f6)", color: "var(--text-muted)",
            }}>
              {typeLabel}
            </span>
            {ticket.followup_date && (
              <span style={{ fontSize: "0.65rem", color: "#b45309" }}>
                Follow-up: {new Date(ticket.followup_date).toLocaleDateString()}
              </span>
            )}
            {ticket.tags.filter(t => !["montecito_corridor"].includes(t)).slice(0, 3).map(tag => (
              <span key={tag} style={{
                fontSize: "0.6rem", padding: "0px 5px", borderRadius: "4px",
                background: tag.includes("ingest_watch") ? "#fef2f2" : "var(--bg-tertiary)",
                color: tag.includes("ingest_watch") ? "#991b1b" : "var(--text-muted)",
                fontWeight: tag.includes("ingest_watch") ? 600 : 400,
              }}>
                {tag.replace(/_/g, " ")}
              </span>
            ))}
          </div>

          {/* Expanded: full raw_input */}
          {isExpanded && (
            <div style={{
              marginTop: "0.5rem", padding: "0.5rem",
              background: "var(--background, #fff)", borderRadius: "6px",
              border: "1px solid var(--border)", fontSize: "0.75rem",
              color: "var(--foreground)", whiteSpace: "pre-wrap", lineHeight: 1.5,
            }}>
              {ticket.raw_input}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", flexShrink: 0, marginTop: "0.15rem" }}>
          {isExpanded ? "▾" : "▸"}
        </span>
      </div>
    </div>
  );
}
