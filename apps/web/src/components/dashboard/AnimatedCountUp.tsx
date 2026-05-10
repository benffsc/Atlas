"use client";

/**
 * AnimatedCountUp — rolls a number from 0 to target with easeOutCubic.
 *
 * Used in showcase mode to create the "wow moment" when impact stats
 * appear. Uses requestAnimationFrame for smooth 60fps animation.
 * No external dependencies.
 */

import { useEffect, useRef, useState } from "react";

interface AnimatedCountUpProps {
  /** Target number to count up to */
  value: number;
  /** Duration of the animation in ms (default 2000) */
  duration?: number;
  /** Format function applied to the display number */
  format?: (n: number) => string;
  /** CSS class for the number element */
  className?: string;
}

export function AnimatedCountUp({
  value,
  duration = 2000,
  format = (n) => n.toLocaleString(),
  className,
}: AnimatedCountUpProps) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const hasAnimated = useRef(false);
  const elementRef = useRef<HTMLSpanElement>(null);

  // Intersection Observer — only animate when visible
  useEffect(() => {
    if (!elementRef.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          startAnimation();
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(elementRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function startAnimation() {
    startRef.current = null;

    const step = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <span ref={elementRef} className={className}>
      {format(display)}
    </span>
  );
}
