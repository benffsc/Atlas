/**
 * Shared style constants for kiosk form components.
 *
 * Kiosk-specific: 48px touch targets, 16px card radius, uppercase labels.
 * Consumed by CheckoutForm, CheckinForm, SimpleActionConfirm, add/page, KioskPhotoCapture.
 */

/** Uppercase section label — 0.8rem, 600 weight, secondary color, 0.04em tracking */
export const kioskLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "0.375rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

/** Touch-friendly input — 48px min height, 10px radius, 1px border */
export const kioskInputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "48px",
  padding: "0.75rem 1rem",
  fontSize: "1rem",
  border: "1px solid var(--card-border, #e5e7eb)",
  borderRadius: "10px",
  background: "var(--background, #fff)",
  color: "var(--text-primary)",
  boxSizing: "border-box" as const,
  outline: "none",
};

/** Card wrapper — 16px radius, shadow-sm, card-bg */
export const kioskCardStyle: React.CSSProperties = {
  background: "var(--card-bg, #fff)",
  border: "1px solid var(--card-border, #e5e7eb)",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))",
};

/** Card header — 1rem 1.25rem padding, border-bottom, flex row */
export const kioskCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "1rem 1.25rem",
  borderBottom: "1px solid var(--card-border, #e5e7eb)",
  gap: "0.5rem",
};

/** Resumed-from-autosave info banner */
export const kioskResumedBannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.5rem 1rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  background: "var(--info-bg)",
  color: "var(--info-text)",
  borderBottom: "1px solid var(--info-border)",
};
