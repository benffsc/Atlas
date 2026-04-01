"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface BarcodeInputProps {
  onScan: (barcode: string) => void;
  loading?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Auto-focused barcode input that works with USB scanners and manual entry.
 * USB scanners act as keyboard wedge devices — they type characters rapidly then send Enter.
 * We detect scanner input by checking if characters arrive faster than 80ms apart.
 * For scanners that don't send Enter, we auto-submit after a 100ms gap in input.
 */
export function BarcodeInput({ onScan, loading, placeholder = "Scan barcode or type ID...", autoFocus = true }: BarcodeInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeyTime = useRef(0);
  const isScanner = useRef(false);
  // Debounce timer: fires when scanner stops sending characters (100ms gap)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cooldown: prevent rapid-fire submissions (300ms between scans)
  const lastScanTime = useRef(0);

  // Auto-focus on mount and after each scan
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus, loading]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleSubmit = useCallback((overrideValue?: string) => {
    const trimmed = (overrideValue ?? value).trim();
    if (!trimmed || loading) return;

    // Cooldown: ignore scans within 300ms of the last one
    const now = Date.now();
    if (now - lastScanTime.current < 300) return;
    lastScanTime.current = now;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    onScan(trimmed);
    setValue("");
    isScanner.current = false;
    // Re-focus for next scan
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [value, loading, onScan]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    const timeSinceLastKey = now - lastKeyTime.current;
    lastKeyTime.current = now;

    // Scanner sends characters very fast (<80ms between chars)
    if (timeSinceLastKey < 80 && value.length > 0) {
      isScanner.current = true;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
      return;
    }

    // Debounce: if we're in scanner mode, auto-submit after 100ms gap
    // (handles scanners that don't terminate with Enter)
    if (isScanner.current) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        // Read from the input directly to capture the latest value
        const currentValue = inputRef.current?.value.trim();
        if (currentValue && !loading) {
          onScan(currentValue);
          setValue("");
          isScanner.current = false;
          setTimeout(() => inputRef.current?.focus(), 100);
        }
        debounceTimer.current = null;
      }, 100);
    }
  }, [value, loading, onScan, handleSubmit]);

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={loading}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "1rem 1.25rem",
          fontSize: "1.25rem",
          fontFamily: "monospace",
          borderRadius: "12px",
          border: "2px solid var(--primary, #3b82f6)",
          outline: "none",
          boxSizing: "border-box",
          background: loading ? "var(--muted-bg, #f3f4f6)" : "var(--card-bg, #fff)",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--primary, #3b82f6)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.15)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--border, #d1d5db)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      {loading && (
        <div style={{
          position: "absolute",
          right: "1rem",
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: "0.9rem",
          color: "var(--muted)",
        }}>
          Looking up...
        </div>
      )}
      {!loading && value && (
        <button
          onClick={() => handleSubmit()}
          style={{
            position: "absolute",
            right: "0.5rem",
            top: "50%",
            transform: "translateY(-50%)",
            padding: "0.5rem 1rem",
            fontSize: "0.9rem",
            background: "var(--primary, #3b82f6)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Look Up
        </button>
      )}
    </div>
  );
}
