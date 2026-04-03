"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";

interface PersonLookupResult {
  found: boolean;
  person_id: string | null;
  display_name: string | null;
  first_name: string | null;
  context: {
    open_request_count: number;
    completed_request_count: number;
    trapper_type: string | null;
    last_visit_date: string | null;
    has_previous_pet_spay: boolean;
  } | null;
}

interface KioskWelcomeBackProps {
  lookupResult: PersonLookupResult;
  /** Called after auto-advance delay or on tap */
  onContinue: () => void;
  /** Auto-advance delay in ms (0 = no auto-advance) */
  autoAdvanceMs?: number;
}

/**
 * Contextual greeting after person lookup in the clinic kiosk flow.
 * Shows personalized welcome if person found, generic greeting otherwise.
 * Auto-advances after delay or on tap.
 *
 * FFS-1103
 */
export function KioskWelcomeBack({
  lookupResult,
  onContinue,
  autoAdvanceMs = 2500,
}: KioskWelcomeBackProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (autoAdvanceMs > 0) {
      timerRef.current = setTimeout(onContinue, autoAdvanceMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoAdvanceMs, onContinue]);

  const { found, display_name, first_name, context } = lookupResult;
  const name = first_name || display_name?.split(" ")[0] || null;

  return (
    <button
      onClick={onContinue}
      aria-label="Continue"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: "1.25rem",
        paddingTop: "3rem",
        paddingBottom: "2rem",
        background: "none",
        border: "none",
        cursor: "pointer",
        width: "100%",
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Avatar circle */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: found
            ? "var(--success-bg, rgba(34,197,94,0.1))"
            : "var(--primary-bg, rgba(59,130,246,0.08))",
          border: `2px solid ${found ? "var(--success-text, #16a34a)" : "var(--primary)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={found ? "user-check" : "cat"}
          size={36}
          color={found ? "var(--success-text, #16a34a)" : "var(--primary)"}
        />
      </div>

      {/* Greeting */}
      <div>
        <h2
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
            lineHeight: 1.2,
          }}
        >
          {found && name ? `Welcome back, ${name}!` : "Welcome!"}
        </h2>

        {/* Context line */}
        {found && context && (
          <p
            style={{
              fontSize: "1rem",
              color: "var(--text-secondary)",
              margin: 0,
              lineHeight: 1.5,
              maxWidth: 360,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {context.trapper_type
              ? "Thanks for volunteering with us!"
              : context.open_request_count > 0
                ? `You have ${context.open_request_count} open request${context.open_request_count > 1 ? "s" : ""}.`
                : context.completed_request_count > 0
                  ? "Good to see you again!"
                  : "Let\u2019s get you set up."}
          </p>
        )}

        {!found && (
          <p
            style={{
              fontSize: "1rem",
              color: "var(--text-secondary)",
              margin: 0,
            }}
          >
            Let&apos;s get started.
          </p>
        )}
      </div>

      {/* Tap to continue hint */}
      <p
        style={{
          fontSize: "0.8rem",
          color: "var(--muted)",
          margin: 0,
          marginTop: "1rem",
        }}
      >
        Tap anywhere to continue
      </p>
    </button>
  );
}

export type { PersonLookupResult };
