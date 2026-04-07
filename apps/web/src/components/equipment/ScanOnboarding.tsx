"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

const STORAGE_KEY = "equipment_scan_onboarding_done";

const STEPS = [
  {
    title: "Scan or Type",
    description: "Point a USB barcode scanner at the label, or type the 4-digit ID and press Enter.",
    icon: "scan-barcode",
  },
  {
    title: "Review Status",
    description: "You'll see the trap's status — who has it, how long it's been out, and its condition.",
    icon: "info",
  },
  {
    title: "Take Action",
    description: "Tap the big button for the most common action, or expand for more options.",
    icon: "mouse-pointer-click",
  },
];

interface ScanOnboardingProps {
  /** Force show (e.g. from "?" button) */
  forceShow?: boolean;
  onDismiss?: () => void;
}

/**
 * 3-step onboarding overlay for first-time scanner users.
 * Shows once, completion tracked in localStorage.
 */
export function ScanOnboarding({ forceShow, onDismiss }: ScanOnboardingProps) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      setStep(0);
      return;
    }
    if (typeof window !== "undefined") {
      const done = localStorage.getItem(STORAGE_KEY);
      if (!done) {
        setVisible(true);
      }
    }
  }, [forceShow]);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "true");
    }
    onDismiss?.();
  };

  if (!visible) return null;

  const current = STEPS[step];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "1rem",
      }}
      onClick={handleDismiss}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "16px",
          padding: "2rem",
          maxWidth: "360px",
          width: "100%",
          textAlign: "center",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step indicator dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i === step ? "var(--primary)" : "var(--border)",
                transition: "background 200ms",
              }}
            />
          ))}
        </div>

        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--info-bg)",
            border: "2px solid var(--info-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <Icon name={current.icon} size={28} color="var(--info-text)" />
        </div>

        <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.15rem", fontWeight: 700 }}>
          {current.title}
        </h3>
        <p style={{ margin: "0 0 1.5rem", fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {current.description}
        </p>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
          <Button variant="ghost" size="md" onClick={handleDismiss}>
            Skip
          </Button>
          <Button variant="primary" size="md" onClick={handleNext}>
            {step < STEPS.length - 1 ? "Next" : "Got it"}
          </Button>
        </div>
      </div>
    </div>
  );
}
