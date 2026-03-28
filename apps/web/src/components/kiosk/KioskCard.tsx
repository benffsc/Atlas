import { Icon } from "@/components/ui/Icon";
import {
  kioskCardStyle,
  kioskCardHeaderStyle,
  kioskResumedBannerStyle,
} from "./kiosk-styles";

interface KioskCardProps {
  /** Lucide icon name */
  icon: string;
  /** Header title */
  title: string;
  /** Right-aligned secondary text in header */
  subtitle?: string;
  /** Icon color (default: var(--primary)) */
  iconColor?: string;
  /** Show "Resumed from where you left off" banner */
  showResumed?: boolean;
  children: React.ReactNode;
  /** Merge onto card wrapper (e.g., marginTop) */
  style?: React.CSSProperties;
}

/**
 * Shared card wrapper for kiosk forms.
 * Renders: card → optional resumed banner → header (icon + title + subtitle) → children.
 */
export function KioskCard({
  icon,
  title,
  subtitle,
  iconColor = "var(--primary)",
  showResumed = false,
  children,
  style,
}: KioskCardProps) {
  return (
    <div style={{ ...kioskCardStyle, ...style }}>
      {showResumed && (
        <div style={kioskResumedBannerStyle}>
          <Icon name="rotate-ccw" size={14} color="var(--info-text)" />
          Resumed from where you left off
        </div>
      )}

      <div style={kioskCardHeaderStyle}>
        <Icon name={icon} size={20} color={iconColor} />
        <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--muted)" }}>
            {subtitle}
          </span>
        )}
      </div>

      {children}
    </div>
  );
}
