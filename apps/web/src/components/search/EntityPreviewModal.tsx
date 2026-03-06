"use client";

import { Modal } from "@/components/ui/Modal";
import { EntityPreviewContent, useEntityDetail } from "./EntityPreviewContent";
import type { EntityType } from "./EntityPreviewContent";

interface EntityPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: EntityType | null;
  entityId: string | null;
}

function entityHref(type: EntityType, id: string): string {
  switch (type) {
    case "cat": return `/cats/${id}`;
    case "person": return `/people/${id}`;
    case "place": return `/places/${id}`;
    case "request": return `/requests/${id}`;
  }
}

function entityLabel(type: EntityType): string {
  switch (type) {
    case "cat": return "Cat";
    case "person": return "Person";
    case "place": return "Place";
    case "request": return "Request";
  }
}

export function EntityPreviewModal({ isOpen, onClose, entityType, entityId }: EntityPreviewModalProps) {
  const { detail, loading } = useEntityDetail(
    isOpen ? entityType : null,
    isOpen ? entityId : null,
  );

  if (!entityType || !entityId) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${entityLabel(entityType)} Preview`}
      size="sm"
      footer={
        <a
          href={entityHref(entityType, entityId)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.5rem 1rem",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            borderRadius: "6px",
            textDecoration: "none",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          View Full Page &rarr;
        </a>
      }
    >
      <EntityPreviewContent
        entityType={entityType}
        detail={detail}
        loading={loading}
      />
    </Modal>
  );
}
