"use client";

/**
 * KioskAgreementModal — full-screen loan agreement for equipment checkout.
 *
 * Shows the agreement text (from ops.app_config), requires scroll-to-bottom,
 * typed name confirmation, and "I Agree" tap. Returns the signed data to
 * the parent CheckoutForm which then POSTs to /api/equipment/[id]/agreement.
 *
 * Design: full-screen bottom-sheet on mobile (same pattern as
 * KioskPersonAutosuggest modal). Prominent green "I Agree" button,
 * subtle "Cancel" at bottom.
 *
 * FFS-1207 (Layer 2.1 of the Equipment Overhaul epic FFS-1201).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export interface AgreementResult {
  personName: string;
  agreementText: string;
  agreementVersion: string;
  signatureValue: string;
  signedAt: string;
}

interface KioskAgreementModalProps {
  /** The agreement text to display (from ops.app_config) */
  agreementText: string;
  /** The agreement version string (from ops.app_config) */
  agreementVersion: string;
  /** Pre-fill the name field with the checkout form's custodian name */
  defaultName: string;
  /** Called when user signs — parent proceeds with checkout */
  onAgree: (result: AgreementResult) => void;
  /** Called when user cancels — returns to checkout form */
  onCancel: () => void;
}

export function KioskAgreementModal({
  agreementText,
  agreementVersion,
  defaultName,
  onAgree,
  onCancel,
}: KioskAgreementModalProps) {
  const [name, setName] = useState(defaultName);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lock body scroll
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Track scroll position — "I Agree" becomes available once user scrolls
  // to within 50px of the bottom (or if the content is short enough to
  // not scroll at all)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  // Check on mount — if content is short, mark as scrolled
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 50) {
      setHasScrolledToBottom(true);
    }
  }, []);

  const canAgree = hasScrolledToBottom && name.trim().length >= 2;

  const handleAgree = () => {
    if (!canAgree) return;
    onAgree({
      personName: name.trim(),
      agreementText,
      agreementVersion,
      signatureValue: name.trim(),
      signedAt: new Date().toISOString(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Equipment Loan Agreement"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <style>{`
        @keyframes agreement-slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "92vh",
          background: "var(--background, #fff)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 40px rgba(0, 0, 0, 0.25)",
          animation: "agreement-slide-up 200ms ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.25rem 1.25rem 1rem",
            borderBottom: "1px solid var(--border, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--success-bg, rgba(34,197,94,0.08))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="shield-check" size={22} color="var(--success-text, #16a34a)" />
          </div>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Equipment Loan Agreement
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "0.8rem",
                color: "var(--text-secondary)",
              }}
            >
              Please read and sign before proceeding
            </p>
          </div>
        </div>

        {/* Scrollable agreement text */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1.25rem",
            fontSize: "0.9rem",
            lineHeight: 1.6,
            color: "var(--text-primary)",
            whiteSpace: "pre-wrap",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {agreementText}
        </div>

        {/* Scroll hint (shown until user scrolls to bottom) */}
        {!hasScrolledToBottom && (
          <div
            style={{
              padding: "0.5rem 1.25rem",
              background: "var(--info-bg, rgba(59,130,246,0.06))",
              borderTop: "1px solid var(--info-border, #93c5fd)",
              fontSize: "0.78rem",
              color: "var(--info-text, #1d4ed8)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexShrink: 0,
            }}
          >
            <Icon name="chevron-down" size={14} color="var(--info-text)" />
            Scroll down to read the full agreement
          </div>
        )}

        {/* Signature area */}
        <div
          style={{
            padding: "1rem 1.25rem 1.25rem",
            borderTop: "1px solid var(--border, #e5e7eb)",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            flexShrink: 0,
            paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Name input */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.25rem",
              }}
            >
              Type your full name to sign
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoCapitalize="words"
              autoComplete="off"
              style={{
                width: "100%",
                minHeight: 52,
                padding: "12px 14px",
                fontSize: "1.05rem",
                fontWeight: 600,
                borderRadius: 10,
                border: name.trim().length >= 2
                  ? "2px solid var(--success-text, #16a34a)"
                  : "1px solid var(--border, #e5e7eb)",
                background: name.trim().length >= 2
                  ? "var(--success-bg, rgba(34,197,94,0.04))"
                  : "var(--background, #fff)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Action buttons */}
          <Button
            variant="primary"
            size="lg"
            icon="shield-check"
            fullWidth
            disabled={!canAgree}
            onClick={handleAgree}
            style={{
              minHeight: 56,
              borderRadius: 12,
              fontSize: "1.05rem",
              fontWeight: 700,
              background: canAgree
                ? "var(--success-text, #16a34a)"
                : "var(--border, #e5e7eb)",
              color: canAgree ? "#fff" : "var(--muted)",
              border: "none",
            }}
          >
            {canAgree ? "I Agree" : "Read agreement to continue"}
          </Button>

          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={onCancel}
            style={{ minHeight: 48, borderRadius: 12 }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
