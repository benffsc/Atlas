"use client";

import { useRouter } from "next/navigation";

interface BackButtonProps {
  fallbackHref?: string;
  fallbackLabel?: string;
}

/**
 * BackButton that uses browser history to go back.
 * Falls back to a specific route if there's no history (direct navigation).
 */
export function BackButton({
  fallbackHref = "/",
  fallbackLabel = "Dashboard"
}: BackButtonProps) {
  const router = useRouter();

  const handleBack = () => {
    // Check if there's history to go back to
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      // Fallback to specified route
      router.push(fallbackHref);
    }
  };

  return (
    <button
      onClick={handleBack}
      style={{
        background: "none",
        border: "none",
        color: "var(--link-color, #0d6efd)",
        cursor: "pointer",
        padding: 0,
        fontSize: "inherit",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
      }}
    >
      ← Back
    </button>
  );
}
