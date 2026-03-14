"use client";

import { Section } from "@/components/layouts";
import type { SectionDefinition, SectionProps } from "@/lib/person-roles/types";
import type { PersonDetailData } from "@/hooks/usePersonDetail";

interface SectionRendererProps {
  /** Sections to render (pre-filtered by active tab) */
  sections: SectionDefinition[];
  /** Person ID */
  personId: string;
  /** Full data from usePersonDetail */
  data: PersonDetailData;
  /** Callback after mutations */
  onDataChange?: (what?: "person" | "journal" | "trapper" | "foster" | "all") => void;
}

/**
 * Iterates over section definitions and renders each section's component
 * within a standard Section layout wrapper.
 *
 * Filters out sections whose showWhen returns false.
 * Sections with null components are skipped (placeholder for future registration).
 */
export function SectionRenderer({
  sections,
  personId,
  data,
  onDataChange,
}: SectionRendererProps) {
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
        const sectionProps: SectionProps = { personId, data, onDataChange };

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
