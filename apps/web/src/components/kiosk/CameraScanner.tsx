"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface CameraScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

const SCANNER_REGION_ID = "camera-scanner-region";

/**
 * Full-screen camera barcode scanner overlay.
 *
 * Uses html5-qrcode to capture 1D/2D barcodes via the device camera.
 * Renders a viewfinder rectangle (250x100, optimized for 1D barcodes)
 * with dimmed corners and instruction text.
 */
export function CameraScanner({ onScan, onClose }: CameraScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const hasScannedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const scanner = new Html5Qrcode(SCANNER_REGION_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 100 }, aspectRatio: 1.777 },
        (decodedText) => {
          // Prevent double-fire
          if (hasScannedRef.current) return;
          hasScannedRef.current = true;

          // Stop camera, then deliver result
          scanner
            .stop()
            .catch(() => {})
            .finally(() => {
              if (mounted) {
                onScan(decodedText);
              }
            });
        },
        () => {
          // Scan miss — ignore
        }
      )
      .then(() => {
        if (mounted) setStarting(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setStarting(false);
        const message =
          typeof err === "string" ? err : err?.message || "Camera unavailable";
        if (
          message.toLowerCase().includes("permission") ||
          message.toLowerCase().includes("denied") ||
          message.toLowerCase().includes("not allowed")
        ) {
          setError(
            "Camera access denied — please allow in Settings"
          );
        } else if (
          message.toLowerCase().includes("no camera") ||
          message.toLowerCase().includes("not found") ||
          message.toLowerCase().includes("requested device not found")
        ) {
          setError("No camera found on this device");
        } else {
          setError(message);
        }
      });

    return () => {
      mounted = false;
      // Graceful cleanup
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {});
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "black",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Close button — top-left, safe area aware */}
      <button
        onClick={onClose}
        aria-label="Close scanner"
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "16px",
          zIndex: 1010,
          width: "48px",
          height: "48px",
          minWidth: "48px",
          minHeight: "48px",
          borderRadius: "50%",
          background: "rgba(0, 0, 0, 0.55)",
          border: "none",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Icon name="x" size={24} color="white" />
      </button>

      {/* Scanner region — html5-qrcode injects video here */}
      <div
        id={SCANNER_REGION_ID}
        style={{
          flex: 1,
          width: "100%",
          overflow: "hidden",
        }}
      />

      {/* Viewfinder overlay — positioned on top of the video feed */}
      {!error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1005,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Viewfinder frame */}
          <div
            style={{
              width: "280px",
              height: "120px",
              position: "relative",
            }}
          >
            {/* Corner brackets — top-left */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "32px",
                height: "32px",
                borderTop: "3px solid white",
                borderLeft: "3px solid white",
                borderRadius: "4px 0 0 0",
              }}
            />
            {/* Corner brackets — top-right */}
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: "32px",
                height: "32px",
                borderTop: "3px solid white",
                borderRight: "3px solid white",
                borderRadius: "0 4px 0 0",
              }}
            />
            {/* Corner brackets — bottom-left */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                width: "32px",
                height: "32px",
                borderBottom: "3px solid white",
                borderLeft: "3px solid white",
                borderRadius: "0 0 0 4px",
              }}
            />
            {/* Corner brackets — bottom-right */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: "32px",
                height: "32px",
                borderBottom: "3px solid white",
                borderRight: "3px solid white",
                borderRadius: "0 0 4px 0",
              }}
            />
            {/* Scan line animation */}
            <div
              style={{
                position: "absolute",
                left: "8px",
                right: "8px",
                height: "2px",
                background: "var(--primary, #4f8cff)",
                opacity: 0.8,
                top: "50%",
                boxShadow: "0 0 8px var(--primary, #4f8cff)",
                animation: "scanline 2s ease-in-out infinite",
              }}
            />
          </div>

          {/* Instruction text below viewfinder */}
          <p
            style={{
              color: "white",
              fontSize: "0.95rem",
              fontWeight: 500,
              marginTop: "1.5rem",
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
              textAlign: "center",
            }}
          >
            Point camera at barcode
          </p>
        </div>
      )}

      {/* Starting indicator */}
      {starting && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1008,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.7)",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              border: "3px solid rgba(255,255,255,0.3)",
              borderTopColor: "white",
              borderRadius: "50%",
              animation: "btn-spin 0.7s linear infinite",
            }}
          />
          <p
            style={{
              color: "white",
              marginTop: "1rem",
              fontSize: "0.95rem",
            }}
          >
            Starting camera...
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1008,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.85)",
            padding: "2rem",
          }}
        >
          <Icon name="alert-circle" size={48} color="var(--danger-text, #ef4444)" />
          <p
            style={{
              color: "white",
              fontSize: "1.1rem",
              fontWeight: 600,
              marginTop: "1rem",
              textAlign: "center",
            }}
          >
            {error}
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              marginTop: "1.5rem",
              width: "100%",
              maxWidth: "280px",
            }}
          >
            <Button
              variant="primary"
              size="lg"
              icon="keyboard"
              fullWidth
              onClick={onClose}
              style={{ minHeight: "48px" }}
            >
              Type manually
            </Button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      {!error && !starting && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
            left: 0,
            right: 0,
            zIndex: 1010,
            display: "flex",
            justifyContent: "center",
            padding: "0 1.5rem",
          }}
        >
          <Button
            variant="secondary"
            size="lg"
            icon="keyboard"
            onClick={onClose}
            style={{
              minHeight: "48px",
              background: "rgba(0, 0, 0, 0.55)",
              color: "white",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            Type manually
          </Button>
        </div>
      )}

      {/* Scanline animation + html5-qrcode overrides */}
      <style>{`
        @keyframes scanline {
          0%, 100% { transform: translateY(-20px); }
          50% { transform: translateY(20px); }
        }

        /* Override html5-qrcode default styles */
        #${SCANNER_REGION_ID} {
          border: none !important;
          background: black !important;
        }
        #${SCANNER_REGION_ID} video {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
        }
        /* Hide the built-in qr shaded region since we draw our own viewfinder */
        #${SCANNER_REGION_ID} > div:first-child {
          display: none !important;
        }
        /* Keep the scan region element but make it transparent */
        #qr-shaded-region {
          border: none !important;
        }
      `}</style>
    </div>
  );
}
