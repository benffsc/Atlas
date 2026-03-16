"use client";

import { useState, useCallback } from "react";
import type { EntityType } from "@/hooks/useEntityDetail";

interface PreviewState {
  entityType: EntityType | null;
  entityId: string | null;
}

export function useEntityPreviewModal() {
  const [state, setState] = useState<PreviewState>({ entityType: null, entityId: null });

  const open = useCallback((entityType: EntityType, entityId: string) => {
    setState({ entityType, entityId });
  }, []);

  const close = useCallback(() => {
    setState({ entityType: null, entityId: null });
  }, []);

  const handleClick = useCallback(
    (entityType: EntityType, entityId: string) => {
      return (e: React.MouseEvent) => {
        // Allow Cmd/Ctrl+Click for direct navigation
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        open(entityType, entityId);
      };
    },
    [open]
  );

  return {
    isOpen: state.entityType !== null && state.entityId !== null,
    entityType: state.entityType,
    entityId: state.entityId,
    open,
    close,
    handleClick,
  };
}
