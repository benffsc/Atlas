"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EntityPreviewContent } from "./EntityPreviewContent";
import { useEntityDetail } from "@/hooks/useEntityDetail";
import type { EntityType } from "@/hooks/useEntityDetail";

interface EntityPreviewProps {
  entityType: EntityType;
  entityId: string;
  children: React.ReactNode;
}

const CARD_WIDTH = 320;
const CARD_MAX_HEIGHT = 400;
const GAP = 8;

export default function EntityPreview({ entityType, entityId, children }: EntityPreviewProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { detail, loading } = useEntityDetail(
    isHovering ? entityType : null,
    isHovering ? entityId : null,
  );

  const computePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Prefer below trigger; flip above if not enough space
    const spaceBelow = vh - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const cardHeight = cardRef.current?.offsetHeight || CARD_MAX_HEIGHT;

    let top: number;
    if (spaceBelow >= cardHeight || spaceBelow >= spaceAbove) {
      // Position below
      top = rect.bottom + GAP;
    } else {
      // Position above
      top = rect.top - GAP - cardHeight;
    }

    // Clamp left so card stays in viewport
    let left = rect.left;
    if (left + CARD_WIDTH > vw - GAP) {
      left = vw - CARD_WIDTH - GAP;
    }
    if (left < GAP) {
      left = GAP;
    }

    // Clamp top within viewport
    top = Math.max(GAP, Math.min(top, vh - cardHeight - GAP));

    setPosition({ top, left });
  };

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      computePosition();
      setIsHovering(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHovering(false);
  };

  // Recompute position when card renders (actual height may differ from estimate)
  useEffect(() => {
    if (isHovering && cardRef.current) {
      computePosition();
    }
  }, [isHovering, loading, detail]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: "inline" }}
    >
      {children}

      {isHovering && typeof document !== "undefined" && createPortal(
        <div
          ref={cardRef}
          style={{
            position: "fixed",
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            zIndex: 9999,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            padding: "0.75rem",
            minWidth: 280,
            maxWidth: CARD_WIDTH,
            maxHeight: CARD_MAX_HEIGHT,
            overflowY: "auto",
            fontSize: "0.875rem",
          }}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={handleMouseLeave}
        >
          <EntityPreviewContent
            entityType={entityType}
            detail={detail}
            loading={loading}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
