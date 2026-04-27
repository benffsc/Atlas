"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface ContainerWidthOptions {
  compact?: number;
  narrow?: number;
}

interface ContainerWidthResult {
  ref: (node: HTMLDivElement | null) => void;
  width: number;
  isCompact: boolean;
  isNarrow: boolean;
}

/**
 * Tracks the content width of a container element via ResizeObserver.
 * Returns a callback ref compatible with any React version.
 *
 * @param thresholds - Override default breakpoints (compact: 560, narrow: 700)
 */
export function useContainerWidth(thresholds?: ContainerWidthOptions): ContainerWidthResult {
  const compactAt = thresholds?.compact ?? 560;
  const narrowAt = thresholds?.narrow ?? 700;

  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    nodeRef.current = node;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return {
    ref,
    width,
    isCompact: width > 0 && width < compactAt,
    isNarrow: width > 0 && width < narrowAt,
  };
}
