"use client";

/**
 * InsightsFeed — Natural-language insights for the dashboard hero.
 *
 * Renders 2-3 auto-generated observations based on the current dashboard
 * stats. Examples:
 *   - "3 items need your attention"
 *   - "12 active requests"
 *   - "47 cats this month (↑18% vs last)"
 *
 * Pattern: Tableau Pulse — "Today's Pulse" natural-language summary.
 * At-a-glance insight that tells a user the health of the system in 3
 * seconds without requiring them to parse numbers in isolation.
 *
 * Each insight is a compact row with icon + text. Renders inline (not
 * a card) so it sits naturally under the dashboard hero.
 *
 * Epic: FFS-1195 (Tier 2: Mission Visibility)
 */

import type { ReactNode } from "react";

interface Stats {
  active_requests?: number;
  needs_attention_total?: number;
  cats_this_month?: number;
  cats_last_month?: number;
  pending_intake?: number;
}

interface Insight {
  id: string;
  icon: ReactNode;
  text: ReactNode;
  tone: "info" | "warning" | "success" | "neutral";
}

function AttentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 6l-9.5 9.5-5-5L1 18" />
      <path d="M17 6h6v6" />
    </svg>
  );
}

function TrendDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 18l-9.5-9.5-5 5L1 6" />
      <path d="M17 18h6v-6" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}

export function InsightsFeed({ stats }: { stats: Stats | null }) {
  if (!stats) return null;

  const insights: Insight[] = [];

  // Attention priority first — this is what staff need to know first
  if (stats.needs_attention_total && stats.needs_attention_total > 0) {
    insights.push({
      id: "attention",
      icon: <AttentionIcon />,
      tone: "warning",
      text: (
        <>
          <strong>{stats.needs_attention_total}</strong>{" "}
          {stats.needs_attention_total === 1 ? "item needs" : "items need"} your attention
        </>
      ),
    });
  }

  // Active requests
  if (stats.active_requests && stats.active_requests > 0) {
    insights.push({
      id: "active",
      icon: <ActivityIcon />,
      tone: "info",
      text: (
        <>
          <strong>{stats.active_requests}</strong>{" "}
          {stats.active_requests === 1 ? "active request" : "active requests"} in progress
        </>
      ),
    });
  }

  // Pending intake
  if (stats.pending_intake && stats.pending_intake > 0) {
    insights.push({
      id: "intake",
      icon: <InboxIcon />,
      tone: "info",
      text: (
        <>
          <strong>{stats.pending_intake}</strong>{" "}
          {stats.pending_intake === 1 ? "intake" : "intakes"} awaiting review
        </>
      ),
    });
  }

  // This month trend — high-value insight about program health
  if (
    stats.cats_this_month != null &&
    stats.cats_last_month != null &&
    stats.cats_last_month > 0
  ) {
    const delta = Math.round(
      ((stats.cats_this_month - stats.cats_last_month) / stats.cats_last_month) * 100,
    );
    const isUp = delta > 0;
    const isDown = delta < 0;
    insights.push({
      id: "trend",
      icon: isDown ? <TrendDownIcon /> : <TrendUpIcon />,
      tone: isUp ? "success" : isDown ? "warning" : "neutral",
      text: (
        <>
          <strong>{stats.cats_this_month.toLocaleString()}</strong> cats altered this month
          {delta !== 0 && (
            <>
              {" "}
              (<span style={{ fontWeight: 600 }}>{isUp ? "↑" : "↓"}{Math.abs(delta)}%</span> vs
              last)
            </>
          )}
        </>
      ),
    });
  } else if (stats.cats_this_month && stats.cats_this_month > 0) {
    insights.push({
      id: "trend",
      icon: <TrendUpIcon />,
      tone: "success",
      text: (
        <>
          <strong>{stats.cats_this_month.toLocaleString()}</strong> cats altered this month
        </>
      ),
    });
  }

  if (insights.length === 0) {
    return null;
  }

  // Show at most 4 insights — prioritize "needs attention" + trend
  const displayed = insights.slice(0, 4);

  return (
    <div className="insights-feed" role="status" aria-live="polite" aria-label="Dashboard insights">
      {displayed.map((insight) => (
        <div key={insight.id} className={`insight-row insight-tone-${insight.tone}`}>
          <span className="insight-icon">{insight.icon}</span>
          <span className="insight-text">{insight.text}</span>
        </div>
      ))}
    </div>
  );
}
