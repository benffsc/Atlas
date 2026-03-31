"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { IndirectQuestion } from "@/lib/kiosk-questions";

interface KioskQuestionCardProps {
  question: IndirectQuestion;
  selectedValue: string | undefined;
  onSelect: (value: string) => void;
  /** Auto-advance delay in ms after selection (0 = no auto-advance) */
  autoAdvanceMs?: number;
  onAutoAdvance?: () => void;
}

/**
 * Renders one IndirectQuestion as large touchable option cards.
 * Tap an option → brief highlight → optional auto-advance after delay.
 * Locked for duration of auto-advance to prevent double-tap issues.
 */
export function KioskQuestionCard({
  question,
  selectedValue,
  onSelect,
  autoAdvanceMs = 400,
  onAutoAdvance,
}: KioskQuestionCardProps) {
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [locked, setLocked] = useState(false);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  // Reset lock when question changes (new screen)
  useEffect(() => {
    setLocked(false);
  }, [question.id]);

  const handleSelect = useCallback(
    (value: string) => {
      if (locked) return;
      onSelect(value);

      // Auto-advance after brief highlight — lock to prevent double-tap
      if (autoAdvanceMs > 0 && onAutoAdvance) {
        setLocked(true);
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = setTimeout(() => {
          onAutoAdvance();
          setLocked(false);
        }, autoAdvanceMs);
      }
    },
    [onSelect, autoAdvanceMs, onAutoAdvance, locked],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h2
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 0.25rem",
            lineHeight: 1.3,
          }}
        >
          {question.text}
        </h2>
        {question.help_text && (
          <p
            style={{
              fontSize: "0.9rem",
              color: "var(--text-secondary)",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {question.help_text}
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {question.options.map((option) => {
          const isSelected = selectedValue === option.value;
          return (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              aria-pressed={isSelected}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.875rem",
                padding: "1rem 1.25rem",
                minHeight: 64,
                background: isSelected
                  ? "var(--primary-bg, rgba(59,130,246,0.08))"
                  : "var(--card-bg, #fff)",
                border: isSelected
                  ? "2px solid var(--primary)"
                  : "2px solid var(--card-border, #e5e7eb)",
                borderRadius: 14,
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                fontFamily: "inherit",
                WebkitTapHighlightColor: "transparent",
                transition: "border-color 150ms ease, background 150ms ease",
              }}
            >
              {option.icon && (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: isSelected
                      ? "var(--primary)"
                      : "var(--muted-bg, #f3f4f6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 150ms ease",
                  }}
                >
                  <Icon
                    name={option.icon}
                    size={20}
                    color={isSelected ? "#fff" : "var(--text-secondary)"}
                  />
                </div>
              )}
              <span
                style={{
                  fontSize: "1.05rem",
                  fontWeight: isSelected ? 600 : 500,
                  color: isSelected ? "var(--primary)" : "var(--text-primary)",
                  lineHeight: 1.3,
                }}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
