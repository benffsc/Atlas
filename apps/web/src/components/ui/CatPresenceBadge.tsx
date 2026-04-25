"use client";

type PresenceStatus = "current" | "departed" | "presumed_departed" | "unknown";

interface CatPresenceBadgeProps {
  status: PresenceStatus;
  departureReason?: string | null;
  departedAt?: string | null;
  /** Dot only (no label) */
  compact?: boolean;
}

const DEPARTURE_LABELS: Record<string, string> = {
  adopted: "Adopted",
  relocated: "Relocated",
  transferred: "In Custody",
  deceased: "Deceased",
  in_foster: "In Foster",
};

function formatDepartureLabel(reason?: string | null, departedAt?: string | null): string {
  const label = reason ? DEPARTURE_LABELS[reason] || reason : "Departed";
  if (departedAt) {
    try {
      const d = new Date(departedAt);
      return `${label} ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
    } catch {
      return label;
    }
  }
  return label;
}

function getPresenceLabel(status: PresenceStatus, departureReason?: string | null, departedAt?: string | null): string {
  switch (status) {
    case "current":
      return "Present";
    case "departed":
      return formatDepartureLabel(departureReason, departedAt);
    case "presumed_departed":
      if (departedAt) {
        try {
          const year = new Date(departedAt).getFullYear();
          return `Not seen since ${year}`;
        } catch {
          return "Presumed gone";
        }
      }
      return "Presumed gone";
    case "unknown":
    default:
      return "Uncertain";
  }
}

const DOT_STYLES: Record<PresenceStatus, React.CSSProperties> = {
  current: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--success-text, #059669)",
    flexShrink: 0,
  },
  unknown: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--warning-text, #d97706)",
    flexShrink: 0,
  },
  departed: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--muted, #737373)",
    flexShrink: 0,
  },
  presumed_departed: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--muted, #737373)",
    opacity: 0.6,
    flexShrink: 0,
  },
};

const LABEL_STYLES: Record<PresenceStatus, React.CSSProperties> = {
  current: { color: "var(--success-text, #059669)", fontSize: "0.7rem", fontWeight: 500 },
  unknown: { color: "var(--warning-text, #d97706)", fontSize: "0.7rem", fontWeight: 500 },
  departed: { color: "var(--muted, #737373)", fontSize: "0.7rem", fontWeight: 500 },
  presumed_departed: { color: "var(--muted, #737373)", fontSize: "0.7rem", fontWeight: 500, opacity: 0.7 },
};

export function CatPresenceBadge({ status, departureReason, departedAt, compact }: CatPresenceBadgeProps) {
  const label = getPresenceLabel(status, departureReason, departedAt);

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      title={label}
    >
      <span style={DOT_STYLES[status]} />
      {!compact && <span style={LABEL_STYLES[status]}>{label}</span>}
    </span>
  );
}

/** Utility: group cats by presence for rendering sections */
export function groupCatsByPresence<T extends { presence_status?: string }>(
  cats: T[]
): { present: T[]; uncertain: T[]; departed: T[] } {
  const present: T[] = [];
  const uncertain: T[] = [];
  const departed: T[] = [];

  for (const cat of cats) {
    switch (cat.presence_status) {
      case "current":
        present.push(cat);
        break;
      case "departed":
      case "presumed_departed":
        departed.push(cat);
        break;
      default:
        uncertain.push(cat);
        break;
    }
  }

  return { present, uncertain, departed };
}

/** Utility: summarize departure reasons for collapsed view */
export function summarizeDepartures<T extends { departure_reason?: string | null }>(
  cats: T[]
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const cat of cats) {
    const reason = cat.departure_reason || "unknown";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({
      reason: DEPARTURE_LABELS[reason] || reason,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
