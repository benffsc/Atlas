"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { postApi, fetchApi } from "@/lib/api-client";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

const STORAGE_KEY = "kiosk_unlocked";

/**
 * KioskGate — PIN-based access gate for the equipment kiosk.
 *
 * UX flow:
 * 1. First visit: shows clean PIN pad (iOS numpad auto-appears)
 * 2. Staff enters PIN → server validates → localStorage stores unlock
 * 3. Subsequent visits: gate is transparent, children render immediately
 * 4. If KIOSK_PIN is not configured: shows "contact admin" message
 *
 * This is a privacy gate, not security auth. Equipment data only.
 */
export function KioskGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "unlocked" | "not_configured">("checking");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setState("unlocked");
      return;
    }

    // Check if kiosk is configured
    fetchApi<{ configured: boolean }>("/api/auth/kiosk")
      .then((data) => {
        setState(data.configured ? "locked" : "not_configured");
      })
      .catch(() => {
        // If check fails, show PIN entry anyway — the POST will give a better error
        setState("locked");
      });
  }, []);

  // Auto-focus PIN input when locked
  useEffect(() => {
    if (state === "locked") {
      // Small delay for iOS keyboard to be ready
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [state]);

  const handleSubmit = useCallback(async () => {
    if (!pin.trim() || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      await postApi("/api/auth/kiosk", { pin: pin.trim() });
      localStorage.setItem(STORAGE_KEY, "true");
      setState("unlocked");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Incorrect PIN";
      setError(message);
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      // Re-focus for quick retry
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally {
      setSubmitting(false);
    }
  }, [pin, submitting]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Transparent when unlocked
  if (state === "unlocked") {
    return <>{children}</>;
  }

  // Loading check
  if (state === "checking") {
    return (
      <GateWrapper>
        <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid var(--border, #e5e7eb)",
              borderTopColor: "var(--primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </GateWrapper>
    );
  }

  // Not configured
  if (state === "not_configured") {
    return (
      <GateWrapper>
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--warning-bg)",
              border: "2px solid var(--warning-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem",
            }}
          >
            <Icon name="alert-triangle" size={32} color="var(--warning-text)" />
          </div>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Kiosk Not Set Up
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0, lineHeight: 1.5 }}>
            Ask your admin to set the <strong>KIOSK_PIN</strong> in the
            environment configuration to enable kiosk access.
          </p>
        </div>
      </GateWrapper>
    );
  }

  // Locked — show PIN entry
  return (
    <GateWrapper>
      <div style={{ textAlign: "center", padding: "1.5rem 0 1rem" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--primary-bg, rgba(59,130,246,0.08))",
            border: "2px solid var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <Icon name="lock" size={28} color="var(--primary)" />
        </div>
        <h2
          style={{
            margin: "0 0 0.25rem",
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          Equipment Kiosk
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
          Enter PIN to unlock
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          padding: "0.5rem 0",
          animation: shake ? "shake 0.4s ease" : undefined,
        }}
      >
        <style>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-8px); }
            40% { transform: translateX(8px); }
            60% { transform: translateX(-6px); }
            80% { transform: translateX(6px); }
          }
        `}</style>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
          placeholder="PIN"
          maxLength={10}
          style={{
            width: "100%",
            padding: "1rem",
            fontSize: "1.5rem",
            fontWeight: 600,
            textAlign: "center",
            letterSpacing: "0.3em",
            border: error
              ? "2px solid var(--danger-text, #dc2626)"
              : "2px solid var(--card-border, #e5e7eb)",
            borderRadius: "12px",
            background: "var(--background, #fff)",
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color 200ms",
            WebkitAppearance: "none",
          }}
        />

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.375rem",
              color: "var(--danger-text, #dc2626)",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            <Icon name="alert-circle" size={16} color="var(--danger-text, #dc2626)" />
            {error}
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!pin.trim()}
          onClick={handleSubmit}
          style={{
            minHeight: "56px",
            borderRadius: "12px",
            fontSize: "1.05rem",
          }}
        >
          Unlock
        </Button>
      </div>

      <p
        style={{
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "0.75rem",
          margin: "1.5rem 0 0",
          lineHeight: 1.5,
        }}
      >
        Don't know the PIN? Ask your clinic coordinator.
      </p>
    </GateWrapper>
  );
}

/** Centered wrapper matching the kiosk setup page style */
function GateWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "var(--background, #f9fafb)",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: "20px",
          padding: "2rem 1.5rem",
          boxShadow: "var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.08))",
        }}
      >
        {children}
      </div>
    </div>
  );
}
