"use client";

import { Icon } from "@/components/ui/Icon";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useOrgConfig } from "@/hooks/useOrgConfig";

interface KioskMissionFrameProps {
  /** Whether person lookup detected a previous pet spay submission */
  hasPreviousPetSpay: boolean;
  onCommunity: () => void;
  onPet: () => void;
}

/**
 * Mission framing step in the clinic kiosk flow.
 * Shows FFSC mission + two clear paths: community cats (continue) or pet (redirect).
 * If the visitor has previously used pet spay service, shows a proactive note.
 *
 * FFS-1104
 */
export function KioskMissionFrame({
  hasPreviousPetSpay,
  onCommunity,
  onPet,
}: KioskMissionFrameProps) {
  const { value: headline } = useAppConfig<string>("kiosk.mission_headline");
  const { nameShort } = useOrgConfig();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Mission statement */}
      <div style={{ textAlign: "center", paddingTop: "0.5rem" }}>
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
          <Icon name="heart" size={32} color="var(--primary)" />
        </div>
        <h2
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: "0 0 0.75rem",
            lineHeight: 1.2,
          }}
        >
          {headline}
        </h2>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 380,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {nameShort} provides free spay/neuter surgery for outdoor and community cats
          to help manage cat populations humanely.
        </p>
      </div>

      {/* Previous pet spay notice */}
      {hasPreviousPetSpay && (
        <div
          style={{
            background: "var(--info-bg, rgba(59,130,246,0.06))",
            border: "1px solid var(--info-border, #93c5fd)",
            borderRadius: 14,
            padding: "0.875rem 1rem",
            display: "flex",
            gap: "0.75rem",
            alignItems: "flex-start",
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 2, display: "flex" }}>
            <Icon name="info" size={20} color="var(--info-text, #1d4ed8)" />
          </span>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--info-text, #1d4ed8)",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            We see you&apos;ve used our pet spay service before. We&apos;ve since focused
            exclusively on community cats. For pet spay/neuter, we can point you to
            great low-cost options.
          </p>
        </div>
      )}

      {/* Two paths */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <button
          onClick={onCommunity}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "1.25rem",
            minHeight: 80,
            background: "var(--primary-bg, rgba(59,130,246,0.08))",
            border: "2px solid var(--primary)",
            borderRadius: 16,
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            fontFamily: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="cat" size={24} color="#fff" />
          </div>
          <div>
            <div
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--primary)",
                marginBottom: "0.2rem",
              }}
            >
              Community / outdoor cats
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.3 }}>
              Stray, feral, or outdoor cats in your area
            </div>
          </div>
        </button>

        <button
          onClick={onPet}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "1.25rem",
            minHeight: 80,
            background: "var(--card-bg, #fff)",
            border: "2px solid var(--card-border, #e5e7eb)",
            borderRadius: 16,
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            fontFamily: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "var(--muted-bg, #f3f4f6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="home" size={24} color="var(--text-secondary)" />
          </div>
          <div>
            <div
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "0.2rem",
              }}
            >
              My own pet
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.3 }}>
              I need spay/neuter for my personal cat
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
