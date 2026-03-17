"use client";

import { Section } from "@/components/layouts";
import type { EntitySectionDef, EntitySectionProps } from "@/lib/entity-configs/types";

interface SectionRendererProps<TData> {
  /** Sections to render (pre-filtered by active tab) */
  sections: EntitySectionDef<TData>[];
  /** Entity ID */
  entityId: string;
  /** Full entity data */
  data: TData;
  /** Callback after mutations */
  onDataChange?: (what?: string) => void;
}

/**
 * Generic section renderer for entity detail pages.
 *
 * Iterates over section definitions and renders each section's component
 * within a standard Section layout wrapper. Filters out sections whose
 * showWhen returns false or have no component.
 */
export function SectionRenderer<TData>({
  sections,
  entityId,
  data,
  onDataChange,
}: SectionRendererProps<TData>) {
  const visibleSections = sections.filter((s) => {
    if (s.showWhen && !s.showWhen(data)) return false;
    if (!s.component) return false;
    return true;
  });

  if (visibleSections.length === 0) {
    return <p className="text-muted">No content available.</p>;
  }

  return (
    <>
      {visibleSections.map((section) => {
        const Component = section.component;
        const sectionProps: EntitySectionProps<TData> = { entityId, data, onDataChange };

        return (
          <Section
            key={section.id}
            title={section.title}
            className="mb-4"
            collapsible={section.defaultCollapsed}
            defaultCollapsed={section.defaultCollapsed}
          >
            <Component {...sectionProps} />
          </Section>
        );
      })}
    </>
  );
}
