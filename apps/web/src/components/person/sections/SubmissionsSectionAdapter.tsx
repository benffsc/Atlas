"use client";

import { SubmissionsSection } from "@/components/common";
import type { SectionProps } from "@/lib/person-roles/types";

export function SubmissionsSectionAdapter({ personId }: SectionProps) {
  return <SubmissionsSection entityType="person" entityId={personId} />;
}
