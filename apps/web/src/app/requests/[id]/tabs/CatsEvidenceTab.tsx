"use client";

import { LinkedCatsSection } from "@/components/LinkedCatsSection";
import { MediaGallery } from "@/components/MediaGallery";

interface CatsEvidenceTabProps {
  requestId: string;
  cats: { cat_id: string; cat_name: string | null; link_purpose: string; microchip: string | null; altered_status: string | null; linked_at: string }[] | null;
}

export function CatsEvidenceTab({ requestId, cats }: CatsEvidenceTabProps) {
  return (
    <>
      <LinkedCatsSection
        cats={cats}
        context="request"
        emptyMessage="No cats linked to this request yet"
      />

      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Photos & Media</h2>
        <MediaGallery
          entityType="request"
          entityId={requestId}
          allowUpload={true}
          showCatDescription={true}
          defaultMediaType="cat_photo"
          allowedMediaTypes={["cat_photo", "site_photo", "evidence"]}
        />
      </div>
    </>
  );
}
