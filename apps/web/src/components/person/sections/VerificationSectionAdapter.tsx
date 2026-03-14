"use client";

import { VerificationPanel } from "@/components/verification";
import type { SectionProps } from "@/lib/person-roles/types";

export function VerificationSectionAdapter({ personId, data }: SectionProps) {
  return (
    <VerificationPanel
      personId={personId}
      personName={data.person?.display_name || ""}
    />
  );
}
