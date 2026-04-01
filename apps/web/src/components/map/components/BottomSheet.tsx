"use client";

import { ReactNode, useEffect, useRef, useCallback, useState } from "react";

const DEFAULT_SNAP_POINTS = [15, 50, 85];

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional header content rendered in the drag handle area (e.g., search input) */
  header?: ReactNode;
  /** Initial height as percentage of viewport (default 50) */
  initialHeight?: number;
  /** Maximum height as percentage of viewport (default 90) */
  maxHeight?: number;
  /** Minimum height before auto-close in px (default 80) */
  closeThreshold?: number;
  /** Snap points as percentage of viewport height (default [15, 50, 85]) */
  snapPoints?: number[];
}

/**
 * Mobile bottom sheet with drag-to-resize, snap points, and swipe-to-close.
 * Used for place details on mobile devices instead of side drawers.
 */
export function BottomSheet({
  isOpen,
  onClose,
  children,
  header,
  initialHeight = 50,
  maxHeight = 90,
  closeThreshold = 80,
  snapPoints = DEFAULT_SNAP_POINTS,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [height, setHeight] = useState(initialHeight);

  // Reset height when opening
  useEffect(() => {
    if (isOpen) setHeight(initialHeight);
  }, [isOpen, initialHeight]);

  // Prevent body scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleDragStart = useCallback((clientY: number) => {
    dragRef.current = { startY: clientY, startHeight: height };
  }, [height]);

  const handleDragMove = useCallback((clientY: number) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - clientY;
    const vh = window.innerHeight;
    const deltaPercent = (delta / vh) * 100;
    const newHeight = Math.max(10, Math.min(maxHeight, dragRef.current.startHeight + deltaPercent));
    setHeight(newHeight);
  }, [maxHeight]);

  const handleDragEnd = useCallback(() => {
    if (!dragRef.current) return;
    const vh = window.innerHeight;
    const currentPx = (height / 100) * vh;
    if (currentPx < closeThreshold) {
      onClose();
    } else {
      // Snap to nearest snap point
      const nearest = snapPoints.reduce((prev, curr) =>
        Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev
      );
      setHeight(nearest);
    }
    dragRef.current = null;
  }, [height, closeThreshold, onClose, snapPoints]);

  // Touch handlers
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    handleDragStart(e.touches[0].clientY);
  }, [handleDragStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    handleDragMove(e.touches[0].clientY);
  }, [handleDragMove]);

  const onTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Mouse handlers (for testing in desktop browser)
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientY);

    const onMouseMove = (ev: MouseEvent) => handleDragMove(ev.clientY);
    const onMouseUp = () => {
      handleDragEnd();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [handleDragStart, handleDragMove, handleDragEnd]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 1299,
          transition: "opacity 0.2s",
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Place details"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${height}dvh`,
          maxHeight: `${maxHeight}dvh`,
          background: "var(--background, #fff)",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.2)",
          zIndex: 1300,
          display: "flex",
          flexDirection: "column",
          transition: dragRef.current ? "none" : "height 0.2s ease",
          willChange: "height",
        }}
      >
        {/* Drag handle */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown}
          style={{
            padding: "10px 0 6px",
            cursor: "grab",
            touchAction: "none",
            flexShrink: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "var(--border, #d1d5db)",
            }}
          />
        </div>

        {/* Optional header */}
        {header && (
          <div style={{ flexShrink: 0, padding: "0 16px 8px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
            {header}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          {children}
        </div>
      </div>
    </>
  );
}
