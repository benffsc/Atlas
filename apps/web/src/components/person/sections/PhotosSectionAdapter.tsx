"use client";

import { MediaGallery } from "@/components/media";
import type { SectionProps } from "@/lib/person-roles/types";

export function PhotosSectionAdapter({ personId }: SectionProps) {
  return (
    <MediaGallery
      entityType="person"
      entityId={personId}
      allowUpload={true}
      includeRelated={true}
      defaultMediaType="site_photo"
    />
  );
}
