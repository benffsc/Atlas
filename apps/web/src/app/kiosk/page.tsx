"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { Icon } from "@/components/ui/Icon";
import { KioskQRModal } from "@/components/kiosk/KioskQRModal";

interface LobbyModule {
  id: string;
  icon: string;
  label: string;
  subtitle: string;
  route?: string;
  qr_url?: string;
  qr_title?: string;
  qr_description?: string;
  /** Primary card gets full-width + accent styling */
  primary?: boolean;
}

const DEFAULT_LOBBY_MODULES: LobbyModule[] = [
  {
    id: "clinic",
    icon: "scissors",
    label: "Spay / Neuter Clinic",
    subtitle: "Spay/neuter for community cats — $50 donation",
    route: "/kiosk/clinic",
    primary: true,
  },
  {
    id: "volunteer",
    icon: "users",
    label: "Volunteering",
    subtitle: "Join our volunteer team",
    qr_url: "https://forgottenfelines.volunteerhub.com/vv2/",
    qr_title: "Volunteer With Us",
    qr_description: "Scan the QR code with your phone to sign up or view volunteer opportunities.",
  },
  {
    id: "barn_cat",
    icon: "warehouse",
    label: "Barn Cat Program",
    subtitle: "Adopt a working cat",
    qr_url: "https://www.forgottenfelines.com/outdoor-app",
    qr_title: "Barn Cat Program",
    qr_description: "Scan the QR code with your phone to apply for a barn or working cat.",
  },
  {
    id: "adopt",
    icon: "heart",
    label: "Adopt a Cat",
    subtitle: "Find your new friend",
    qr_url: "https://www.forgottenfelines.com/adoption",
    qr_title: "Adopt a Cat",
    qr_description: "Scan the QR code with your phone to view cats available for adoption.",
  },
  {
    id: "rehome",
    icon: "home",
    label: "Rehome a Cat",
    subtitle: "Resources for rehoming",
    route: "/kiosk/rehome",
  },
];

/**
 * Kiosk splash screen — 5-path digital lobby for all FFSC programs.
 * Clinic card is full-width primary. Other 4 in a 2x2 grid.
 * QR paths open a modal. Route paths navigate directly.
 * Equipment stays on tab bar (staff-only, behind PIN).
 *
 * FFS-1100
 */
export default function KioskSplashPage() {
  const router = useRouter();
  const { value: customModules } = useAppConfig<LobbyModule[] | null>("kiosk.lobby_modules");
  const { value: title } = useAppConfig<string>("kiosk.splash_title");
  const { value: subtitle } = useAppConfig<string>("kiosk.splash_subtitle");
  const { value: volunteerUrl } = useAppConfig<string>("kiosk.volunteer_qr_url");
  const { value: barnCatUrl } = useAppConfig<string>("kiosk.barn_cat_qr_url");
  const { value: adoptUrl } = useAppConfig<string>("kiosk.adopt_qr_url");
  const { nameShort } = useOrgConfig();

  const [qrModal, setQrModal] = useState<{ url: string; title: string; description: string } | null>(null);

  // Use custom modules if configured, otherwise defaults with config-driven URLs
  const modules = customModules || DEFAULT_LOBBY_MODULES.map((m) => {
    if (m.id === "volunteer" && volunteerUrl) return { ...m, qr_url: volunteerUrl };
    if (m.id === "barn_cat" && barnCatUrl) return { ...m, qr_url: barnCatUrl };
    if (m.id === "adopt" && adoptUrl) return { ...m, qr_url: adoptUrl };
    return m;
  });

  const primaryModule = modules.find((m) => m.primary);
  const secondaryModules = modules.filter((m) => !m.primary);

  const handleModuleClick = (mod: LobbyModule) => {
    if (mod.route) {
      router.push(mod.route);
    } else if (mod.qr_url) {
      setQrModal({
        url: mod.qr_url,
        title: mod.qr_title || mod.label,
        description: mod.qr_description || `Scan the QR code to visit ${mod.label}.`,
      });
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.5rem",
        gap: "1.5rem",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--primary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 0.5rem",
          }}
        >
          {nameShort}
        </p>
        <h1
          style={{
            fontSize: "clamp(1.75rem, 5vw, 2.5rem)",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: "clamp(1rem, 2.5vw, 1.15rem)",
            color: "var(--text-secondary)",
            margin: 0,
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Primary card (full width) */}
      {primaryModule && (
        <div style={{ width: "100%", maxWidth: 600 }}>
          <button
            onClick={() => handleModuleClick(primaryModule)}
            aria-label={primaryModule.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.25rem",
              padding: "1.5rem 1.75rem",
              minHeight: 100,
              width: "100%",
              background: "var(--primary)",
              border: "none",
              borderRadius: 20,
              boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
              transition: "transform 100ms ease, box-shadow 100ms ease",
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name={primaryModule.icon} size={30} color="#fff" />
            </div>
            <div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 800,
                  color: "#fff",
                  marginBottom: "0.25rem",
                }}
              >
                {primaryModule.label}
              </div>
              <div
                style={{
                  fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.85)",
                  lineHeight: 1.3,
                }}
              >
                {primaryModule.subtitle}
              </div>
            </div>
            <div style={{ marginLeft: "auto", flexShrink: 0 }}>
              <Icon name="chevron-right" size={24} color="rgba(255,255,255,0.7)" />
            </div>
          </button>
        </div>
      )}

      {/* Secondary cards (2x2 grid) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "0.875rem",
          width: "100%",
          maxWidth: 600,
        }}
      >
        {secondaryModules.map((mod) => (
          <button
            key={mod.id}
            onClick={() => handleModuleClick(mod)}
            aria-label={mod.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.625rem",
              padding: "1.5rem 0.75rem",
              minHeight: 150,
              background: "var(--card-bg, #fff)",
              border: "2px solid var(--card-border, #e5e7eb)",
              borderRadius: 20,
              boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              transition: "transform 100ms ease, box-shadow 100ms ease",
              fontFamily: "inherit",
              textAlign: "center",
              width: "100%",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--primary-bg, rgba(59,130,246,0.08))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={mod.icon} size={24} color="var(--primary)" />
            </div>
            <div>
              <div
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  marginBottom: "0.2rem",
                }}
              >
                {mod.label}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.3,
                }}
              >
                {mod.qr_url ? "Scan QR code" : mod.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* QR Modal */}
      {qrModal && (
        <KioskQRModal
          url={qrModal.url}
          title={qrModal.title}
          description={qrModal.description}
          onClose={() => setQrModal(null)}
        />
      )}
    </div>
  );
}
