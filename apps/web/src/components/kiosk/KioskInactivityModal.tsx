"use client";

import { useEffect, useState, useCallback } from "react";

interface KioskInactivityModalProps {
  onDismiss: () => void;
  onTimeout: () => void;
  countdownSeconds: number;
}

/**
 * "Are you still there?" modal with a countdown ring.
 * Tap anywhere to dismiss. Countdown expires → fade to splash.
 */
export function KioskInactivityModal({
  onDismiss,
  onTimeout,
  countdownSeconds,
}: KioskInactivityModalProps) {
  const [remaining, setRemaining] = useState(countdownSeconds);

  useEffect(() => {
    if (remaining <= 0) {
      onTimeout();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onTimeout]);

  const handleTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  const progress = remaining / countdownSeconds;
  const circumference = 2 * Math.PI * 54;
  const dashoffset = circumference * (1 - progress);

  return (
    <div
      onClick={handleTap}
      onTouchStart={handleTap}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        cursor: "pointer",
        animation: "kioskModalFadeIn 300ms ease",
      }}
    >
      <style>{`
        @keyframes kioskModalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {/* Countdown ring */}
      <div style={{ position: "relative", width: 120, height: 120, marginBottom: "1.5rem" }}>
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="var(--primary, #3b82f6)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2rem",
            fontWeight: 700,
            color: "#fff",
          }}
        >
          {remaining}
        </div>
      </div>

      <h2
        style={{
          color: "#fff",
          fontSize: "1.5rem",
          fontWeight: 700,
          margin: "0 0 0.5rem",
          textAlign: "center",
        }}
      >
        Are you still there?
      </h2>
      <p
        style={{
          color: "rgba(255,255,255,0.7)",
          fontSize: "1rem",
          margin: 0,
          textAlign: "center",
        }}
      >
        Tap anywhere to continue
      </p>
    </div>
  );
}
