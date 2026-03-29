"use client";

import { ReactNode, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { formatPhone } from "@/lib/formatters";

interface EntityPreviewPanelProps {
  title: string;
  detailHref: string;
  onClose: () => void;
  badges?: ReactNode;
  stats?: Array<{ label: string; value: string | number; color?: string }>;
  contact?: { phone: string | null; email: string | null };
  sections?: Array<{ id: string; title: string; content: ReactNode }>;
  actions?: ReactNode;
  children?: ReactNode;
  /** When true, sections render in a 2-column grid for wider panels */
  wide?: boolean;
}

/**
 * Generic preview panel for entity detail within a split-view layout.
 *
 * Layout: Sticky header (title + badges + close) -> "Open Full Profile" link
 * -> stats grid (2 col) -> contact info -> collapsible sections -> children.
 */
export function EntityPreviewPanel({
  title,
  detailHref,
  onClose,
  badges,
  stats,
  contact,
  sections,
  actions,
  children,
  wide: wideProp,
}: EntityPreviewPanelProps) {
  // Auto-detect wide mode from own width
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoWide, setAutoWide] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setAutoWide(entry.contentRect.width > 560);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const wide = wideProp ?? autoWide;

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sticky header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "var(--background, #fff)",
          borderBottom: "1px solid var(--border, #e5e7eb)",
          padding: "1rem 1.25rem",
          zIndex: 5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: "1.125rem",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h2>
            {badges}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            {actions}
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.25rem",
                color: "var(--text-muted, #9ca3af)",
                padding: "0.25rem",
                lineHeight: 1,
              }}
              aria-label="Close preview"
            >
              &times;
            </button>
          </div>
        </div>
        <Link
          href={detailHref}
          style={{
            display: "inline-block",
            marginTop: "0.5rem",
            fontSize: "0.8rem",
            color: "var(--primary, #3b82f6)",
            textDecoration: "none",
          }}
        >
          Open Full Profile &rarr;
        </Link>
      </div>

      {/* Body */}
      <div style={{ padding: wide ? "1.5rem 2rem" : "1.25rem", flex: 1, maxWidth: wide ? "960px" : undefined, margin: wide ? "0 auto" : undefined, width: "100%" }}>
        {/* Stats grid */}
        {stats && stats.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: wide ? "repeat(auto-fill, minmax(100px, 1fr))" : "1fr 1fr",
              gap: "0.75rem",
              marginBottom: "1.25rem",
            }}
          >
            {stats.map((stat, i) => (
              <div
                key={i}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--section-bg, #f9fafb)",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: stat.color || "var(--foreground)",
                  }}
                >
                  {stat.value}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #9ca3af)" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Contact */}
        {contact && (contact.phone || contact.email) && (
          <div
            style={{
              marginBottom: "1.25rem",
              padding: "0.75rem",
              background: "var(--section-bg, #f9fafb)",
              borderRadius: "6px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.35rem", fontWeight: 600 }}>
              Contact
            </div>
            {contact.phone && (
              <div style={{ fontSize: "0.85rem", marginBottom: "0.15rem" }}>
                <a href={`tel:${contact.phone}`} style={{ color: "var(--primary, #3b82f6)", textDecoration: "none" }}>
                  {formatPhone(contact.phone)}
                </a>
              </div>
            )}
            {contact.email && (
              <div style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                <a href={`mailto:${contact.email}`} style={{ color: "var(--text-secondary, #6b7280)", textDecoration: "none" }}>
                  {contact.email}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Sections */}
        <div style={wide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem 1.5rem", alignItems: "start" } : undefined}>
          {sections?.map((section) => (
            <div key={section.id} style={{ marginBottom: wide ? 0 : "1rem" }}>
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--text-muted, #9ca3af)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "0.5rem",
                }}
              >
                {section.title}
              </div>
              {section.content}
            </div>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}
