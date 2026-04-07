"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";

interface KioskWizardShellProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  canGoNext: boolean;
  nextLabel?: string;
  showBack?: boolean;
  /** Optional header banner rendered above the progress dots (e.g. phone-intake staff banner). */
  headerBanner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Wizard shell for kiosk multi-step forms.
 * Touch-friendly progress dots, full-width Back/Next buttons.
 * Scrolls to top on step change.
 */
export function KioskWizardShell({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  canGoNext,
  nextLabel = "Next",
  showBack = true,
  headerBanner,
  children,
}: KioskWizardShellProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to top on step change
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep]);

  return (
    <div
      ref={contentRef}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        padding: "1.5rem",
        maxWidth: 500,
        margin: "0 auto",
        gap: "1.5rem",
      }}
    >
      {/* Optional banner (e.g. phone-intake staff mode) */}
      {headerBanner}

      {/* Progress dots */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          padding: "0.5rem 0",
        }}
      >
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            style={{
              width: i === currentStep ? 24 : 10,
              height: 10,
              borderRadius: 5,
              background:
                i === currentStep
                  ? "var(--primary)"
                  : i < currentStep
                    ? "var(--primary)"
                    : "var(--card-border, #e5e7eb)",
              opacity: i < currentStep ? 0.5 : 1,
              transition: "all 200ms ease",
            }}
          />
        ))}
      </div>

      {/* Step content */}
      <div style={{ flex: 1 }}>{children}</div>

      {/* Navigation buttons */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {showBack && currentStep > 0 && (
          <Button
            variant="outline"
            size="lg"
            onClick={onBack}
            style={{
              flex: 1,
              minHeight: 56,
              borderRadius: 14,
              fontSize: "1.05rem",
            }}
          >
            Back
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          onClick={onNext}
          disabled={!canGoNext}
          style={{
            flex: showBack && currentStep > 0 ? 2 : 1,
            minHeight: 56,
            borderRadius: 14,
            fontSize: "1.05rem",
          }}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
