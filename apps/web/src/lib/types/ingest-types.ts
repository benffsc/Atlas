/**
 * TypeScript interfaces matching SQL function return columns
 * for the ClinicHQ ingest pipeline entity linking steps.
 *
 * FFS-737: Fixes counter bugs where queryOne<> used incorrect
 * or ad-hoc inline types that didn't match actual SQL returns.
 */

// --- Entity Linking Result Types ---

export interface LinkCatsToPlacesResult {
  cats_linked_home: number;
  cats_linked_appointment: number;
  cats_skipped: number;
  total_edges: number;
}

export interface LinkCatsToAppointmentPlacesResult {
  cats_linked: number;
  cats_skipped: number;
}

export interface LinkAppointmentsToOwnersResult {
  appointments_updated: number;
  persons_created: number;
  persons_linked: number;
}

export interface LinkAppointmentsToPlacesResult {
  source: string;
  appointments_linked: number;
  appointments_unmatched: number;
}

export interface LinkCatsToRequestsResult {
  linked: number;
  skipped: number;
  before_request: number;
  during_request: number;
  grace_period: number;
}

export interface RunAppointmentTrapperLinkingResult {
  run_appointment_trapper_linking: number;
}

export interface QueueUnofficialTrapperCandidatesResult {
  candidates_found: number;
  candidates_queued: number;
  candidates_already_pending: number;
}

// --- Post-Processing Step Result Types ---

export interface FlowAppointmentObservationsResult {
  clinical_inserted: number;
  reproductive_inserted: number;
}

export interface SyncCatsFromAppointmentsResult {
  weight_updated: number;
  age_updated: number;
  coat_updated: number;
}

export interface DetectOwnerChangesResult {
  changes_detected: number;
  auto_processed: number;
  queued_for_review: number;
}

export interface DiseaseStatusComputationResult {
  places_computed: number;
  places_positive: number;
  places_negative: number;
}

// --- Bulk Staging Types ---

export interface BulkStagingRow {
  sourceRowId: string;
  payload: string;
  rowHash: string;
}

export interface BulkStagingChunkResult {
  inserted: string;
  updated: string;
  skipped: string;
}

// --- Stored Procedure Return (Phase 3) ---

export interface PostProcessingProcedureResult {
  run_clinichq_post_processing: Record<string, unknown>;
}
