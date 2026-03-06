"use client";

import { useState, useEffect, useRef } from "react";
import { EntityPreviewContent, useEntityDetail } from "./EntityPreviewContent";
import type { EntityType } from "./EntityPreviewContent";

interface EntityPreviewProps {
  entityType: EntityType;
  entityId: string;
  children: React.ReactNode;
}

export default function EntityPreview({ entityType, entityId, children }: EntityPreviewProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { detail, loading } = useEntityDetail(
    isHovering ? entityType : null,
    isHovering ? entityId : null,
  );

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + window.scrollY + 8,
          left: Math.max(8, rect.left + window.scrollX),
        });
      }
      setIsHovering(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHovering(false);
  };

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

      {isHovering && position && (
        <div
          style={{
            position: "absolute",
            top: position.top,
            left: position.left,
            zIndex: 1000,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            padding: "0.75rem",
            minWidth: 280,
            maxWidth: 360,
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
        </div>
      )}
    </div>
  );
}
