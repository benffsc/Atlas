/**
 * V2 Ingest Pipeline - Source Layer
 *
 * Functions to write raw data to source.*_raw tables.
 * These tables are APPEND-ONLY - never modify after insert.
 * Hash-based deduplication prevents storing unchanged records.
 */

import crypto from "crypto";
import { queryOne } from "./db.js";

/**
 * Compute MD5 hash of a payload for change detection
 */
export function computeRowHash(payload: Record<string, unknown>): string {
  // Sort keys for consistent hashing regardless of property order
  const sortedJson = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("md5").update(sortedJson).digest("hex");
}

// ============================================================================
// ClinicHQ Raw Data
// ============================================================================

export type ClinicHQRecordType = "appointment" | "owner" | "cat" | "procedure" | "vaccination" | "unknown";

export interface InsertClinicHQRawParams {
  recordType: ClinicHQRecordType;
  sourceRecordId: string;
  payload: Record<string, unknown>;
  fileUploadId?: string;
  syncRunId?: string;
}

/**
 * Insert raw ClinicHQ record to source.clinichq_raw
 * Returns the record ID, or null if unchanged (already exists with same hash)
 */
export async function insertClinicHQRaw(params: InsertClinicHQRawParams): Promise<string | null> {
  const hash = computeRowHash(params.payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.clinichq_raw (
      record_type, source_record_id, payload, row_hash, file_upload_id, sync_run_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    RETURNING id
  `, [
    params.recordType,
    params.sourceRecordId,
    JSON.stringify(params.payload),
    hash,
    params.fileUploadId || null,
    params.syncRunId || null,
  ]);

  return result?.id || null;
}

// ============================================================================
// ShelterLuv Raw Data
// ============================================================================

export type ShelterLuvRecordType = "animal" | "person" | "event" | "outcome" | "intake" | "movement" | "unknown";

export interface InsertShelterLuvRawParams {
  recordType: ShelterLuvRecordType;
  sourceRecordId: string;
  payload: Record<string, unknown>;
  syncRunId?: string;
}

/**
 * Insert raw ShelterLuv record to source.shelterluv_raw
 */
export async function insertShelterLuvRaw(params: InsertShelterLuvRawParams): Promise<string | null> {
  const hash = computeRowHash(params.payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.shelterluv_raw (
      record_type, source_record_id, payload, row_hash, sync_run_id
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    RETURNING id
  `, [
    params.recordType,
    params.sourceRecordId,
    JSON.stringify(params.payload),
    hash,
    params.syncRunId || null,
  ]);

  return result?.id || null;
}

// ============================================================================
// Airtable Raw Data
// ============================================================================

export interface InsertAirtableRawParams {
  baseId: string;
  tableName: string;
  recordId: string;
  payload: Record<string, unknown>;
  syncRunId?: string;
}

/**
 * Insert raw Airtable record to source.airtable_raw
 */
export async function insertAirtableRaw(params: InsertAirtableRawParams): Promise<string | null> {
  const hash = computeRowHash(params.payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.airtable_raw (
      base_id, table_name, record_id, payload, row_hash, sync_run_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (base_id, table_name, record_id, row_hash) DO NOTHING
    RETURNING id
  `, [
    params.baseId,
    params.tableName,
    params.recordId,
    JSON.stringify(params.payload),
    hash,
    params.syncRunId || null,
  ]);

  return result?.id || null;
}

// ============================================================================
// VolunteerHub Raw Data
// ============================================================================

export type VolunteerHubRecordType = "person" | "group" | "membership" | "activity" | "unknown";

export interface InsertVolunteerHubRawParams {
  recordType: VolunteerHubRecordType;
  sourceRecordId: string;
  payload: Record<string, unknown>;
  syncRunId?: string;
}

/**
 * Insert raw VolunteerHub record to source.volunteerhub_raw
 */
export async function insertVolunteerHubRaw(params: InsertVolunteerHubRawParams): Promise<string | null> {
  const hash = computeRowHash(params.payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.volunteerhub_raw (
      record_type, source_record_id, payload, row_hash, sync_run_id
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    RETURNING id
  `, [
    params.recordType,
    params.sourceRecordId,
    JSON.stringify(params.payload),
    hash,
    params.syncRunId || null,
  ]);

  return result?.id || null;
}

// ============================================================================
// PetLink Raw Data
// ============================================================================

export type PetLinkRecordType = "microchip_registration" | "owner_update" | "unknown";

export interface InsertPetLinkRawParams {
  recordType: PetLinkRecordType;
  microchipId: string;
  payload: Record<string, unknown>;
  fileUploadId?: string;
  syncRunId?: string;
}

/**
 * Insert raw PetLink record to source.petlink_raw
 */
export async function insertPetLinkRaw(params: InsertPetLinkRawParams): Promise<string | null> {
  const hash = computeRowHash(params.payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.petlink_raw (
      record_type, microchip_id, payload, row_hash, file_upload_id, sync_run_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (record_type, microchip_id, row_hash) DO NOTHING
    RETURNING id
  `, [
    params.recordType,
    params.microchipId,
    JSON.stringify(params.payload),
    hash,
    params.fileUploadId || null,
    params.syncRunId || null,
  ]);

  return result?.id || null;
}

// ============================================================================
// Web Intake Raw Data
// ============================================================================

export interface InsertWebIntakeRawParams {
  submissionId: string;
  payload: Record<string, unknown>;
  formType?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Insert raw web intake submission to source.web_intake_raw
 */
export async function insertWebIntakeRaw(params: InsertWebIntakeRawParams): Promise<string | null> {
  const hash = computeRowHash(params.payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.web_intake_raw (
      submission_id, payload, row_hash, form_type, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (submission_id) DO NOTHING
    RETURNING id
  `, [
    params.submissionId,
    JSON.stringify(params.payload),
    hash,
    params.formType || "public_intake",
    params.ipAddress || null,
    params.userAgent || null,
  ]);

  return result?.id || null;
}
