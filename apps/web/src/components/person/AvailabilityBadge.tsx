"use client";

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  on_leave: "On Leave",
};

const AVAILABILITY_STYLES: Record<string, { bg: string; color: string }> = {
  available: { bg: "#d1fae5", color: "#065f46" },
  busy: { bg: "#fef3c7", color: "#92400e" },
  on_leave: { bg: "#e5e7eb", color: "var(--text-secondary)" },
};

export { AVAILABILITY_LABELS, AVAILABILITY_STYLES };

export function AvailabilityBadge({
  status,
  onClick,
}: {
  status: string;
  onClick?: () => void;
}) {
  const style = AVAILABILITY_STYLES[status] || AVAILABILITY_STYLES.available;
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: style.bg,
        color: style.color,
        cursor: onClick ? "pointer" : "default",
      }}
      title={onClick ? "Click to change availability" : undefined}
    >
      {AVAILABILITY_LABELS[status] || status}
    </span>
  );
}
