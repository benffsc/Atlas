/**
 * RequestForm — Config-driven form renderer (FFS-496).
 *
 * Takes a FormConfig and renders section components in order.
 * Each section receives its value + onChange from the useFormState hook.
 *
 * Usage:
 *   import { FFR_NEW_CONFIG } from '@/lib/form-configs';
 *   import { useFormState } from '@/hooks/useFormState';
 *
 *   const { sections, toRequestBody } = useFormState(FFR_NEW_CONFIG);
 *   <RequestForm config={FFR_NEW_CONFIG} sections={sections} />
 */

"use client";

import React from "react";
import type { FormConfig } from "@/lib/form-configs";
import type { SectionEntry, SectionStates } from "@/hooks/useFormState";
import {
  PersonSection,
  PlaceSection,
  CatDetailsSection,
  KittenAssessmentSection,
  PropertyAccessSection,
  UrgencyNotesSection,
} from "@/components/request-sections";
import type {
  PersonSectionValue,
  PlaceSectionValue,
  CatDetailsSectionValue,
  KittenAssessmentValue,
  PropertyAccessValue,
  UrgencyNotesValue,
} from "@/components/request-sections";

// ── Props ───────────────────────────────────────────────────────────

export interface RequestFormProps {
  /** The form configuration defining which sections to render */
  config: FormConfig;
  /** Section entries from useFormState — values + onChange handlers */
  sections: SectionEntry[];
  /** Optional: render extra content before the sections */
  header?: React.ReactNode;
  /** Optional: render extra content after the sections */
  footer?: React.ReactNode;
  /** Optional: render extra content between sections */
  divider?: React.ReactNode;
  /** Optional: compact mode for modals */
  compact?: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function RequestForm({
  sections,
  header,
  footer,
  divider,
  compact = false,
}: RequestFormProps) {
  return (
    <div>
      {header}
      {sections.map((entry, idx) => (
        <React.Fragment key={`${entry.component}-${idx}`}>
          {idx > 0 && divider}
          <SectionRenderer entry={entry} compact={compact} />
        </React.Fragment>
      ))}
      {footer}
    </div>
  );
}

// ── Section renderer ────────────────────────────────────────────────

function SectionRenderer({
  entry,
  compact: globalCompact,
}: {
  entry: SectionEntry;
  compact: boolean;
}) {
  const sectionCompact = (entry.props?.compact as boolean) ?? globalCompact;

  switch (entry.component) {
    case "person":
      return (
        <PersonSection
          role={(entry.props?.role as PersonSectionProps["role"]) ?? "requestor"}
          label={entry.label}
          value={entry.value as PersonSectionValue}
          onChange={entry.onChange as (v: PersonSectionValue) => void}
          allowCreate={(entry.props?.allowCreate as boolean) ?? false}
          showSameAsRequestor={(entry.props?.showSameAsRequestor as boolean) ?? false}
          required={(entry.props?.required as boolean) ?? false}
          compact={sectionCompact}
        />
      );

    case "place":
      return (
        <PlaceSection
          label={entry.label}
          value={entry.value as PlaceSectionValue}
          onChange={entry.onChange as (v: PlaceSectionValue) => void}
          showPropertyType={(entry.props?.showPropertyType as boolean) ?? true}
          showCounty={(entry.props?.showCounty as boolean) ?? true}
          showWhereOnProperty={(entry.props?.showWhereOnProperty as boolean) ?? true}
          showDescribeLocation={(entry.props?.showDescribeLocation as boolean) ?? true}
          compact={sectionCompact}
          required={(entry.props?.required as boolean) ?? false}
        />
      );

    case "catDetails":
      return (
        <CatDetailsSection
          value={entry.value as CatDetailsSectionValue}
          onChange={entry.onChange as (v: CatDetailsSectionValue) => void}
          compact={sectionCompact}
        />
      );

    case "kittens":
      return (
        <KittenAssessmentSection
          value={entry.value as KittenAssessmentValue}
          onChange={entry.onChange as (v: KittenAssessmentValue) => void}
          compact={sectionCompact}
        />
      );

    case "propertyAccess":
      return (
        <PropertyAccessSection
          value={entry.value as PropertyAccessValue}
          onChange={entry.onChange as (v: PropertyAccessValue) => void}
          compact={sectionCompact}
        />
      );

    case "urgencyNotes":
      return (
        <UrgencyNotesSection
          value={entry.value as UrgencyNotesValue}
          onChange={entry.onChange as (v: UrgencyNotesValue) => void}
          showDetails={(entry.props?.showDetails as boolean) ?? true}
          compact={sectionCompact}
        />
      );

    default:
      return null;
  }
}

// Import for type reference only
import type { PersonSectionProps } from "@/components/request-sections/PersonSection";

// Re-export for convenience
export type { FormConfig, SectionEntry, SectionStates };
