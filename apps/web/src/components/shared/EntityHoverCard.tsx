"use client";

import { ReactNode, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useEntityHoverData } from "@/hooks/useEntityHoverData";
import { Z_INDEX, SHADOWS } from "@/lib/design-tokens";

type EntityType = "cat" | "person" | "place" | "request";

interface EntityHoverCardProps {
  entityType: EntityType;
  entityId: string;
  children: ReactNode;
}

const HOVER_DELAY = 300;

/**
 * Hover popover for cross-entity references.
 * Shows entity name, key stats, and a "View" link.
 * On mobile: no hover, just click-through.
 */
export function EntityHoverCard({ entityType, entityId, children }: EntityHoverCardProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { data, loading, fetch } = useEntityHoverData(entityType, entityId);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
      fetch();
    }, HOVER_DELAY);
  }, [fetch]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  return (
    <span
      style={{ position: "relative", display: "inline" }}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}

      {visible && (
        <div
          ref={cardRef}
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--background, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "8px",
            boxShadow: SHADOWS.lg,
            padding: "0.75rem",
            minWidth: "200px",
            maxWidth: "280px",
            zIndex: Z_INDEX.tooltip,
            pointerEvents: "none",
          }}
        >
          {loading && !data && (
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Loading...</div>
          )}
          {data && (
            <>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.35rem" }}>
                {data.title}
              </div>
              {data.fields.map((field, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.75rem",
                    marginBottom: "0.15rem",
                  }}
                >
                  <span style={{ color: "var(--text-muted, #9ca3af)" }}>{field.label}</span>
                  <span
                    style={{
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "160px",
                    }}
                  >
                    {field.value}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: "0.35rem", fontSize: "0.7rem" }}>
                <Link
                  href={data.href}
                  style={{
                    color: "var(--primary, #3b82f6)",
                    textDecoration: "none",
                    pointerEvents: "auto",
                  }}
                >
                  View &rarr;
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
