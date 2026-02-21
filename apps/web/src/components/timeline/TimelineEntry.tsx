"use client";

/**
 * TimelineEntry - Individual timeline entry for request history
 *
 * Displays a single event in the request timeline with:
 * - Icon based on event type
 * - Timestamp
 * - Description
 * - Optional staff name
 */

interface TimelineEntryProps {
  type: "status_change" | "assignment" | "note" | "site_visit" | "schedule" | "creation";
  timestamp: string;
  description: string;
  staffName?: string | null;
  metadata?: {
    fromStatus?: string;
    toStatus?: string;
    trapperName?: string;
  };
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  status_change: { icon: "→", color: "#3b82f6", label: "Status" },
  assignment: { icon: "👤", color: "#8b5cf6", label: "Assigned" },
  note: { icon: "📝", color: "#6b7280", label: "Note" },
  site_visit: { icon: "📍", color: "#22c55e", label: "Site Visit" },
  schedule: { icon: "📅", color: "#f59e0b", label: "Scheduled" },
  creation: { icon: "✨", color: "#10b981", label: "Created" },
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } else if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }
}

export function TimelineEntry({
  type,
  timestamp,
  description,
  staffName,
  metadata,
}: TimelineEntryProps) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.note;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: `${config.color}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {config.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 2,
          }}
        >
          <span style={{ fontWeight: 500, fontSize: 13, color: "#374151" }}>
            {description}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "#9ca3af",
          }}
        >
          <span>{formatTimestamp(timestamp)}</span>
          {staffName && (
            <>
              <span>•</span>
              <span>{staffName}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
