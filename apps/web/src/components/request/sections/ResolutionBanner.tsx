"use client";

import { getOutcomeLabel, getOutcomeColor, getReasonLabel } from "@/lib/request-status";

interface ResolutionBannerProps {
  status: string;
  resolutionOutcome: string | null;
  resolutionReason: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  sourceCreatedAt: string | null;
  sourceSystem: string | null;
}

function formatRelativeDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function ResolutionBanner({
  status,
  resolutionOutcome,
  resolutionReason,
  resolutionNotes,
  resolvedAt,
  sourceCreatedAt,
  sourceSystem,
}: ResolutionBannerProps) {
  const isResolved = status === "completed" || status === "cancelled" || status === "partial";
  if (!isResolved) return null;

  const isLegacy = !resolutionOutcome && sourceSystem?.startsWith("airtable");
  const hasOutcome = !!resolutionOutcome;
  const outcomeColors = hasOutcome ? getOutcomeColor(resolutionOutcome!) : null;
  const resolvedDate = resolvedAt || sourceCreatedAt;

  let bannerBg: string;
  let bannerBorder: string;
  let bannerColor: string;
  let bannerIcon: string;

  if (hasOutcome && outcomeColors) {
    bannerBg = outcomeColors.bg;
    bannerBorder = outcomeColors.border;
    bannerColor = outcomeColors.color;
    bannerIcon = resolutionOutcome === "successful" ? "✓" : "●";
  } else if (isLegacy) {
    bannerBg = "#f3f4f6";
    bannerBorder = "#d1d5db";
    bannerColor = "#6b7280";
    bannerIcon = "📋";
  } else {
    bannerBg = "#f9fafb";
    bannerBorder = "#e5e7eb";
    bannerColor = "#6b7280";
    bannerIcon = "●";
  }

  return (
    <div style={{
      marginTop: "1rem",
      padding: "1rem 1.25rem",
      background: bannerBg,
      border: `1px solid ${bannerBorder}`,
      borderRadius: "10px",
    }}>
      {hasOutcome ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: resolutionReason || resolutionNotes ? "0.5rem" : 0 }}>
            <span style={{ fontSize: "1.1rem" }}>{bannerIcon}</span>
            <span style={{ fontWeight: 600, fontSize: "0.95rem", color: bannerColor }}>
              {getOutcomeLabel(resolutionOutcome!)}
            </span>
            {resolvedDate && (
              <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: bannerColor, opacity: 0.8 }}>
                Closed {formatRelativeDate(resolvedDate)} — {new Date(resolvedDate).toLocaleDateString()}
              </span>
            )}
          </div>
          {resolutionReason && (
            <div style={{ fontSize: "0.85rem", color: bannerColor, opacity: 0.9, marginBottom: resolutionNotes ? "0.25rem" : 0 }}>
              {getReasonLabel(resolutionReason)}
            </div>
          )}
          {resolutionNotes && (
            <div style={{ fontSize: "0.85rem", color: bannerColor, opacity: 0.8, fontStyle: "italic" }}>
              {resolutionNotes}
            </div>
          )}
        </>
      ) : isLegacy ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1rem" }}>{bannerIcon}</span>
            <span style={{ fontWeight: 600, fontSize: "0.95rem", color: bannerColor }}>Legacy Import</span>
            {resolvedDate && (
              <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: bannerColor, opacity: 0.8 }}>
                {formatRelativeDate(resolvedDate)} — {new Date(resolvedDate).toLocaleDateString()}
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.85rem", color: bannerColor, opacity: 0.8, marginTop: "0.25rem" }}>
            Closed in Airtable — no resolution details available
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1rem" }}>{bannerIcon}</span>
            <span style={{ fontWeight: 600, fontSize: "0.95rem", color: bannerColor }}>Closed without resolution details</span>
            {resolvedDate && (
              <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: bannerColor, opacity: 0.8 }}>
                {formatRelativeDate(resolvedDate)} — {new Date(resolvedDate).toLocaleDateString()}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
