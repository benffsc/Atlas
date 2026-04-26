"use client";

import { useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogSiteVisitModal, CompleteRequestModal, CloseRequestModal, HoldRequestModal, RedirectRequestModal, HandoffRequestModal, SendEmailModal, CreateColonyModal, ArchiveRequestModal, TripReportModal } from "@/components/modals";
import { LegacyUpgradeWizard } from "@/components/forms";
import { UpdateSituationDrawer } from "@/components/request/UpdateSituationDrawer";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import type { RequestDetail } from "@/app/requests/[id]/types";
import type { JournalEntry } from "@/components/sections";

type ModalName =
  | "observation"
  | "tripReport"
  | "complete"
  | "close"
  | "hold"
  | "redirect"
  | "handoff"
  | "email"
  | "colony"
  | "upgrade"
  | "archive"
  | "situation"
  | "history";

interface UseRequestModalsProps {
  requestId: string;
  request: RequestDetail | null;
  refreshRequest: () => Promise<void>;
  fetchJournalEntries: () => Promise<void>;
  fetchTripReports: () => Promise<void>;
}

export function useRequestModals({
  requestId,
  request,
  refreshRequest,
  fetchJournalEntries,
  fetchTripReports,
}: UseRequestModalsProps) {
  const router = useRouter();
  const preview = useEntityPreviewModal();
  const [openModal, setOpenModal] = useState<ModalName | null>(null);

  const open = useCallback((name: ModalName) => setOpenModal(name), []);
  const close = useCallback(() => setOpenModal(null), []);

  const handleOpenActionBarModal = useCallback((modal: "close" | "hold" | "observation" | "trip-report") => {
    switch (modal) {
      case "close": open("close"); break;
      case "hold": open("hold"); break;
      case "observation": open("observation"); break;
      case "trip-report": open("tripReport"); break;
    }
  }, [open]);

  const element: ReactNode = request ? (
    <>
      {openModal === "observation" && request.place_id && (
        <LogSiteVisitModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id}
          placeName={request.place_name || ""}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); fetchJournalEntries(); }}
        />
      )}
      {openModal === "tripReport" && (() => {
        const primaryTrapper = request.current_trappers?.find(t => t.is_primary) || request.current_trappers?.[0];
        return (
          <TripReportModal
            isOpen={true}
            requestId={requestId}
            trapperPersonId={primaryTrapper?.trapper_person_id}
            trapperName={primaryTrapper?.trapper_name}
            estimatedCatCount={request.estimated_cat_count}
            placeId={request.place_id}
            placeName={request.place_name}
            onClose={close}
            onSuccess={() => { close(); refreshRequest(); fetchJournalEntries(); fetchTripReports(); }}
          />
        );
      })()}
      {openModal === "complete" && (
        <CompleteRequestModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id || undefined}
          placeName={request.place_name || undefined}
          updatedAt={request.updated_at}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); }}
        />
      )}
      {openModal === "close" && (
        <CloseRequestModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id || undefined}
          placeName={request.place_name || undefined}
          updatedAt={request.updated_at}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); fetchJournalEntries(); }}
        />
      )}
      {openModal === "hold" && (
        <HoldRequestModal
          isOpen={true}
          requestId={requestId}
          updatedAt={request.updated_at}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); }}
        />
      )}
      {openModal === "redirect" && (
        <RedirectRequestModal
          isOpen={true}
          requestId={requestId}
          originalSummary={request.summary || ""}
          originalAddress={request.place_address}
          originalRequesterName={request.requester_name}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); }}
        />
      )}
      {openModal === "handoff" && (
        <HandoffRequestModal
          isOpen={true}
          requestId={requestId}
          originalSummary={request.summary || ""}
          originalAddress={request.place_address}
          originalRequesterName={request.requester_name}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); }}
        />
      )}
      {openModal === "email" && request.requester_email && (
        <SendEmailModal
          isOpen={true}
          requestId={requestId}
          defaultTo={request.requester_email}
          defaultToName={request.requester_name || undefined}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); }}
        />
      )}
      {openModal === "colony" && request.place_id && (
        <CreateColonyModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id}
          onClose={close}
          onSuccess={() => { close(); refreshRequest(); }}
        />
      )}
      {openModal === "upgrade" && (
        <LegacyUpgradeWizard
          request={request}
          onComplete={() => { close(); refreshRequest(); }}
          onCancel={close}
        />
      )}
      {openModal === "archive" && (
        <ArchiveRequestModal
          requestId={requestId}
          requestSummary={request.summary || request.place_name || undefined}
          onComplete={() => { close(); router.push("/requests"); }}
          onCancel={close}
        />
      )}
      <UpdateSituationDrawer
        isOpen={openModal === "situation"}
        requestId={requestId}
        request={request}
        fixedCount={request.colony_verified_altered ?? request.linked_cat_count ?? 0}
        onClose={close}
        onSuccess={() => { close(); refreshRequest(); fetchJournalEntries(); }}
      />
      <EntityPreviewModal
        isOpen={preview.isOpen}
        onClose={preview.close}
        entityType={preview.entityType}
        entityId={preview.entityId}
      />
    </>
  ) : null;

  return {
    open,
    close,
    openModal,
    handleOpenActionBarModal,
    preview,
    element,
  };
}
