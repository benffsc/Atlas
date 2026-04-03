"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { kioskInputStyle, kioskLabelStyle } from "@/components/kiosk/kiosk-styles";
import { formatPhoneAsYouType, isValidPhone } from "@/lib/formatters";

type RehomePhase = "resources" | "danger_form" | "submitting" | "success";

/**
 * Rehome resources page — two layers:
 * Layer 1: Tippy intro + rehome resources link/QR.
 * Layer 2 (hidden): Danger path for immediate safety concerns.
 *
 * FFS-1101
 */
export default function KioskRehomePage() {
  const router = useRouter();
  const { success: toastSuccess } = useToast();
  const { value: rehomeUrl } = useAppConfig<string>("kiosk.rehome_url");

  const [phase, setPhase] = useState<RehomePhase>("resources");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmitDanger = name.trim() && phone && isValidPhone(phone) && description.trim();

  const handleDangerSubmit = useCallback(async () => {
    setPhase("submitting");
    try {
      await postApi("/api/intake", {
        source: "in_person",
        source_system: "kiosk_clinic",
        first_name: name.trim(),
        last_name: "(Walk-in)",
        phone: phone.replace(/\D/g, ""),
        cats_address: "Unknown",
        call_type: "rehome_danger",
        is_emergency: true,
        situation_description: description.trim(),
        custom_fields: {
          tippy_branch: "rehome_danger",
          tippy_outcome: "Emergency rehome request",
        },
      });
      setSubmitError(null);
      setPhase("success");
      toastSuccess("Request submitted!");
    } catch {
      setSubmitError("Something went wrong. Please try again or ask staff for help.");
      setPhase("danger_form");
    }
  }, [name, phone, description, toastSuccess]);

  // Success screen
  if (phase === "success") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1.5rem",
          textAlign: "center",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "var(--success-bg, rgba(34,197,94,0.1))",
            border: "3px solid var(--success-text, #16a34a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={40} color="var(--success-text, #16a34a)" />
        </div>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          We&apos;ll reach out soon
        </h1>
        <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0, maxWidth: 400 }}>
          A team member will contact you about this situation as quickly as possible.
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => router.push("/kiosk")}
          style={{ minHeight: 56, borderRadius: 14, minWidth: 200, marginTop: "1rem" }}
        >
          Done
        </Button>
      </div>
    );
  }

  // Submitting spinner
  if (phase === "submitting") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: "4px solid var(--card-border, #e5e7eb)",
            borderTopColor: "var(--primary)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-secondary)" }}>
          Submitting...
        </p>
      </div>
    );
  }

  // Danger form (Layer 2)
  if (phase === "danger_form") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
          maxWidth: 500,
          margin: "0 auto",
          gap: "1.25rem",
        }}
      >
        <button
          onClick={() => setPhase("resources")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "none",
            border: "none",
            color: "var(--primary)",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
            padding: "0.5rem 0",
            fontFamily: "inherit",
          }}
        >
          <Icon name="arrow-left" size={16} />
          Back to resources
        </button>

        <div>
          <h2
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: "0 0 0.25rem",
            }}
          >
            Tell us about the situation
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0 }}>
            If a cat is in immediate danger, let us know and we&apos;ll try to help.
          </p>
        </div>

        {submitError && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: 10,
              color: "var(--danger-text)",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
          >
            {submitError}
          </div>
        )}

        <div>
          <label style={kioskLabelStyle}>What&apos;s happening? *</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe the situation..."
            rows={3}
            style={{ ...kioskInputStyle, minHeight: 100, resize: "vertical" }}
          />
        </div>

        <div>
          <label style={kioskLabelStyle}>Your Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            style={kioskInputStyle}
          />
        </div>

        <div>
          <label style={kioskLabelStyle}>Phone *</label>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhoneAsYouType(e.target.value))}
            placeholder="(707) 555-1234"
            autoComplete="tel"
            style={kioskInputStyle}
          />
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={handleDangerSubmit}
          disabled={!canSubmitDanger}
          style={{ minHeight: 56, borderRadius: 14, fontSize: "1.05rem", marginTop: "0.5rem" }}
        >
          Submit
        </Button>
      </div>
    );
  }

  // Resources page (Layer 1)
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "2rem 1.5rem",
        maxWidth: 500,
        margin: "0 auto",
        gap: "1.5rem",
      }}
    >
      {/* Tippy intro */}
      <div style={{ textAlign: "center" }}>
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
          <Icon name="cat" size={32} color="var(--primary)" />
        </div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
            lineHeight: 1.2,
          }}
        >
          Rehoming Resources
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 360,
          }}
        >
          Here are some resources to help you find a new home for your cat.
        </p>
      </div>

      {/* Resource link card */}
      <a
        href={rehomeUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "1.25rem",
          width: "100%",
          background: "var(--card-bg, #fff)",
          border: "2px solid var(--primary)",
          borderRadius: 16,
          textDecoration: "none",
          cursor: "pointer",
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
          <Icon name="external-link" size={24} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--primary)" }}>
            Rehoming Guide
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.3 }}>
            Tips, listings, and organizations that can help
          </div>
        </div>
        <Icon name="chevron-right" size={20} color="var(--primary)" />
      </a>

      {/* Helpful? */}
      <div
        style={{
          width: "100%",
          padding: "1.25rem",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: 16,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-primary)",
            fontWeight: 600,
            margin: "0 0 1rem",
          }}
        >
          Were these resources helpful?
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => router.push("/kiosk")}
            style={{ flex: 1, minHeight: 52, borderRadius: 14 }}
          >
            Yes, thanks!
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setPhase("danger_form")}
            style={{ flex: 1, minHeight: 52, borderRadius: 14 }}
          >
            I need more help
          </Button>
        </div>
      </div>
    </div>
  );
}
