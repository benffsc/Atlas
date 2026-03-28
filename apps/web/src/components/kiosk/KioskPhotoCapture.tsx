"use client";

import { useRef, useEffect } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { compressImage } from "@/lib/image-utils";
import { Icon } from "@/components/ui/Icon";

interface KioskPhotoCaptureProps {
  /** Existing photo URL for preview */
  value: string | null;
  /** Called with compressed File on capture, or null on remove */
  onChange: (file: File | null) => void;
  label?: string;
  /** Show highlighted border + "Photo recommended" hint */
  autoPrompt?: boolean;
  helperText?: string;
}

/**
 * Lightweight photo capture component for kiosk flows.
 * Triggers native camera on iOS/mobile, file picker on desktop.
 * Does NOT upload — parent form handles upload on submit.
 */
export function KioskPhotoCapture({
  value,
  onChange,
  label = "Photo",
  autoPrompt = false,
  helperText,
}: KioskPhotoCaptureProps) {
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current && previewUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const compressed = await compressImage(file);

    // Create preview URL and track it for cleanup
    if (previewUrlRef.current && previewUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = URL.createObjectURL(compressed);

    onChange(compressed);

    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemove = () => {
    if (previewUrlRef.current && previewUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
    onChange(null);
  };

  const previewSrc = previewUrlRef.current || value;
  const hasPhoto = !!previewSrc;

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: "0.375rem",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </label>

      {hasPhoto ? (
        /* Photo captured — show preview + actions */
        <div
          style={{
            border: "1px solid var(--card-border, #e5e7eb)",
            borderRadius: "12px",
            overflow: "hidden",
            background: "var(--muted-bg, #f3f4f6)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc!}
            alt="Equipment photo"
            style={{
              width: "100%",
              maxHeight: "200px",
              objectFit: "contain",
              display: "block",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              padding: "0.5rem",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.5rem 1rem",
                fontSize: "0.85rem",
                fontWeight: 500,
                border: "1px solid var(--card-border, #e5e7eb)",
                borderRadius: "8px",
                background: "var(--background, #fff)",
                color: "var(--text-primary)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Icon name="camera" size={16} color="var(--muted)" />
              Retake
            </button>
            <button
              type="button"
              onClick={handleRemove}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.5rem 1rem",
                fontSize: "0.85rem",
                fontWeight: 500,
                border: "1px solid var(--danger-border, #fca5a5)",
                borderRadius: "8px",
                background: "var(--danger-bg, #fef2f2)",
                color: "var(--danger-text, #dc2626)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Icon name="x" size={16} color="var(--danger-text, #dc2626)" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        /* No photo — show capture target */
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: "100%",
            minHeight: "100px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "1.25rem",
            border: autoPrompt
              ? "2px dashed var(--warning-border, #fbbf24)"
              : "2px dashed var(--card-border, #d1d5db)",
            borderRadius: "12px",
            background: autoPrompt
              ? "var(--warning-bg, #fffbeb)"
              : "var(--background, #fff)",
            cursor: "pointer",
            transition: "border-color 150ms ease, background 150ms ease",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: autoPrompt
                ? "var(--warning-bg, #fffbeb)"
                : "var(--bg-secondary, #f3f4f6)",
              border: autoPrompt
                ? "1px solid var(--warning-border, #fbbf24)"
                : "1px solid var(--card-border, #e5e7eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name="camera"
              size={24}
              color={autoPrompt ? "var(--warning-text, #d97706)" : "var(--muted)"}
            />
          </div>
          <span
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              color: autoPrompt ? "var(--warning-text, #d97706)" : "var(--text-secondary)",
            }}
          >
            {autoPrompt ? "Photo recommended" : "Tap to take photo"}
          </span>
        </button>
      )}

      {helperText && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            marginTop: "0.375rem",
          }}
        >
          {helperText}
        </div>
      )}

      {/* Hidden file input — triggers native camera on mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture={isMobile ? "environment" : undefined}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
