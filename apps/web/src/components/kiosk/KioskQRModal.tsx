"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

interface KioskQRModalProps {
  url: string;
  title: string;
  description: string;
  onClose: () => void;
}

/**
 * Full-screen modal that displays a QR code for a URL.
 * Used by kiosk lobby for external links (volunteering, adoption, barn cat, etc.).
 * Uses Google Charts QR API for simplicity — no extra dependencies.
 */
export function KioskQRModal({ url, title, description, onClose }: KioskQRModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const qrSrc = `https://chart.googleapis.com/chart?cht=qr&chs=280x280&chl=${encodeURIComponent(url)}&choe=UTF-8`;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: 24,
          padding: "2rem 1.5rem",
          maxWidth: 400,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.25rem",
          boxShadow: "var(--shadow-lg, 0 8px 30px rgba(0,0,0,0.2))",
        }}
      >
        <h2
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: 0,
            textAlign: "center",
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>

        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            margin: 0,
            textAlign: "center",
            lineHeight: 1.4,
            maxWidth: 320,
          }}
        >
          {description}
        </p>

        {/* QR Code */}
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: "1rem",
            border: "2px solid var(--card-border, #e5e7eb)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt={`QR code for ${title}`}
            width={280}
            height={280}
            style={{ display: "block" }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            fontWeight: 500,
          }}
        >
          <Icon name="smartphone" size={18} />
          Scan with your phone
        </div>

        <Button
          variant="outline"
          size="lg"
          onClick={onClose}
          style={{
            width: "100%",
            minHeight: 56,
            borderRadius: 14,
            fontSize: "1.05rem",
            marginTop: "0.5rem",
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
