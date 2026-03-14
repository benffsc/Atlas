"use client";

import { ClinicHistorySection } from "@/components/sections";
import type { SectionProps } from "@/lib/person-roles/types";

export function ClinicHistorySectionAdapter({ personId }: SectionProps) {
  return <ClinicHistorySection personId={personId} />;
}
