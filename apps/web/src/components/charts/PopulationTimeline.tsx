"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface PopulationEvent {
  event_type: "birth" | "death";
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

interface PopulationTimelineProps {
  placeId: string;
}

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
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch(`/api/places/${placeId}/population-events`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
          setSummary(data.summary || null);
        }
      } catch (err) {
        console.error("Error fetching population events:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchEvents();
  }, [placeId]);

  if (loading) {
    return <div className="text-muted">Loading population events...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-muted" style={{ padding: "1rem", textAlign: "center" }}>
        No birth or death events recorded for this location.
      </div>
    );
  }

  const visibleEvents = showAll ? events : events.slice(0, 10);

  return (
    <div>
      {/* Summary Stats */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              textAlign: "center",
              padding: "0.75rem",
              background: "#d1fae5",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#065f46" }}>
              {summary.total_births}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#065f46" }}>Total Births</div>
          </div>
          <div
            style={{
              textAlign: "center",
              padding: "0.75rem",
              background: "#fee2e2",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#991b1b" }}>
              {summary.total_deaths}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#991b1b" }}>Total Deaths</div>
          </div>
          <div
            style={{
              textAlign: "center",
              padding: "0.75rem",
              background: "#f3f4f6",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
              {summary.births_this_year - summary.deaths_this_year >= 0 ? "+" : ""}
              {summary.births_this_year - summary.deaths_this_year}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>Net (This Year)</div>
          </div>
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
            background: "#e5e7eb",
          }}
        />

        {visibleEvents.map((event) => (
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
                background: event.event_type === "birth" ? "#10b981" : "#ef4444",
                border: "2px solid #fff",
                boxShadow: "0 0 0 2px " + (event.event_type === "birth" ? "#d1fae5" : "#fee2e2"),
              }}
            />

            {/* Event content */}
            <div
              style={{
                padding: "0.75rem",
                background: event.event_type === "birth" ? "#f0fdf4" : "#fef2f2",
                borderRadius: "8px",
                borderLeft: `3px solid ${event.event_type === "birth" ? "#10b981" : "#ef4444"}`,
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
                      background: event.event_type === "birth" ? "#10b981" : "#ef4444",
                      color: "#fff",
                      marginRight: "0.5rem",
                    }}
                  >
                    {event.event_type === "birth" ? "BIRTH" : "DEATH"}
                  </span>
                  <Link
                    href={`/cats/${event.cat_id}`}
                    style={{ fontWeight: 500, color: "#0d6efd" }}
                  >
                    {event.cat_name || "Unknown cat"}
                  </Link>
                </div>
                <span className="text-muted text-sm">
                  {formatDate(event.event_date || event.created_at)}
                </span>
              </div>
              {event.details && (
                <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "#6b7280" }}>
                  {event.details.replace(/_/g, " ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Show more/less */}
      {events.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          style={{
            width: "100%",
            padding: "0.5rem",
            background: "transparent",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.85rem",
            color: "#6b7280",
          }}
        >
          {showAll ? "Show less" : `Show ${events.length - 10} more events`}
        </button>
      )}
    </div>
  );
}
