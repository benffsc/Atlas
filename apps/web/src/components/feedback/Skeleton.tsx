"use client";

/**
 * Skeleton - Loading placeholder components
 *
 * Provides visual loading states for various UI elements.
 * Uses subtle animation to indicate loading progress.
 */

import { CSSProperties, ReactNode } from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
  className?: string;
}

const baseStyle: CSSProperties = {
  background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s ease-in-out infinite",
};

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 4,
  style,
  className,
}: SkeletonProps) {
  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <div
        className={className}
        style={{
          ...baseStyle,
          width,
          height,
          borderRadius,
          ...style,
        }}
      />
    </>
  );
}

// Pre-built skeleton variants
export function SkeletonText({
  lines = 3,
  lineHeight = 16,
  gap = 8,
}: {
  lines?: number;
  lineHeight?: number;
  gap?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === lines - 1 ? "60%" : "100%"}
        />
      ))}
    </div>
  );
}

export function SkeletonAvatar({
  size = 40,
}: {
  size?: number;
}) {
  return <Skeleton width={size} height={size} borderRadius="50%" />;
}

export function SkeletonCard({
  height = 120,
}: {
  height?: number;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "white",
        borderRadius: 8,
        border: "1px solid #e5e7eb",
      }}
    >
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <SkeletonAvatar size={40} />
        <div style={{ flex: 1 }}>
          <Skeleton height={14} width="40%" style={{ marginBottom: 8 }} />
          <Skeleton height={12} width="60%" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 8,
        border: "1px solid #e5e7eb",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 16,
          padding: "12px 16px",
          background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={12} width="70%" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 16,
            padding: "12px 16px",
            borderBottom: rowIndex < rows - 1 ? "1px solid #f3f4f6" : undefined,
          }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              height={14}
              width={colIndex === 0 ? "80%" : "60%"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({
  items = 5,
  showAvatar = false,
}: {
  items?: number;
  showAvatar?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 0",
          }}
        >
          {showAvatar && <SkeletonAvatar size={32} />}
          <div style={{ flex: 1 }}>
            <Skeleton height={14} width="50%" style={{ marginBottom: 6 }} />
            <Skeleton height={12} width="30%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats({
  count = 4,
}: {
  count?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${count}, 1fr)`,
        gap: 16,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: 16,
            background: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}
        >
          <Skeleton height={12} width="50%" style={{ marginBottom: 8 }} />
          <Skeleton height={24} width="40%" />
        </div>
      ))}
    </div>
  );
}

// Wrapper for conditional skeleton rendering
export function SkeletonWrapper({
  loading,
  skeleton,
  children,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  return loading ? <>{skeleton}</> : <>{children}</>;
}
