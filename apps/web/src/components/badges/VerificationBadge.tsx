"use client";

import { useState } from "react";

interface VerificationBadgeProps {
  table: string;
  recordId: string;
  verifiedAt: string | null;
  verifiedBy?: string | null;
  showLabel?: boolean;
  onVerify?: () => void;
}

export function VerificationBadge({
  table,
  recordId,
  verifiedAt,
  verifiedBy,
  showLabel = true,
  onVerify,
}: VerificationBadgeProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [localVerifiedAt, setLocalVerifiedAt] = useState(verifiedAt);

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, record_id: recordId }),
      });

      if (res.ok) {
        const data = await res.json();
        setLocalVerifiedAt(data.verified_at);
        onVerify?.();
      }
    } catch (error) {
      console.error("Failed to verify:", error);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleUnverify = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch(
        `/api/admin/verify?table=${table}&record_id=${recordId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setLocalVerifiedAt(null);
        onVerify?.();
      }
    } catch (error) {
      console.error("Failed to unverify:", error);
    } finally {
      setIsVerifying(false);
    }
  };

  if (localVerifiedAt) {
    const verifiedDate = new Date(localVerifiedAt);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          fontSize: "0.75rem",
          padding: "0.125rem 0.5rem",
          background: "#dcfce7",
          color: "#166534",
          borderRadius: "9999px",
          cursor: "pointer",
        }}
        onClick={handleUnverify}
        title={`Verified ${verifiedDate.toLocaleDateString()}${verifiedBy ? ` by ${verifiedBy}` : ""}. Click to unverify.`}
      >
        {isVerifying ? "..." : "✓"}
        {showLabel && " Verified"}
      </span>
    );
  }

  return (
    <button
      onClick={handleVerify}
      disabled={isVerifying}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.75rem",
        padding: "0.125rem 0.5rem",
        background: "#fef3c7",
        color: "#92400e",
        border: "none",
        borderRadius: "9999px",
        cursor: isVerifying ? "wait" : "pointer",
        opacity: isVerifying ? 0.7 : 1,
      }}
      title="Click to mark as verified"
    >
      {isVerifying ? "..." : "○"}
      {showLabel && " Unverified"}
    </button>
  );
}

// Inline verification indicator for lists
export function VerificationDot({
  verifiedAt,
  size = 8,
}: {
  verifiedAt: string | null;
  size?: number;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: verifiedAt ? "#22c55e" : "#fbbf24",
        flexShrink: 0,
      }}
      title={verifiedAt ? `Verified ${new Date(verifiedAt).toLocaleDateString()}` : "Unverified"}
    />
  );
}

// Last verified timestamp display
export function LastVerified({
  verifiedAt,
  verifiedBy,
}: {
  verifiedAt: string | null;
  verifiedBy?: string | null;
}) {
  if (!verifiedAt) {
    return (
      <span style={{ fontSize: "0.75rem", color: "#92400e" }}>
        Not verified
      </span>
    );
  }

  const date = new Date(verifiedAt);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  let timeAgo: string;
  if (diffDays === 0) {
    timeAgo = "Today";
  } else if (diffDays === 1) {
    timeAgo = "Yesterday";
  } else if (diffDays < 7) {
    timeAgo = `${diffDays} days ago`;
  } else if (diffDays < 30) {
    timeAgo = `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
  } else {
    timeAgo = date.toLocaleDateString();
  }

  return (
    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
      Verified {timeAgo}
      {verifiedBy && ` by ${verifiedBy}`}
    </span>
  );
}
