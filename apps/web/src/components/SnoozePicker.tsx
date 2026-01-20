"use client";

interface SnoozePickerProps {
  onSelect: (until: string) => void;
  onClose: () => void;
}

export function SnoozePicker({ onSelect, onClose }: SnoozePickerProps) {
  const getSnoozeTime = (option: string): string => {
    const now = new Date();

    switch (option) {
      case "1hour":
        return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      case "3hours":
        return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
      case "tomorrow": {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        return tomorrow.toISOString();
      }
      case "nextweek": {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        nextWeek.setHours(9, 0, 0, 0);
        return nextWeek.toISOString();
      }
      default:
        return now.toISOString();
    }
  };

  const options = [
    { key: "1hour", label: "In 1 hour" },
    { key: "3hours", label: "In 3 hours" },
    { key: "tomorrow", label: "Tomorrow 9am" },
    { key: "nextweek", label: "Next week" },
  ];

  return (
    <>
      {/* Backdrop to close on outside click */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: "4px",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 100,
          minWidth: "140px",
        }}
      >
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onSelect(getSnoozeTime(opt.key))}
            style={{
              display: "block",
              width: "100%",
              padding: "0.5rem 0.75rem",
              fontSize: "0.8rem",
              textAlign: "left",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              color: "var(--foreground)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--card-bg, rgba(0,0,0,0.05))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}
