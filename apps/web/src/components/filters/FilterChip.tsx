"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

interface FilterChipOption {
  value: string;
  label: string;
}

interface FilterChipProps {
  label: string;
  options: FilterChipOption[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Filter chip — pill button with + icon that opens a dropdown.
 * Single-select: clicking an option selects it and closes the dropdown.
 * Clicking the active chip again clears the filter.
 */
export function FilterChip({ label, options, value, onChange }: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const activeOption = options.find((o) => o.value === value);
  const isActive = !!value;

  return (
    <div ref={ref} className="filter-chip-wrapper">
      <button
        className={`filter-chip ${isActive ? "filter-chip--active" : ""}`}
        onClick={() => {
          if (isActive) {
            onChange("");
          } else {
            setOpen(!open);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        type="button"
      >
        {isActive ? (
          <>
            <span className="filter-chip__label">{label}: {activeOption?.label || value}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="filter-chip__label">{label}</span>
          </>
        )}
      </button>

      {open && (
        <div className="filter-chip__dropdown" role="listbox" aria-label={`${label} options`}>
          {options.map((opt) => (
            <button
              key={opt.value}
              role="option"
              aria-selected={value === opt.value}
              className={`filter-chip__option ${value === opt.value ? "filter-chip__option--selected" : ""}`}
              onClick={() => {
                onChange(value === opt.value ? "" : opt.value);
                setOpen(false);
              }}
              type="button"
            >
              <span className="filter-chip__checkbox">
                {value === opt.value && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
