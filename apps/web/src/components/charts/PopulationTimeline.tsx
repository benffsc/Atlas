"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import Link from "next/link";

type LifecycleEventType =
  | "birth" | "death"
  | "tnr_procedure" | "adoption" | "return_to_field"
  | "transfer" | "foster_start" | "foster_end" | "intake";

interface PopulationEvent {
  event_type: LifecycleEventType;
  event_id: string;
  event_date: string | null;
  cat_id: string;
  cat_name: string | null;
  details: string | null;
  source_system: string;
  created_at: string;
}

interface PopulationSummary {
  total_births: number;
  total_deaths: number;
  births_this_year: number;
  deaths_this_year: number;
}

interface OutcomeSummary {
  tnr_count: number;
  adoption_count: number;
  mortality_count: number;
  rtf_count: number;
  transfer_count: number;
  foster_count: number;
  intake_count: number;
  total_events: number;
}

interface PopulationTimelineProps {
  placeId: string;
}

// Event type display config — uses CSS variables per CLAUDE.md
const EVENT_CONFIG: Record<LifecycleEventType, { label: string; bg: string; border: string; text: string }> = {
  birth:           { label: "BIRTH",     bg: "var(--success-bg)", border: "var(--success-text)", text: "var(--success-text)" },
  death:           { label: "DEATH",     bg: "var(--danger-bg)",  border: "var(--danger-text)",  text: "var(--danger-text)" },
  tnr_procedure:   { label: "TNR",       bg: "var(--success-bg)", border: "var(--success-text)", text: "var(--success-text)" },
  adoption:        { label: "ADOPTED",   bg: "#f3e8ff",           border: "#7c3aed",             text: "#7c3aed" },
  return_to_field: { label: "RTF",       bg: "var(--info-bg)",    border: "var(--info-text)",    text: "var(--info-text)" },
  transfer:        { label: "TRANSFER",  bg: "#fff7ed",           border: "#c2410c",             text: "#c2410c" },
  foster_start:    { label: "FOSTER",    bg: "#f0fdfa",           border: "#0d9488",             text: "#0d9488" },
  foster_end:      { label: "FOSTER END",bg: "#f0fdfa",           border: "#0d9488",             text: "#0d9488" },
  intake:          { label: "INTAKE",    bg: "var(--bg-secondary)",border: "var(--muted)",        text: "var(--muted)" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown date";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PopulationTimeline({ placeId }: PopulationTimelineProps) {
  const [events, setEvents] = useState<PopulationEvent[]>([]);
  const [summary, setSummary] = useState<PopulationSummary | null>(null);
  const [outcomeSummary, setOutcomeSummary] = useState<OutcomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<LifecycleEventType>>(new Set());

  useEffect(() => {
    async function fetchEvents() {
      try {
        const data = await fetchApi<{
          events?: PopulationEvent[];
          summary?: PopulationSummary;
          outcome_summary?: OutcomeSummary;
        }>(`/api/places/${placeId}/population-events`);
        setEvents(data.events || []);
        setSummary(data.summary || null);
        setOutcomeSummary(data.outcome_summary || null);
      } catch (err) {
        console.error("Error fetching population events:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchEvents();
  }, [placeId]);

  if (loading) {
    return <div className="text-muted">Loading lifecycle events...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-muted" style={{ padding: "1rem", textAlign: "center" }}>
        No lifecycle events recorded for this location.
      </div>
    );
  }

  const filteredEvents = events.filter(e => !hiddenTypes.has(e.event_type));
  const visibleEvents = showAll ? filteredEvents : filteredEvents.slice(0, 10);

  // Unique event types present in data (for filter chips)
  const presentTypes = [...new Set(events.map(e => e.event_type))];

  const toggleType = (type: LifecycleEventType) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <div>
      {/* Outcome Summary Grid */}
      {outcomeSummary && outcomeSummary.total_events > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
            gap: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          {outcomeSummary.tnr_count > 0 && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--success-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--success-text)" }}>{outcomeSummary.tnr_count}</div>
              <div style={{ fontSize: "0.65rem", color: "var(--success-text)" }}>TNR</div>
            </div>
          )}
          {outcomeSummary.adoption_count > 0 && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "#f3e8ff", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#7c3aed" }}>{outcomeSummary.adoption_count}</div>
              <div style={{ fontSize: "0.65rem", color: "#7c3aed" }}>Adopted</div>
            </div>
          )}
          {outcomeSummary.rtf_count > 0 && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--info-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--info-text)" }}>{outcomeSummary.rtf_count}</div>
              <div style={{ fontSize: "0.65rem", color: "var(--info-text)" }}>RTF</div>
            </div>
          )}
          {outcomeSummary.transfer_count > 0 && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "#fff7ed", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#c2410c" }}>{outcomeSummary.transfer_count}</div>
              <div style={{ fontSize: "0.65rem", color: "#c2410c" }}>Transfer</div>
            </div>
          )}
          {outcomeSummary.foster_count > 0 && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "#f0fdfa", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#0d9488" }}>{outcomeSummary.foster_count}</div>
              <div style={{ fontSize: "0.65rem", color: "#0d9488" }}>Foster</div>
            </div>
          )}
          {outcomeSummary.mortality_count > 0 && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--danger-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--danger-text)" }}>{outcomeSummary.mortality_count}</div>
              <div style={{ fontSize: "0.65rem", color: "var(--danger-text)" }}>Mortality</div>
            </div>
          )}
          {summary && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--bg-secondary)", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                {summary.births_this_year - summary.deaths_this_year >= 0 ? "+" : ""}
                {summary.births_this_year - summary.deaths_this_year}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>Net (Year)</div>
            </div>
          )}
        </div>
      )}

      {/* Legacy summary when no outcome data */}
      {(!outcomeSummary || outcomeSummary.total_events === 0) && summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--success-bg)", borderRadius: "8px" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--success-text)" }}>{summary.total_births}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--success-text)" }}>Total Births</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--danger-bg)", borderRadius: "8px" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--danger-text)" }}>{summary.total_deaths}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--danger-text)" }}>Total Deaths</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--bg-secondary)", borderRadius: "8px" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
              {summary.births_this_year - summary.deaths_this_year >= 0 ? "+" : ""}
              {summary.births_this_year - summary.deaths_this_year}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Net (This Year)</div>
          </div>
        </div>
      )}

      {/* Filter Chips */}
      {presentTypes.length > 2 && (
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {presentTypes.map(type => {
            const config = EVENT_CONFIG[type];
            const isHidden = hiddenTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                style={{
                  padding: "0.2rem 0.5rem",
                  fontSize: "0.7rem",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: `1px solid ${isHidden ? "var(--border)" : config.border}`,
                  background: isHidden ? "transparent" : config.bg,
                  color: isHidden ? "var(--muted)" : config.text,
                  cursor: "pointer",
                  opacity: isHidden ? 0.5 : 1,
                }}
              >
                {config.label} ({events.filter(e => e.event_type === type).length})
              </button>
            );
          })}
        </div>
      )}

      {/* Timeline */}
      <div style={{ position: "relative", paddingLeft: "1.5rem" }}>
        {/* Vertical line */}
        <div
          style={{
            position: "absolute",
            left: "0.5rem",
            top: 0,
            bottom: 0,
            width: "2px",
            background: "var(--bg-secondary)",
          }}
        />

        {visibleEvents.map((event) => {
          const config = EVENT_CONFIG[event.event_type] || EVENT_CONFIG.intake;
          return (
            <div
              key={`${event.event_type}-${event.event_id}`}
              style={{
                position: "relative",
                marginBottom: "1rem",
                paddingLeft: "1rem",
              }}
            >
              {/* Timeline dot */}
              <div
                style={{
                  position: "absolute",
                  left: "-1.25rem",
                  top: "0.25rem",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  background: config.border,
                  border: "2px solid #fff",
                  boxShadow: `0 0 0 2px ${config.bg}`,
                }}
              />

              {/* Event content */}
              <div
                style={{
                  padding: "0.75rem",
                  background: config.bg,
                  borderRadius: "8px",
                  borderLeft: `3px solid ${config.border}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background: config.border,
                        color: "#fff",
                        marginRight: "0.5rem",
                      }}
                    >
                      {config.label}
                    </span>
                    <Link
                      href={`/cats/${event.cat_id}`}
                      style={{ fontWeight: 500, color: "var(--primary)" }}
                    >
                      {event.cat_name || "Unknown cat"}
                    </Link>
                  </div>
                  <span className="text-muted text-sm">
                    {formatDate(event.event_date || event.created_at)}
                  </span>
                </div>
                {event.details && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                    {event.details.replace(/_/g, " ")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Show more/less */}
      {filteredEvents.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          style={{
            width: "100%",
            padding: "0.5rem",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.85rem",
            color: "var(--muted)",
          }}
        >
          {showAll ? "Show less" : `Show ${filteredEvents.length - 10} more events`}
        </button>
      )}
    </div>
  );
}
