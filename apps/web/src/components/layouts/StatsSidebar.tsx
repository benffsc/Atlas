"use client";

import { ReactNode } from "react";
import Link from "next/link";

export interface StatItem {
  /** Label for the stat */
  label: string;
  /** Value to display */
  value: string | number | ReactNode;
  /** Optional icon (emoji or component) */
  icon?: string | ReactNode;
  /** Optional link to navigate to */
  href?: string;
  /** Optional subtitle/description */
  subtitle?: string;
}

interface StatSection {
  /** Section title */
  title: string;
  /** Section content - can be stats or custom ReactNode */
  content: ReactNode;
}

interface StatsSidebarProps {
  /** Primary stats to display */
  stats?: StatItem[];
  /** Additional sections */
  sections?: StatSection[];
  /** Additional class */
  className?: string;
}

/**
 * Quick stats display for sidebar pattern.
 *
 * Shows key metrics and linked record summaries.
 *
 * @example
 * ```tsx
 * <StatsSidebar
 *   stats={[
 *     { label: "Total Cats", value: 12, icon: "🐱" },
 *     { label: "TNR'd", value: 8, icon: "✂️" },
 *     { label: "Coverage", value: "67%", icon: "📊" },
 *   ]}
 *   sections={[
 *     { title: "Recent Activity", content: <ActivityList /> },
 *     { title: "Nearby", content: <NearbyPlaces /> },
 *   ]}
 * />
 * ```
 */
export function StatsSidebar({
  stats = [],
  sections = [],
  className = "",
}: StatsSidebarProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Primary stats grid */}
      {stats.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-4">
            {stats.map((stat, index) => (
              <StatItemDisplay key={index} stat={stat} />
            ))}
          </div>
        </div>
      )}

      {/* Additional sections */}
      {sections.map((section, index) => (
        <div key={index} className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h4 className="text-sm font-semibold text-gray-900">
              {section.title}
            </h4>
          </div>
          <div className="p-4">{section.content}</div>
        </div>
      ))}
    </div>
  );
}

function StatItemDisplay({ stat }: { stat: StatItem }) {
  const content = (
    <div className="flex items-start gap-2">
      {stat.icon && (
        <span className="text-lg flex-shrink-0">
          {typeof stat.icon === "string" ? (
            <span role="img">{stat.icon}</span>
          ) : (
            stat.icon
          )}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-lg font-semibold text-gray-900 truncate">
          {stat.value}
        </div>
        <div className="text-xs text-gray-500 truncate">{stat.label}</div>
        {stat.subtitle && (
          <div className="text-xs text-gray-400 truncate">{stat.subtitle}</div>
        )}
      </div>
    </div>
  );

  if (stat.href) {
    return (
      <Link
        href={stat.href}
        className="block p-2 -m-2 rounded-lg hover:bg-gray-50 transition-colors"
      >
        {content}
      </Link>
    );
  }

  return <div className="p-2 -m-2">{content}</div>;
}

/**
 * Compact stat row for inline display
 */
export function StatRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href?: string;
}) {
  const content = (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
        {content}
      </Link>
    );
  }

  return content;
}

export default StatsSidebar;
