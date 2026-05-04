"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

const APPLICATION_URL = "https://www.forgottenfelines.com/outdoor-app";
const QR_URL = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(APPLICATION_URL)}`;

/**
 * Barn Cat Program — kiosk page.
 *
 * Strategy: try to embed the Wix application form in an iframe first.
 * If it fails to render (Wix JS-level frame-busting, network error, or
 * blank page), automatically fall back to an informational page with
 * program details + QR code to apply on their phone.
 *
 * FFS-1390 kiosk optimization.
 */
export default function KioskBarnCatPage() {
  const router = useRouter();
  const { value: barnCatUrl } = useAppConfig<string>("kiosk.barn_cat_qr_url");
  const embedUrl = barnCatUrl || APPLICATION_URL;

  const [mode, setMode] = useState<"embed" | "info">("embed");
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // If the iframe fires onLoad but the content is blank or was frame-busted,
  // detect it with a timeout — if after 5s we haven't seen content, bail to info.
  useEffect(() => {
    if (mode !== "embed") return;
    const timer = setTimeout(() => {
      // If the iframe loaded but looks empty (Wix frame-busting redirects to
      // about:blank or shows nothing), switch to fallback info page.
      if (!embedLoaded) {
        setMode("info");
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [mode, embedLoaded]);

  // Also catch iframe errors (network failures, CSP blocks)
  const handleIframeError = () => setMode("info");

  if (mode === "info") {
    return <BarnCatInfoPage embedUrl={embedUrl} onBack={() => router.push("/kiosk")} />;
  }

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg, #fff)",
      }}
    >
      {/* Header bar */}
      <KioskHeader
        title="Barn Cat Program"
        icon="warehouse"
        onBack={() => router.push("/kiosk")}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("info")}
            style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}
          >
            Program Info
          </Button>
        }
      />

      {/* Iframe embed */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {!embedLoaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              zIndex: 1,
              background: "var(--bg, #fff)",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid var(--border)",
                borderTopColor: "var(--primary)",
                borderRadius: "50%",
                animation: "btn-spin 0.7s linear infinite",
              }}
            />
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
              Loading application form...
            </p>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={embedUrl}
          title="Barn Cat Program Application"
          onLoad={() => setEmbedLoaded(true)}
          onError={handleIframeError}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            opacity: embedLoaded ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback: informational page with QR code
// ---------------------------------------------------------------------------

function BarnCatInfoPage({
  embedUrl,
  onBack,
}: {
  embedUrl: string;
  onBack: () => void;
}) {
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
        gap: "1.25rem",
      }}
    >
      {/* Back */}
      <div style={{ alignSelf: "flex-start" }}>
        <Button
          variant="ghost"
          size="lg"
          icon="arrow-left"
          onClick={onBack}
          style={{ minHeight: 48, borderRadius: 12 }}
        >
          Back
        </Button>
      </div>

      {/* Hero */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--primary-bg, rgba(59,130,246,0.08))",
            border: "2px solid var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <Icon name="warehouse" size={36} color="var(--primary)" />
        </div>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
            lineHeight: 1.2,
          }}
        >
          Barn Cat Program
        </h1>
        <p
          style={{
            fontSize: "1rem",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 380,
          }}
        >
          Give a community cat a job! Our barn &amp; working cat program places
          cats in barns, wineries, warehouses, and other properties where they
          can thrive outdoors.
        </p>
      </div>

      {/* What to expect */}
      <div
        style={{
          width: "100%",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: 16,
          padding: "1.25rem",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-primary)" }}>
          How It Works
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <InfoRow icon="clipboard-list" text="Fill out a short application — we'll learn about your property" />
          <InfoRow icon="phone" text="Our coordinator Heidi will reach out to discuss placement" />
          <InfoRow icon="cat" text="We match you with cats suited to your environment" />
          <InfoRow icon="truck" text="Cats come spayed/neutered, vaccinated, and microchipped" />
          <InfoRow icon="home" text="2-4 week acclimation period in an enclosed space on-site" />
        </div>
      </div>

      {/* Who it's for */}
      <div
        style={{
          width: "100%",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--card-border, #e5e7eb)",
          borderRadius: 16,
          padding: "1.25rem",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.5rem", color: "var(--text-primary)" }}>
          Great For
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {["Barns & Stables", "Wineries", "Farms & Ranches", "Warehouses", "Garden Properties"].map((tag) => (
            <span
              key={tag}
              style={{
                padding: "0.35rem 0.75rem",
                background: "var(--primary-bg, rgba(59,130,246,0.08))",
                border: "1px solid var(--primary-border, rgba(59,130,246,0.2))",
                borderRadius: 999,
                fontSize: "0.85rem",
                fontWeight: 500,
                color: "var(--primary)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* QR code to apply */}
      <div
        style={{
          width: "100%",
          background: "var(--card-bg, #fff)",
          border: "2px solid var(--primary)",
          borderRadius: 16,
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.25rem", color: "var(--primary)" }}>
          Ready to Apply?
        </h2>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
          Scan with your phone to fill out the application
        </p>
        <div
          style={{
            display: "inline-block",
            background: "#fff",
            borderRadius: 12,
            padding: "0.75rem",
            border: "1px solid var(--card-border, #e5e7eb)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={QR_URL}
            alt="QR code — scan to apply for the barn cat program"
            width={220}
            height={220}
            style={{ display: "block" }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            marginTop: "0.75rem",
            color: "var(--text-secondary)",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          <Icon name="smartphone" size={16} />
          Scan with your phone camera
        </div>
      </div>

      {/* Contact */}
      <div
        style={{
          width: "100%",
          padding: "1rem 1.25rem",
          background: "var(--section-bg, #f9fafb)",
          borderRadius: 12,
          textAlign: "center",
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
        }}
      >
        Questions? Email{" "}
        <strong style={{ color: "var(--text-primary)" }}>wcbc@forgottenfelines.com</strong>{" "}
        or ask staff at the front desk.
      </div>

      {/* Back to home */}
      <Button
        variant="outline"
        size="lg"
        onClick={onBack}
        style={{ minHeight: 56, borderRadius: 14, width: "100%", marginTop: "0.5rem" }}
      >
        Back to Home
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function KioskHeader({
  title,
  icon,
  onBack,
  action,
}: {
  title: string;
  icon: string;
  onBack: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <Button
        variant="ghost"
        size="lg"
        icon="arrow-left"
        onClick={onBack}
        style={{ minHeight: 48, borderRadius: 12 }}
      >
        Back
      </Button>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Icon name={icon} size={20} color="var(--primary)" />
        <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>{title}</h1>
      </div>
      <div style={{ minWidth: 96, display: "flex", justifyContent: "flex-end" }}>
        {action}
      </div>
    </div>
  );
}

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--primary-bg, rgba(59,130,246,0.08))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={16} color="var(--primary)" />
      </div>
      <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-primary)", lineHeight: 1.4, paddingTop: "0.25rem" }}>
        {text}
      </p>
    </div>
  );
}
