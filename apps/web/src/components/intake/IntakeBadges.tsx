/**
 * Badge components and utility functions for the intake queue.
 * Extracted from queue/page.tsx (FFS-110).
 * Badge standardization applied (FFS-112): 3 visual tiers.
 */

// Consistent badge styling
const badgeBase: React.CSSProperties = {
  fontSize: "0.7rem",
  padding: "2px 8px",
  borderRadius: "4px",
  fontWeight: 500,
  display: "inline-block",
  lineHeight: 1.4,
};

export function TriageBadge({ category, score, isLegacy }: { category: string | null; score: number | null; isLegacy: boolean }) {
  if (!category && isLegacy) {
    return (
      <span style={{ ...badgeBase, background: "#6c757d", color: "#fff" }}>
        Legacy
      </span>
    );
  }

  if (!category) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    high_priority_tnr: { bg: "#dc3545", color: "#fff" },   // urgent tier
    standard_tnr: { bg: "#0d6efd", color: "#fff" },        // info tier
    wellness_only: { bg: "#20c997", color: "#000" },        // info tier
    owned_cat_low: { bg: "#6c757d", color: "#fff" },        // info tier
    out_of_county: { bg: "#adb5bd", color: "#000" },        // info tier
    needs_review: { bg: "#ffc107", color: "#000" },         // warning tier
  };
  const style = colors[category] || { bg: "#6c757d", color: "#fff" };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{ ...badgeBase, background: style.bg, color: style.color }}>
        {category.replace(/_/g, " ")}
      </span>
      {score !== null && (
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {score}
        </span>
      )}
    </div>
  );
}

export function SubmissionStatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, { bg: string; color: string; label: string }> = {
    "new": { bg: "#0d6efd", color: "#fff", label: "New" },
    "in_progress": { bg: "#fd7e14", color: "#000", label: "In Progress" },
    "scheduled": { bg: "#198754", color: "#fff", label: "Scheduled" },
    "complete": { bg: "#20c997", color: "#000", label: "Complete" },
    "archived": { bg: "#6c757d", color: "#fff", label: "Archived" },
  };
  const style = colors[status || "new"] || { bg: "#6c757d", color: "#fff", label: status || "Unknown" };

  return (
    <span style={{ ...badgeBase, background: style.bg, color: style.color }}>
      {style.label}
    </span>
  );
}

export function LegacyStatusBadge({ status }: { status: string | null }) {
  const displayStatus = status || "New";

  const colors: Record<string, { bg: string; color: string }> = {
    "New": { bg: "#0dcaf0", color: "#000" },
    "Pending Review": { bg: "#ffc107", color: "#000" },
    "Booked": { bg: "#198754", color: "#fff" },
    "Declined": { bg: "#dc3545", color: "#fff" },
    "Complete": { bg: "#20c997", color: "#000" },
  };
  const style = colors[displayStatus] || { bg: "#6c757d", color: "#fff" };

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
