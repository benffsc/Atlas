"use client";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Placeholder shown as the first disabled option */
  placeholder?: string;
  size?: "sm" | "md";
  /** Full width */
  fullWidth?: boolean;
  "aria-label"?: string;
}

/**
 * Consistent select dropdown matching the control height scale.
 * FFS-1282 / Dom Design: replaces duplicated selectStyle objects.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  size = "sm",
  fullWidth,
  "aria-label": ariaLabel,
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      style={{
        height: size === "sm" ? "var(--control-height-sm)" : "var(--control-height)",
        padding: size === "sm" ? "0 0.5rem" : "0 0.75rem",
        fontSize: size === "sm" ? "0.75rem" : "0.85rem",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "9999px",
        background: "var(--card-bg, #fff)",
        color: value ? "var(--text-primary, #111827)" : "var(--text-muted, #6b7280)",
        cursor: "pointer",
        width: fullWidth ? "100%" : "auto",
        minWidth: 0,
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
