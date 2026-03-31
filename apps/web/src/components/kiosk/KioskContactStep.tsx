"use client";

import { formatPhoneAsYouType } from "@/lib/formatters";
import { kioskInputStyle, kioskLabelStyle } from "./kiosk-styles";

export interface KioskContactData {
  firstName: string;
  phone: string;
  email: string;
}

interface KioskContactStepProps {
  data: KioskContactData;
  onChange: (data: KioskContactData) => void;
}

/**
 * Contact step for kiosk help form.
 * First name + phone required, email optional.
 * Uses tel inputMode for phone keyboard on mobile.
 */
export function KioskContactStep({ data, onChange }: KioskContactStepProps) {
  const update = (field: keyof KioskContactData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h2
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 0.25rem",
          }}
        >
          How can we reach you?
        </h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0 }}>
          We need this to follow up with you about your request.
        </p>
      </div>

      <div>
        <label style={kioskLabelStyle}>First Name *</label>
        <input
          type="text"
          value={data.firstName}
          onChange={(e) => update("firstName", e.target.value)}
          placeholder="Your first name"
          autoComplete="given-name"
          style={kioskInputStyle}
        />
      </div>

      <div>
        <label style={kioskLabelStyle}>Phone *</label>
        <input
          type="tel"
          inputMode="tel"
          value={data.phone}
          onChange={(e) => update("phone", formatPhoneAsYouType(e.target.value))}
          placeholder="(707) 555-1234"
          autoComplete="tel"
          style={kioskInputStyle}
        />
      </div>

      <div>
        <label style={kioskLabelStyle}>Email (optional)</label>
        <input
          type="email"
          inputMode="email"
          value={data.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="your@email.com"
          autoComplete="email"
          style={kioskInputStyle}
        />
      </div>
    </div>
  );
}
