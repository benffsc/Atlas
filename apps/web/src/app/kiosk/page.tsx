"use client";

import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { Icon } from "@/components/ui/Icon";

interface ModuleCard {
  id: string;
  icon: string;
  label: string;
  subtitle: string;
  route: string;
  comingSoon?: boolean;
}

const ALL_MODULES: ModuleCard[] = [
  {
    id: "help",
    icon: "heart-handshake",
    label: "I need help with a cat",
    subtitle: "Answer a few questions so we can help",
    route: "/kiosk/help",
  },
  {
    id: "equipment",
    icon: "box",
    label: "Equipment Check Out",
    subtitle: "Borrow or return traps and supplies",
    route: "/kiosk/equipment/scan",
  },
  {
    id: "cats",
    icon: "cat",
    label: "Meet Our Cats",
    subtitle: "See cats available for adoption",
    route: "/kiosk/cats",
    comingSoon: true,
  },
  {
    id: "trapper",
    icon: "map-pin",
    label: "Request Trapper Visit",
    subtitle: "Get help with outdoor cats in your area",
    route: "/kiosk/trapper",
    comingSoon: true,
  },
];

/**
 * Kiosk splash screen — the hub for all kiosk modules.
 * Shows a 2×2 grid of large touch cards. Modules are driven by
 * the `kiosk.modules_enabled` config key.
 */
export default function KioskSplashPage() {
  const router = useRouter();
  const { value: enabledModules } = useAppConfig<string[]>("kiosk.modules_enabled");
  const { value: title } = useAppConfig<string>("kiosk.splash_title");
  const { value: subtitle } = useAppConfig<string>("kiosk.splash_subtitle");
  const { nameShort } = useOrgConfig();

  const visibleModules = ALL_MODULES.filter((m) => enabledModules?.includes(m.id));

  if (visibleModules.length === 0) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
          gap: "1rem",
        }}
      >
        <Icon name="settings" size={48} color="var(--muted)" />
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Kiosk Not Configured
        </h1>
        <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0 }}>
          No modules are enabled. Ask an administrator to configure the kiosk.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.5rem",
        gap: "2rem",
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

      {/* Module grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "1rem",
          width: "100%",
          maxWidth: 600,
        }}
      >
        {visibleModules.map((mod) => (
          <ModuleCardButton key={mod.id} module={mod} onClick={() => {
            if (!mod.comingSoon) router.push(mod.route);
          }} />
        ))}
      </div>
    </div>
  );
}

function ModuleCardButton({ module, onClick }: { module: ModuleCard; onClick: () => void }) {
  const isDisabled = module.comingSoon;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      aria-label={module.label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "2rem 1rem",
        minHeight: 180,
        background: isDisabled ? "var(--muted-bg, #f3f4f6)" : "var(--card-bg, #fff)",
        border: isDisabled
          ? "2px dashed var(--card-border, #e5e7eb)"
          : "2px solid var(--card-border, #e5e7eb)",
        borderRadius: 20,
        boxShadow: isDisabled ? "none" : "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))",
        cursor: isDisabled ? "default" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        WebkitTapHighlightColor: "transparent",
        transition: "transform 100ms ease, box-shadow 100ms ease",
        fontFamily: "inherit",
        textAlign: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: isDisabled
            ? "var(--muted-bg, #f3f4f6)"
            : "var(--primary-bg, rgba(59,130,246,0.08))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={module.icon}
          size={28}
          color={isDisabled ? "var(--muted)" : "var(--primary)"}
        />
      </div>
      <div>
        <div
          style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            color: isDisabled ? "var(--muted)" : "var(--text-primary)",
            marginBottom: "0.25rem",
          }}
        >
          {module.label}
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: 1.3,
          }}
        >
          {isDisabled ? "Coming Soon" : module.subtitle}
        </div>
      </div>
    </button>
  );
}
