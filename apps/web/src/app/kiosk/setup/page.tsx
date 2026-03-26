"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { PRINT_BASE_CSS } from "@/lib/print-styles";

/* ─────────────────────────────────────────────────────────
 * Kiosk Setup Guide
 *
 * Detects the install state and shows contextual instructions:
 *   1. Already installed (standalone) → "You're all set" + link
 *   2. iOS Safari (not installed) → step-by-step PWA install guide
 *   3. Desktop / Android → QR code to scan with iPad
 *
 * Also includes a printable half-page setup card.
 * FFS-796, FFS-800
 * ───────────────────────────────────────────────────────── */

const KIOSK_PATH = "/kiosk/equipment/scan";

function useKioskUrl() {
  const [url, setUrl] = useState(KIOSK_PATH);
  useEffect(() => {
    setUrl(`${window.location.origin}${KIOSK_PATH}`);
  }, []);
  return url;
}

function useDeviceDetection() {
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true,
    );
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setReady(true);
  }, []);

  return { isStandalone, isIOS, ready };
}

/* ── QR Code ── */
function QRCode({ url, size = 200 }: { url: string; size?: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`}
        alt={`QR code for ${url}`}
        width={size}
        height={size}
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          background: "#fff",
          padding: 8,
        }}
      />
    </div>
  );
}

/* ── Share icon SVG (box with up arrow) ── */
function ShareIconVisual() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--primary)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Safari share icon"
      style={{ flexShrink: 0 }}
    >
      <rect x="4" y="8" width="16" height="14" rx="2" />
      <polyline points="8 8 12 2 16 8" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

/* ── Step card ── */
function StepCard({
  step,
  title,
  description,
  visual,
}: {
  step: number;
  title: string;
  description?: string;
  visual?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: 16,
        background: "var(--card-bg)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "1.1rem",
          flexShrink: 0,
        }}
      >
        {step}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.95rem",
            color: "var(--text-primary)",
            marginBottom: description || visual ? 4 : 0,
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        )}
        {visual && <div style={{ marginTop: 8 }}>{visual}</div>}
      </div>
    </div>
  );
}

/* ── Copy-to-clipboard URL ── */
function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url]);

  return (
    <button
      onClick={handleCopy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "10px 14px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        cursor: "pointer",
        color: "var(--text-primary)",
        fontSize: "0.85rem",
        fontFamily: "monospace",
        wordBreak: "break-all",
        textAlign: "left",
        transition: "background 150ms ease",
        minHeight: 48,
      }}
      title="Click to copy URL"
    >
      <span style={{ flex: 1 }}>{url}</span>
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
        <Icon name={copied ? "check-circle" : "copy"} size={16} color={copied ? "var(--success-text)" : "var(--text-secondary)"} />
        <span
          style={{
            fontSize: "0.75rem",
            color: copied ? "var(--success-text)" : "var(--text-secondary)",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </span>
      </span>
    </button>
  );
}

/* ── Divider ── */
function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: "var(--border-default)",
        margin: "24px 0",
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
 * State 1: Already Installed
 * ═══════════════════════════════════════════════════════════ */
function InstalledState({ kioskUrl }: { kioskUrl: string }) {
  const router = useRouter();

  return (
    <>
      <div style={{ textAlign: "center", padding: "32px 0 16px" }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "var(--success-bg)",
            border: "2px solid var(--success-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <Icon name="check-circle" size={40} color="var(--success-text)" />
        </div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 8px",
          }}
        >
          You're all set!
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.95rem",
            margin: 0,
          }}
        >
          This iPad is running in Kiosk mode.
        </p>
      </div>

      <div style={{ padding: "16px 0" }}>
        <Button
          variant="primary"
          size="lg"
          icon="arrow-right"
          fullWidth
          onClick={() => router.push(KIOSK_PATH)}
          style={{ minHeight: 52 }}
        >
          Go to Equipment Kiosk
        </Button>
      </div>

      <Divider />

      <div style={{ textAlign: "center" }}>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            margin: "0 0 16px",
          }}
        >
          Need to set up another device?
        </p>
        <QRCode url={kioskUrl} size={180} />
        <p
          style={{
            color: "var(--text-tertiary)",
            fontSize: "0.8rem",
            marginTop: 12,
          }}
        >
          Scan this QR code with the new iPad
        </p>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
 * State 2: iOS Safari (not installed)
 * ═══════════════════════════════════════════════════════════ */
function IOSSetupState({ kioskUrl }: { kioskUrl: string }) {
  return (
    <>
      <div style={{ textAlign: "center", paddingTop: 24, marginBottom: 24 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--info-bg)",
            border: "2px solid var(--info-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 12px",
          }}
        >
          <Icon name="tablet" size={28} color="var(--info-text)" />
        </div>
        <h1
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 6px",
          }}
        >
          Install Equipment Kiosk
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Add this app to your Home Screen for the best experience.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <StepCard
          step={1}
          title='Tap the Share button in Safari'
          description="It's the square with an arrow pointing up, in the toolbar."
          visual={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "var(--bg-secondary)",
                borderRadius: 8,
                width: "fit-content",
              }}
            >
              <ShareIconVisual />
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Look for this icon
              </span>
            </div>
          }
        />
        <StepCard
          step={2}
          title='"Add to Home Screen"'
          description="Scroll down in the share menu and tap 'Add to Home Screen'."
        />
        <StepCard
          step={3}
          title='Tap "Add"'
          description="In the top right corner of the dialog."
        />
        <StepCard
          step={4}
          title="Open from Home Screen"
          description='Tap the "Equipment Kiosk" icon on your Home Screen to launch in full-screen mode.'
        />
      </div>

      <Divider />

      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontWeight: 600,
            color: "var(--text-primary)",
            fontSize: "0.9rem",
            margin: "0 0 12px",
          }}
        >
          Setting up from another device?
        </p>
        <QRCode url={kioskUrl} size={160} />
        <p
          style={{
            color: "var(--text-tertiary)",
            fontSize: "0.8rem",
            marginTop: 12,
          }}
        >
          Scan this QR code with your iPad
        </p>
      </div>

      <Divider />

      <div
        style={{
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          borderRadius: 10,
          padding: 16,
        }}
      >
        <p
          style={{
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "var(--warning-text)",
            margin: "0 0 8px",
          }}
        >
          Having trouble?
        </p>
        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            margin: "0 0 10px",
            lineHeight: 1.5,
          }}
        >
          Make sure you're using <strong>Safari</strong> (not Chrome or another browser).
          "Add to Home Screen" is only available in Safari on iOS.
        </p>
        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            margin: "0 0 8px",
          }}
        >
          Or type this URL directly:
        </p>
        <CopyableUrl url={kioskUrl} />
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
 * State 3: Desktop / Android
 * ═══════════════════════════════════════════════════════════ */
function DesktopState({ kioskUrl }: { kioskUrl: string }) {
  return (
    <>
      <div style={{ textAlign: "center", paddingTop: 24, marginBottom: 24 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--bg-secondary)",
            border: "2px solid var(--border-default)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 12px",
          }}
        >
          <Icon name="monitor" size={28} color="var(--text-secondary)" />
        </div>
        <h1
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 6px",
          }}
        >
          Set Up Equipment Kiosk
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Scan this QR code with your iPad to get started.
        </p>
      </div>

      <QRCode url={kioskUrl} size={220} />

      <p
        style={{
          textAlign: "center",
          color: "var(--text-tertiary)",
          fontSize: "0.85rem",
          margin: "16px 0 24px",
        }}
      >
        Open the camera app on your iPad and point it at the code above.
      </p>

      <Divider />

      <p
        style={{
          fontWeight: 600,
          color: "var(--text-primary)",
          fontSize: "0.9rem",
          margin: "0 0 10px",
          textAlign: "center",
        }}
      >
        Or open this URL on your iPad:
      </p>
      <CopyableUrl url={kioskUrl} />

      <div
        style={{
          marginTop: 24,
          padding: 16,
          background: "var(--info-bg)",
          border: "1px solid var(--info-border)",
          borderRadius: 10,
        }}
      >
        <p
          style={{
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "var(--info-text)",
            margin: "0 0 6px",
          }}
        >
          Why iPad?
        </p>
        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          The Equipment Kiosk is designed for iPad touchscreens. Open the URL in{" "}
          <strong>Safari</strong>, then follow the prompts to add it to your Home Screen.
        </p>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
 * Printable Setup Card
 * ═══════════════════════════════════════════════════════════ */
function PrintableSetupCard({ kioskUrl, orgName }: { kioskUrl: string; orgName: string }) {
  return (
    <div className="print-page" style={{ padding: "0.3in" }}>
      {/* Card with dashed cut line */}
      <div
        style={{
          border: "2px dashed var(--border-light)",
          borderRadius: 12,
          padding: 32,
          maxWidth: "6in",
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            paddingBottom: 12,
            borderBottom: "3px solid #27ae60",
          }}
        >
          <div>
            <div style={{ fontSize: "15pt", fontWeight: 700, color: "#27ae60", fontFamily: "'Raleway', Helvetica, sans-serif" }}>
              Equipment Kiosk Setup
            </div>
            <div style={{ fontSize: "9pt", color: "#7f8c8d", marginTop: 2 }}>
              {orgName}
            </div>
          </div>
          <img src="/logo.png" alt={orgName} style={{ height: 40, width: "auto" }} />
        </div>

        {/* QR + steps side by side */}
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* QR Code */}
          <div style={{ flexShrink: 0, textAlign: "center" }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(kioskUrl)}`}
              alt="QR Code"
              width={160}
              height={160}
              style={{
                border: "1px solid #ddd",
                borderRadius: 6,
                padding: 6,
                background: "#fff",
              }}
            />
            <div style={{ fontSize: "7pt", color: "#95a5a6", marginTop: 4 }}>
              Scan with iPad camera
            </div>
          </div>

          {/* Steps */}
          <div style={{ flex: 1 }}>
            {[
              "Scan the QR code with iPad camera",
              "Open the link in Safari",
              "Tap the Share button (box with arrow)",
              'Tap "Add to Home Screen"',
              'Tap "Add" in the top right',
              'Open "Equipment Kiosk" from Home Screen',
            ].map((text, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#27ae60",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: "9pt",
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  {i + 1}
                </div>
                <span style={{ fontSize: "9.5pt", color: "#2c3e50", lineHeight: 1.4, paddingTop: 2 }}>
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* URL fallback */}
        <div
          style={{
            marginTop: 16,
            padding: "8px 12px",
            background: "#f8f9fa",
            borderRadius: 6,
            fontSize: "8.5pt",
            color: "#6b7280",
            textAlign: "center",
            wordBreak: "break-all",
          }}
        >
          <strong>URL:</strong> {kioskUrl}
        </div>

        {/* Footer instruction */}
        <div
          style={{
            marginTop: 12,
            textAlign: "center",
            fontSize: "8pt",
            color: "#95a5a6",
            fontStyle: "italic",
          }}
        >
          Cut along dashed line. Tape this card near the iPad station.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * Main Page Component
 * ═══════════════════════════════════════════════════════════ */
export default function KioskSetupPage() {
  const { isStandalone, isIOS, ready } = useDeviceDetection();
  const kioskUrl = useKioskUrl();
  const { nameFull, nameShort } = useOrgConfig();
  const [showPrintCard, setShowPrintCard] = useState(false);

  const orgName = nameFull || nameShort || "FFSC";

  if (!ready) {
    return (
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "24px 20px",
          fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            height: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
          }}
        >
          Loading...
        </div>
      </div>
    );
  }

  /* ── Print card view ── */
  if (showPrintCard) {
    return (
      <>
        <style jsx global>{`${PRINT_BASE_CSS}
          @media print {
            .setup-print-controls { display: none !important; }
            .kiosk-tab-bar { display: none !important; }
            body { background: #fff !important; }
          }
          @media screen {
            body { background: #f0f9f4 !important; }
          }
        `}</style>

        <div className="setup-print-controls print-controls">
          <h3>Print Setup Card</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
            Print and tape near the iPad station.
          </p>
          <button className="print-btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
          <button
            className="back-btn"
            onClick={() => setShowPrintCard(false)}
            style={{ width: "100%" }}
          >
            Back to Setup Guide
          </button>
        </div>

        <div className="print-wrapper">
          <PrintableSetupCard kioskUrl={kioskUrl} orgName={orgName} />
        </div>
      </>
    );
  }

  /* ── Normal view ── */
  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "24px 20px 80px",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      {isStandalone ? (
        <InstalledState kioskUrl={kioskUrl} />
      ) : isIOS ? (
        <IOSSetupState kioskUrl={kioskUrl} />
      ) : (
        <DesktopState kioskUrl={kioskUrl} />
      )}

      <Divider />

      {/* Print setup card button */}
      <div style={{ textAlign: "center" }}>
        <Button
          variant="outline"
          size="md"
          icon="printer"
          onClick={() => setShowPrintCard(true)}
        >
          Print Setup Card
        </Button>
        <p
          style={{
            color: "var(--text-tertiary)",
            fontSize: "0.8rem",
            marginTop: 8,
          }}
        >
          Printable half-page card with QR code and instructions
        </p>
      </div>
    </div>
  );
}
