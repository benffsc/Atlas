"use client";

export type EntryMode = "phone" | "paper" | "complete";

interface EntryModeSelectorProps {
  value: EntryMode;
  onChange: (mode: EntryMode) => void;
}

const MODES: { value: EntryMode; label: string; description: string; icon: string }[] = [
  {
    value: "phone",
    label: "Phone Intake",
    description: "Taking a call, entering info in real-time",
    icon: "📞",
  },
  {
    value: "paper",
    label: "Paper Entry",
    description: "Transcribing a filled paper call sheet",
    icon: "📋",
  },
  {
    value: "complete",
    label: "Quick Complete",
    description: "Recording finished field work",
    icon: "✅",
  },
];

export default function EntryModeSelector({ value, onChange }: EntryModeSelectorProps) {
  return (
    <div style={{
      background: "var(--bg-secondary, #f9fafb)",
      borderRadius: "10px",
      padding: "1rem",
      border: "1px solid var(--border, #e5e7eb)",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "0.5rem",
      }}>
        {MODES.map((mode) => {
          const isActive = value === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => onChange(mode.value)}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "0.75rem 0.5rem",
                borderRadius: "8px",
                border: `2px solid ${isActive ? "var(--primary, #2563eb)" : "var(--border, #e5e7eb)"}`,
                background: isActive ? "var(--primary, #2563eb)" : "var(--background, #fff)",
                color: isActive ? "#fff" : "var(--foreground)",
                cursor: "pointer",
                transition: "all 150ms",
              }}
            >
              <span style={{ fontSize: "1.25rem", marginBottom: "0.25rem" }}>{mode.icon}</span>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{mode.label}</span>
              <span style={{
                fontSize: "0.7rem",
                marginTop: "2px",
                opacity: 0.8,
                textAlign: "center",
                lineHeight: 1.3,
              }}>
                {mode.description}
              </span>
            </button>
          );
        })}
      </div>

      {value === "complete" && (
        <div style={{
          marginTop: "0.75rem",
          padding: "0.75rem",
          background: "var(--success-bg, #d4edda)",
          border: "1px solid var(--success-border, #28a745)",
          borderRadius: "6px",
          fontSize: "0.85rem",
          color: "var(--success-text, #155724)",
        }}>
          <strong>Quick Complete mode:</strong> This will create a request and immediately mark it as completed.
          Use this for field work that has already been finished.
        </div>
      )}
    </div>
  );
}
