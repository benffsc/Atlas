/**
 * Badge components and utility functions for the intake queue.
 * Extracted from queue/page.tsx (FFS-110).
 * Badge standardization applied (FFS-112): 3 visual tiers.
 */

import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";
import { formatEnum, TRIAGE_LABELS, KITTEN_PRIORITY_LABELS, getKittenPriorityTier } from "@/lib/display-labels";

// Consistent badge styling
const badgeBase: React.CSSProperties = {
  fontSize: TYPOGRAPHY.size['2xs'],
  padding: `2px ${SPACING.sm}`,
  borderRadius: BORDERS.radius.md,
  fontWeight: TYPOGRAPHY.weight.medium,
  display: "inline-block",
  lineHeight: 1.4,
};

export function TriageBadge({ category, score, isLegacy }: { category: string | null; score: number | null; isLegacy: boolean }) {
  if (!category && isLegacy) {
    return (
      <span style={{ ...badgeBase, background: COLORS.gray500, color: COLORS.white }}>
        Legacy
      </span>
    );
  }

  if (!category) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    high_priority_tnr: { bg: COLORS.error, color: COLORS.white },
    standard_tnr: { bg: COLORS.primary, color: COLORS.white },
    wellness_only: { bg: COLORS.success, color: COLORS.black },
    owned_cat_low: { bg: COLORS.gray500, color: COLORS.white },
    out_of_county: { bg: COLORS.gray400, color: COLORS.black },
    needs_review: { bg: COLORS.warning, color: COLORS.black },
  };
  const style = colors[category] || { bg: COLORS.gray500, color: COLORS.white };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{ ...badgeBase, background: style.bg, color: style.color }}>
        {formatEnum(category, TRIAGE_LABELS)}
      </span>
      {score !== null && (
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {score}
        </span>
      )}
    </div>
  );
}

export function KittenPriorityBadge({ score, hasKittens }: { score: number | null; hasKittens: boolean | null }) {
  if (!hasKittens) return null;

  const tier = getKittenPriorityTier(score);
  if (!tier) {
    // has_kittens but no score — fallback to old "+kittens" display
    return (
      <span style={{ fontSize: TYPOGRAPHY.size['2xs'], color: COLORS.warning }}>+kittens</span>
    );
  }

  const tierInfo = KITTEN_PRIORITY_LABELS[tier];
  return (
    <span
      style={{
        ...badgeBase,
        background: tierInfo.color,
        color: "#fff",
      }}
      title={`Kitten priority score: ${score}/100`}
    >
      Kitten: {tierInfo.label} ({score})
    </span>
  );
}

/**
 * FFS-1187 — Service area status badge.
 * Hidden when status is 'in', 'unknown', or null.
 * Shows REDIRECTED when email has been sent.
 */
export function ServiceAreaBadge({
  status,
  emailSentAt,
}: {
  status: "in" | "ambiguous" | "out" | "unknown" | null | undefined;
  emailSentAt?: string | null;
}) {
  if (!status || status === "in" || status === "unknown") return null;

  // Email already sent → green "REDIRECTED" badge
  if (status === "out" && emailSentAt) {
    return (
      <span style={{ ...badgeBase, background: COLORS.success, color: COLORS.white }}>
        REDIRECTED
      </span>
    );
  }

  const colors: Record<
    "ambiguous" | "out",
    { bg: string; color: string; label: string }
  > = {
    out: { bg: COLORS.error, color: COLORS.white, label: "OUT OF AREA" },
    ambiguous: { bg: COLORS.warning, color: COLORS.black, label: "BOUNDARY" },
  };
  const style = colors[status];
  return (
    <span style={{ ...badgeBase, background: style.bg, color: style.color }}>
      {style.label}
    </span>
  );
}

export function SubmissionStatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, { bg: string; color: string; label: string }> = {
    "new": { bg: COLORS.primary, color: COLORS.white, label: "New" },
    "in_progress": { bg: COLORS.warning, color: COLORS.black, label: "In Progress" },
    "scheduled": { bg: COLORS.success, color: COLORS.white, label: "Scheduled" },
    "complete": { bg: COLORS.successLight, color: COLORS.black, label: "Complete" },
    "archived": { bg: COLORS.gray500, color: COLORS.white, label: "Archived" },
  };
  const style = colors[status || "new"] || { bg: COLORS.gray500, color: COLORS.white, label: status || "Unknown" };

  return (
    <span style={{ ...badgeBase, background: style.bg, color: style.color }}>
      {style.label}
    </span>
  );
}

export function LegacyStatusBadge({ status }: { status: string | null }) {
  const displayStatus = status || "New";

  const colors: Record<string, { bg: string; color: string }> = {
    "New": { bg: COLORS.info, color: COLORS.black },
    "Pending Review": { bg: COLORS.warning, color: COLORS.black },
    "Booked": { bg: COLORS.success, color: COLORS.white },
    "Declined": { bg: COLORS.error, color: COLORS.white },
    "Complete": { bg: COLORS.successLight, color: COLORS.black },
  };
  const style = colors[displayStatus] || { bg: COLORS.gray500, color: COLORS.white };

  return (
    <span style={{ ...badgeBase, background: style.bg, color: style.color }}>
      {displayStatus}
    </span>
  );
}

export function ContactStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const shortLabel: Record<string, string> = {
    "Contacted": "Contacted",
    "Contacted multiple times": "Multiple attempts",
    "Call/Email/No response": "No response",
    "An appointment has been booked": "Appt booked",
    "Out of County - no appts avail": "Out of County",
    "Sent to Diane/Out of County": "Sent to Diane",
  };

  return (
    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
      {shortLabel[status] || status}
    </span>
  );
}

export function formatAge(age: unknown): string {
  if (!age) return "";
  const ageStr = typeof age === "string" ? age : String(age);

  const daysMatch = ageStr.match(/(\d+)\s+days?/);
  const timeMatch = ageStr.match(/(\d+):(\d+):(\d+)/);

  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    if (days >= 7) return `${Math.floor(days / 7)}w ${days % 7}d`;
    return `${days}d`;
  }

  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h`;
    return `${parseInt(timeMatch[2])}m`;
  }

  return ageStr;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

export function normalizeName(name: string | null): string {
  if (!name) return "";
  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    return name
      .toLowerCase()
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return name;
}
