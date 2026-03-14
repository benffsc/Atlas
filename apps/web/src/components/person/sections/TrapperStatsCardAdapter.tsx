"use client";

import { TrapperStatsCard } from "@/components/cards";
import type { SectionProps } from "@/lib/person-roles/types";

export function TrapperStatsCardAdapter({ personId }: SectionProps) {
  return <TrapperStatsCard personId={personId} />;
}
