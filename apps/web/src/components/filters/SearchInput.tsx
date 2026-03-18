"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { COLORS, BORDERS, TYPOGRAPHY, TRANSITIONS } from "@/lib/design-tokens";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onDebouncedChange: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  size?: "sm" | "md";
}

const sizeStyles = {
  sm: { padding: "0.3rem 0.75rem", fontSize: TYPOGRAPHY.size.xs, height: "1.875rem" },
  md: { padding: "0.375rem 0.875rem", fontSize: TYPOGRAPHY.size.sm, height: "2.25rem" },
} as const;

export function SearchInput({
  value,
  onChange,
  onDebouncedChange,
  debounceMs = 300,
  placeholder = "Search...",
  size = "sm",
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const isExternalUpdate = useRef(false);

  // Sync from parent when value changes externally (e.g. clear filters)
  useEffect(() => {
    if (value !== localValue) {
      isExternalUpdate.current = true;
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = useCallback(
    (newValue: string) => {
      isExternalUpdate.current = false;
      setLocalValue(newValue);
      onChange(newValue);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onDebouncedChange(newValue);
      }, debounceMs);
    },
    [onChange, onDebouncedChange, debounceMs],
  );

  const handleClear = useCallback(() => {
    handleChange("");
    // Fire debounced immediately on clear
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onDebouncedChange("");
  }, [handleChange, onDebouncedChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const sz = sizeStyles[size];

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {/* Search icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ position: "absolute", left: "0.625rem", pointerEvents: "none", stroke: "var(--text-tertiary)" }}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>

      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: sz.padding,
          paddingLeft: "2rem",
          paddingRight: localValue ? "2rem" : "0.75rem",
          fontSize: sz.fontSize,
          height: sz.height,
          color: "var(--text-primary)",
          backgroundColor: "var(--card-bg, #fff)",
          border: "1px solid var(--border-default)",
          borderRadius: BORDERS.radius.full,
          outline: "none",
          transition: `border-color ${TRANSITIONS.fast}`,
          minWidth: "200px",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = COLORS.primary)}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
      />

      {/* Clear button */}
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          style={{
            position: "absolute",
            right: "0.5rem",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.125rem",
            height: "1.125rem",
            padding: 0,
            border: "none",
            borderRadius: BORDERS.radius.full,
            background: "var(--border-default)",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "0.75rem",
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      )}
    </div>
  );
}
