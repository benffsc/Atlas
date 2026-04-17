"use client";

import { useRef, useCallback, type KeyboardEvent } from "react";
import { COLORS, BORDERS, TYPOGRAPHY, TRANSITIONS } from "@/lib/design-tokens";

export interface ToggleOption {
  value: string;
  label: string;
  color?: string;
  count?: number;
}

interface ToggleButtonGroupProps {
  options: ToggleOption[];
  value: string;
  onChange: (value: string) => void;
  mode?: "single" | "multi";
  allowDeselect?: boolean;
  defaultValue?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
}

const sizeStyles = {
  sm: { padding: "0 0.625rem", fontSize: TYPOGRAPHY.size.xs, height: "var(--control-height-sm)" },
  md: { padding: "0 0.75rem", fontSize: TYPOGRAPHY.size.sm, height: "var(--control-height)" },
} as const;

export function ToggleButtonGroup({
  options,
  value,
  onChange,
  mode = "single",
  allowDeselect = false,
  defaultValue = "",
  size = "sm",
  "aria-label": ariaLabel,
}: ToggleButtonGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const activeValues = new Set(value ? value.split(",").filter(Boolean) : []);

  const handleClick = useCallback(
    (optionValue: string) => {
      if (mode === "single") {
        if (activeValues.has(optionValue) && allowDeselect) {
          onChange(defaultValue);
        } else {
          onChange(optionValue);
        }
      } else {
        const next = new Set(activeValues);
        if (next.has(optionValue)) {
          next.delete(optionValue);
        } else {
          next.add(optionValue);
        }
        onChange(Array.from(next).join(","));
      }
    },
    [mode, value, allowDeselect, defaultValue, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("button");
      if (!buttons?.length) return;

      const current = Array.from(buttons).indexOf(e.target as HTMLButtonElement);
      if (current === -1) return;

      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (current + 1) % buttons.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (current - 1 + buttons.length) % buttons.length;
      }

      if (next >= 0) {
        e.preventDefault();
        buttons[next].focus();
        if (mode === "single") {
          handleClick(options[next].value);
        }
      }
    },
    [options, mode, handleClick],
  );

  const isSingle = mode === "single";
  const sz = sizeStyles[size];

  return (
    <div
      ref={groupRef}
      role={isSingle ? "radiogroup" : "group"}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      style={{ display: "inline-flex", gap: "0.25rem", flexWrap: "wrap" }}
    >
      {options.map((opt) => {
        const isActive = activeValues.has(opt.value);
        const activeColor = opt.color || COLORS.primary;

        return (
          <button
            key={opt.value}
            type="button"
            role={isSingle ? "radio" : undefined}
            aria-checked={isSingle ? isActive : undefined}
            aria-pressed={!isSingle ? isActive : undefined}
            tabIndex={isSingle ? (isActive || (!value && opt === options[0]) ? 0 : -1) : 0}
            onClick={() => handleClick(opt.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: sz.padding,
              fontSize: sz.fontSize,
              fontWeight: isActive ? 600 : 400,
              lineHeight: 1.4,
              color: isActive ? "#fff" : "var(--text-primary)",
              backgroundColor: isActive ? activeColor : "transparent",
              border: `1px solid ${isActive ? activeColor : "var(--border-default)"}`,
              borderRadius: BORDERS.radius.full,
              cursor: "pointer",
              transition: `all ${TRANSITIONS.fast}`,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            {opt.label}
            {opt.count != null && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "1.25em",
                  padding: "0 0.3em",
                  fontSize: "0.8em",
                  fontWeight: 600,
                  lineHeight: 1,
                  color: isActive ? activeColor : "#fff",
                  backgroundColor: isActive ? "rgba(255,255,255,0.9)" : "var(--text-tertiary)",
                  borderRadius: BORDERS.radius.full,
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
